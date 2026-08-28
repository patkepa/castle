use std::{
    collections::BTreeSet,
    io::{BufRead, BufReader, BufWriter, Write},
    path::{Path, PathBuf},
    process,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, AtomicU64, Ordering},
        mpsc::{self, RecvTimeoutError, TryRecvError},
    },
    thread,
    time::{Duration, Instant},
};

use anyhow::{Context, Result, anyhow, bail};
use castle_contracts::{
    CreateTaskInput, DeleteTaskInput, MutateTaskInput, RestoreTaskInput, UpdatePersonInput,
};
use castle_core::{
    CastleService, CompileOptions, CreateFolderInput, CreateSourceInput, DeleteFolderInput,
    DeleteSourceInput, IndexProjection, MigrationOptions, MigrationSeverity, MoveSourceInput,
    RestoreSourceInput, SaveSourceInput, ServiceOptions, SnapshotDelta, SnapshotOptions,
    SourceConflict, apply_record_migrations, build_index_projection, compile_changed_sources,
    compile_library, load_castle_configuration, plan_record_migrations,
    write_incremental_note_resources, write_incremental_snapshot, write_snapshot,
};
use castle_index::{
    CastleToolService, EmbeddingCache, EmbeddingProvider, EmbeddingRuntime, EmbeddingSyncOptions,
    EntityKind, EntityQuery, IndexPublisher, IndexPublisherOptions, IndexStatus, KnowledgeIndex,
    LocalEmbeddingOptions, LocalEmbeddingProvider, NoteContextRequest, RelatedNotesRequest,
    SearchRequest, TursoKnowledgeIndex, create_library_key, local_embedding_metadata,
    run_capability_probe,
};
use clap::{Parser, Subcommand};
use notify::{Event, EventKind, RecursiveMode, Watcher};
use serde_json::{Value, json};

const WATCH_DEBOUNCE: Duration = Duration::from_millis(25);
const WATCH_IDLE_TICK: Duration = Duration::from_millis(500);
const WATCH_FALLBACK_SCAN: Duration = Duration::from_secs(30);
const PUBLICATION_DEBOUNCE: Duration = Duration::from_millis(75);

#[derive(Debug, Clone)]
struct PublicationRequest {
    generation: u64,
    full_snapshot: bool,
    full_compile: bool,
    changed_source_files: BTreeSet<String>,
}

impl PublicationRequest {
    fn merge(&mut self, next: Self) {
        self.generation = self.generation.max(next.generation);
        self.full_snapshot |= next.full_snapshot;
        self.full_compile |= next.full_compile;
        self.changed_source_files.extend(next.changed_source_files);
    }
}

#[derive(Debug, Parser)]
#[command(name = "castle", about = "Castle native content engine")]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Debug, Subcommand)]
enum Command {
    Build(Paths),
    Validate(Paths),
    Migrate(MigrationPaths),
    Daemon(DaemonPaths),
    Index {
        #[command(subcommand)]
        command: IndexCommand,
    },
    Mcp(IndexLocation),
}

#[derive(Debug, Subcommand)]
enum IndexCommand {
    Probe(IndexProbePaths),
    Build(IndexPaths),
    Verify(IndexLocation),
    Status(IndexLocation),
}

#[derive(Debug, clap::Args)]
struct Paths {
    #[arg(long)]
    library: Option<PathBuf>,
    #[arg(long)]
    repository: Option<PathBuf>,
    /// Also write a pretty, monolithic knowledge-base JSON file.
    #[arg(long)]
    generated: Option<PathBuf>,
    #[arg(long, default_value = "public")]
    public: PathBuf,
}

#[derive(Debug, clap::Args)]
struct DaemonPaths {
    #[arg(long)]
    library: Option<PathBuf>,
    #[arg(long)]
    repository: Option<PathBuf>,
    #[arg(long)]
    cache: PathBuf,
}

#[derive(Debug, clap::Args)]
struct MigrationPaths {
    #[arg(long)]
    library: Option<PathBuf>,
    #[arg(long)]
    repository: Option<PathBuf>,
    #[arg(long, default_value_t = castle_core::CURRENT_RECORD_SCHEMA_VERSION)]
    target: u32,
    /// Apply the plan. Without this flag Castle performs a dry-run.
    #[arg(long)]
    apply: bool,
    #[arg(long)]
    backup_root: Option<PathBuf>,
    /// Print the machine-readable migration plan.
    #[arg(long)]
    json: bool,
}

#[derive(Debug, clap::Args)]
struct IndexProbePaths {
    #[arg(long)]
    database: PathBuf,
}

#[derive(Debug, Clone, clap::Args)]
struct IndexPaths {
    #[arg(long)]
    library: Option<PathBuf>,
    #[arg(long)]
    repository: Option<PathBuf>,
    #[arg(long)]
    indexes: PathBuf,
    #[arg(long)]
    library_key: Option<String>,
}

#[derive(Debug, Clone, clap::Args)]
struct IndexLocation {
    #[arg(long)]
    library: Option<PathBuf>,
    #[arg(long)]
    indexes: PathBuf,
    #[arg(long)]
    library_key: Option<String>,
}

fn main() -> Result<()> {
    let cli = Cli::parse();
    match cli.command {
        Command::Build(paths) => run(paths, true),
        Command::Validate(paths) => run(paths, false),
        Command::Migrate(paths) => run_migrations(paths),
        Command::Daemon(paths) => run_daemon(paths),
        Command::Index {
            command: IndexCommand::Probe(paths),
        } => run_index_probe(paths),
        Command::Index {
            command: IndexCommand::Build(paths),
        } => run_index_build(paths),
        Command::Index {
            command: IndexCommand::Verify(location),
        } => run_index_verify(location),
        Command::Index {
            command: IndexCommand::Status(location),
        } => run_index_status(location),
        Command::Mcp(location) => run_mcp(location),
    }
}

fn configured_paths(
    library: Option<PathBuf>,
    repository: Option<PathBuf>,
) -> Result<(PathBuf, PathBuf)> {
    let configuration = load_castle_configuration(&std::env::current_dir()?)?;
    Ok((
        library.unwrap_or(configuration.library_path),
        repository.unwrap_or(configuration.repository_path),
    ))
}

fn configured_library(library: Option<PathBuf>) -> Result<PathBuf> {
    let configuration = load_castle_configuration(&std::env::current_dir()?)?;
    Ok(library.unwrap_or(configuration.library_path))
}

fn run_migrations(paths: MigrationPaths) -> Result<()> {
    let (library_root, repository_root) = configured_paths(paths.library, paths.repository)?;
    let options = MigrationOptions {
        library_root,
        repository_root,
        target_version: paths.target,
        backup_root: paths.backup_root,
    };
    let plan = plan_record_migrations(&options)?;
    if paths.json {
        println!("{}", serde_json::to_string_pretty(&plan)?);
    } else {
        println!(
            "Castle scanned {} records and {} {} migrate to schema {}.",
            plan.scanned_records,
            if paths.apply { "will" } else { "would" },
            plan.changes.len(),
            plan.target_version
        );
        for change in &plan.changes {
            println!(
                "  {}: {} {} -> {}",
                change.source_file, change.record_type, change.from_version, change.to_version
            );
        }
        for diagnostic in &plan.diagnostics {
            eprintln!(
                "  {:?}: {}{}",
                diagnostic.severity,
                if diagnostic.source_file.is_empty() {
                    String::new()
                } else {
                    format!("{}: ", diagnostic.source_file)
                },
                diagnostic.message
            );
        }
    }
    if plan
        .diagnostics
        .iter()
        .any(|diagnostic| diagnostic.severity == MigrationSeverity::Error)
    {
        bail!("Castle migration plan contains errors; no files were changed.");
    }
    if paths.apply {
        let outcome = apply_record_migrations(&options, &plan)?;
        println!(
            "Migrated {} files. Backup: {}",
            outcome.changed_files, outcome.backup_path
        );
    } else if !plan.changes.is_empty() {
        println!("Dry-run only. Re-run with --apply after reviewing this plan.");
    }
    Ok(())
}

fn run_mcp(location: IndexLocation) -> Result<()> {
    let publisher = index_publisher(&location)?;
    let index = Arc::new(TursoKnowledgeIndex::open(&publisher)?);
    let mut tools = castle_index::CastleToolService::new(index.clone());
    if index.metadata().semantic_available {
        let model_cache = mcp_model_cache(&location.indexes);
        if let Ok(provider) = LocalEmbeddingProvider::open(LocalEmbeddingOptions::new(model_cache))
        {
            tools = tools.with_embedding_provider(Arc::new(provider));
        }
    }
    let tools = Arc::new(tools);
    let server = castle_mcp::CastleMcpServer::new(tools);
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .context("Castle could not start the MCP runtime")?;
    runtime.block_on(server.serve_stdio())
}

fn run_index_build(paths: IndexPaths) -> Result<()> {
    let (library, repository) = configured_paths(paths.library, paths.repository)?;
    let publisher = index_publisher(&IndexLocation {
        library: Some(library.clone()),
        indexes: paths.indexes,
        library_key: paths.library_key,
    })?;
    let compilation = compile_library(&CompileOptions::new(&library, &repository))
        .with_context(|| format!("Castle could not compile {}", library.display()))?;
    let result = publisher.publish(&castle_core::build_index_projection(&compilation))?;
    println!("{}", serde_json::to_string_pretty(&result)?);
    Ok(())
}

fn run_index_verify(location: IndexLocation) -> Result<()> {
    let manifest = index_publisher(&location)?.verify_current()?;
    println!("{}", serde_json::to_string_pretty(&manifest)?);
    Ok(())
}

fn run_index_status(location: IndexLocation) -> Result<()> {
    let status = index_publisher(&location)?.status()?;
    println!("{}", serde_json::to_string_pretty(&status)?);
    Ok(())
}

fn index_publisher(location: &IndexLocation) -> Result<IndexPublisher> {
    let library = configured_library(location.library.clone())?;
    let library_key = match &location.library_key {
        Some(value) => value.clone(),
        None => create_library_key(&library)?,
    };
    IndexPublisher::new(IndexPublisherOptions {
        indexes_root: location.indexes.clone(),
        library_key,
    })
}

fn mcp_model_cache(indexes_root: &Path) -> PathBuf {
    if indexes_root
        .file_name()
        .is_some_and(|name| name == "indexes")
    {
        return indexes_root.parent().unwrap_or(indexes_root).join("models");
    }
    indexes_root.join("models")
}

fn run_index_probe(paths: IndexProbePaths) -> Result<()> {
    let report = run_capability_probe(&paths.database)?;
    println!("{}", serde_json::to_string_pretty(&report)?);
    Ok(())
}

fn run_daemon(paths: DaemonPaths) -> Result<()> {
    let (library, repository) = configured_paths(paths.library, paths.repository)?;
    let library_root = library
        .canonicalize()
        .with_context(|| format!("could not resolve Castle library {}", library.display()))?;
    let cache_root = paths.cache;
    let publisher = Arc::new(IndexPublisher::new(IndexPublisherOptions {
        indexes_root: cache_root.join("knowledge/indexes"),
        library_key: create_library_key(&library_root)?,
    })?);
    let local_embedding_options = LocalEmbeddingOptions::new(cache_root.join("knowledge/models"));
    let embedding_runtime = EmbeddingRuntime::start(
        publisher.as_ref().clone(),
        EmbeddingCache::new(cache_root.join("knowledge/embedding_cache/embeddings.db")),
        local_embedding_metadata(local_embedding_options.maximum_batch_size),
        EmbeddingSyncOptions::default(),
        move || {
            Ok(
                Arc::new(LocalEmbeddingProvider::open(local_embedding_options)?)
                    as Arc<dyn EmbeddingProvider>,
            )
        },
    )?;
    let service = Arc::new(Mutex::new(CastleService::open(ServiceOptions {
        library_root: library_root.clone(),
        repository_root: repository,
        cache_root,
    })?));
    let writer = Arc::new(Mutex::new(BufWriter::new(std::io::stdout())));
    let running = Arc::new(AtomicBool::new(true));
    let index_status = Arc::new(Mutex::new(building_index_status(&publisher)?));
    emit(
        &writer,
        &json!({
            "event": "ready",
            "data": service.lock().map_err(lock_error)?.state(),
        }),
    )?;

    let (index_sender, index_receiver) = mpsc::channel::<Option<IndexProjection>>();
    let index_publisher = Arc::clone(&publisher);
    let index_writer = Arc::clone(&writer);
    let indexer_status = Arc::clone(&index_status);
    let indexer_embedding_runtime = embedding_runtime.clone();
    let indexer = thread::spawn(move || -> Result<()> {
        while let Ok(Some(mut projection)) = index_receiver.recv() {
            loop {
                match index_receiver.try_recv() {
                    Ok(Some(next)) => projection = next,
                    Ok(None) | Err(TryRecvError::Disconnected) => return Ok(()),
                    Err(TryRecvError::Empty) => break,
                }
            }
            *indexer_status.lock().map_err(lock_error)? = building_index_status(&index_publisher)?;
            match index_publisher.publish(&projection) {
                Ok(result) => {
                    *indexer_status.lock().map_err(lock_error)? = index_publisher.status()?;
                    if let Err(reason) = indexer_embedding_runtime.schedule(projection) {
                        let _ = emit(
                            &index_writer,
                            &json!({ "event": "embeddingError", "error": rpc_error(&reason) }),
                        );
                    }
                    let _ = emit(
                        &index_writer,
                        &json!({ "event": "indexChanged", "data": result }),
                    );
                }
                Err(reason) => {
                    let previous = index_publisher.status()?;
                    *indexer_status.lock().map_err(lock_error)? = IndexStatus {
                        state: if previous.manifest.is_some() {
                            "stale"
                        } else {
                            "unavailable"
                        },
                        message: Some(format!("{reason:#}")),
                        ..previous
                    };
                    let _ = emit(
                        &index_writer,
                        &json!({ "event": "indexError", "error": rpc_error(&reason) }),
                    );
                }
            }
        }
        Ok(())
    });
    let initial_projection = service.lock().map_err(lock_error)?.index_projection();
    let current_index = publisher.status()?;
    let index_is_current = current_index.manifest.as_ref().is_some_and(|manifest| {
        manifest.source_fingerprint == initial_projection.source_fingerprint
    });
    let semantic_is_current = current_index
        .manifest
        .as_ref()
        .is_some_and(|manifest| manifest.semantic_available);
    if index_is_current {
        *index_status.lock().map_err(lock_error)? = current_index;
        if !semantic_is_current {
            embedding_runtime.schedule(initial_projection)?;
        }
    } else {
        index_sender.send(Some(initial_projection))?;
    }

    let source_generation = Arc::new(AtomicU64::new(0));
    let (publication_sender, publication_receiver) = mpsc::channel::<Option<PublicationRequest>>();
    let publication_service = Arc::clone(&service);
    let publication_writer = Arc::clone(&writer);
    let publication_index_sender = index_sender.clone();
    let publication_generation = Arc::clone(&source_generation);
    let publication = thread::spawn(move || -> Result<()> {
        while let Ok(Some(mut request)) = publication_receiver.recv() {
            loop {
                match publication_receiver.recv_timeout(PUBLICATION_DEBOUNCE) {
                    Ok(Some(next)) => request.merge(next),
                    Ok(None) | Err(RecvTimeoutError::Disconnected) => return Ok(()),
                    Err(RecvTimeoutError::Timeout) => break,
                }
            }

            loop {
                if std::env::var_os("CASTLE_PROFILE_MUTATIONS").is_some() {
                    eprintln!(
                        "[castle:compile-profile] publication generation={} full_compile={} full_snapshot={} changed_sources={}",
                        request.generation,
                        request.full_compile,
                        request.full_snapshot,
                        request.changed_source_files.len(),
                    );
                }
                let (compile_options, snapshot_options, previous_compilation) = {
                    let service = publication_service.lock().map_err(lock_error)?;
                    let (compile_options, snapshot_options) = service.publication_options();
                    (
                        compile_options,
                        snapshot_options,
                        service.publication_compilation(),
                    )
                };
                let changed_source_files = request
                    .changed_source_files
                    .iter()
                    .cloned()
                    .collect::<Vec<_>>();
                let use_incremental = !request.full_compile && !changed_source_files.is_empty();
                let first_attempt = if use_incremental {
                    compile_changed_sources(&previous_compilation, &changed_source_files)
                } else {
                    compile_library(&compile_options)
                };
                let compilation = match first_attempt.or_else(|incremental_reason| {
                    if !use_incremental {
                        return Err(incremental_reason);
                    }
                    if std::env::var_os("CASTLE_PROFILE_MUTATIONS").is_some() {
                        eprintln!(
                            "[castle:compile-profile] incremental_fallback={incremental_reason:#}"
                        );
                    }
                    compile_library(&compile_options)
                }) {
                    Ok(compilation) => compilation,
                    Err(reason) => {
                        let _ = emit(
                            &publication_writer,
                            &json!({ "event": "snapshotError", "error": rpc_error(&reason) }),
                        );
                        break;
                    }
                };
                let current_generation = publication_generation.load(Ordering::Acquire);
                if current_generation != request.generation {
                    request.generation = current_generation;
                    request.full_compile = true;
                    request.changed_source_files.clear();
                    continue;
                }
                let delta = publication_service
                    .lock()
                    .map_err(lock_error)?
                    .compilation_delta(&compilation)?;
                let snapshot_delta = SnapshotDelta {
                    changed_note_ids: delta
                        .notes
                        .upserted
                        .iter()
                        .map(|note| note.id.clone())
                        .collect(),
                    search_index_changed: delta
                        .mutable_resource_paths
                        .iter()
                        .any(|path| path == "/generated/search-index.json"),
                    relationship_graph_changed: delta
                        .mutable_resource_paths
                        .iter()
                        .any(|path| path == "/generated/relationship-graph.json"),
                    sync_assets: false,
                };
                let content_delta_emitted = if request.full_snapshot {
                    false
                } else {
                    if let Err(reason) = write_incremental_note_resources(
                        &compilation,
                        &snapshot_options,
                        &snapshot_delta.changed_note_ids,
                    ) {
                        let _ = emit(
                            &publication_writer,
                            &json!({ "event": "snapshotError", "error": rpc_error(&reason) }),
                        );
                        break;
                    }
                    let current_generation = publication_generation.load(Ordering::Acquire);
                    if current_generation != request.generation {
                        request.generation = current_generation;
                        request.full_compile = true;
                        request.changed_source_files.clear();
                        continue;
                    }
                    emit(
                        &publication_writer,
                        &json!({
                            "event": "contentDelta",
                            "data": delta,
                            "sourceGeneration": request.generation,
                        }),
                    )?;
                    true
                };
                let snapshot_result = if request.full_snapshot {
                    write_snapshot(&compilation, &snapshot_options)
                } else {
                    write_incremental_snapshot(&compilation, &snapshot_options, &snapshot_delta)
                };
                if let Err(reason) = snapshot_result {
                    let _ = emit(
                        &publication_writer,
                        &json!({ "event": "snapshotError", "error": rpc_error(&reason) }),
                    );
                    break;
                }
                let mut service = publication_service.lock().map_err(lock_error)?;
                let current_generation = publication_generation.load(Ordering::Acquire);
                if current_generation != request.generation {
                    drop(service);
                    request.generation = current_generation;
                    request.full_compile = true;
                    request.changed_source_files.clear();
                    continue;
                }
                let state = service.adopt_publication(compilation)?;
                let published_compilation = service.publication_compilation();
                drop(service);
                if !content_delta_emitted {
                    emit(
                        &publication_writer,
                        &json!({
                            "event": "contentDelta",
                            "data": delta,
                            "sourceGeneration": request.generation,
                        }),
                    )?;
                }
                emit(
                    &publication_writer,
                    &json!({
                        "event": "snapshotChanged",
                        "data": state,
                        "sourceGeneration": request.generation,
                    }),
                )?;
                let projection = build_index_projection(&published_compilation);
                let _ = publication_index_sender.send(Some(projection));
                break;
            }
        }
        Ok(())
    });

    let watcher_service = Arc::clone(&service);
    let watcher_writer = Arc::clone(&writer);
    let watcher_running = Arc::clone(&running);
    let watcher_publication_sender = publication_sender.clone();
    let watcher_generation = Arc::clone(&source_generation);
    let watcher = thread::spawn(move || -> Result<()> {
        let (event_sender, event_receiver) = mpsc::channel();
        let mut file_watcher = notify::recommended_watcher(move |result| {
            let _ = event_sender.send(result);
        })?;
        file_watcher.watch(&library_root, RecursiveMode::Recursive)?;

        let mut refresh_deadline = None;
        let mut refresh_full_snapshot = false;
        let mut refresh_source_files = BTreeSet::new();
        let mut fallback_deadline = Instant::now() + WATCH_FALLBACK_SCAN;
        while watcher_running.load(Ordering::Acquire) {
            let now = Instant::now();
            let wait = refresh_deadline
                .map(|deadline: Instant| deadline.saturating_duration_since(now))
                .unwrap_or(WATCH_IDLE_TICK)
                .min(WATCH_IDLE_TICK);
            match event_receiver.recv_timeout(wait) {
                Ok(Ok(event)) if is_library_content_event(&event, &library_root) => {
                    refresh_full_snapshot |= event_requires_full_snapshot(&event, &library_root);
                    refresh_source_files.extend(event_markdown_source_files(&event, &library_root));
                    refresh_deadline = Some(Instant::now() + WATCH_DEBOUNCE);
                }
                Ok(Ok(_)) => {}
                Ok(Err(reason)) => {
                    let reason = anyhow!(reason);
                    let _ = emit(
                        &watcher_writer,
                        &json!({
                            "event": "snapshotError",
                            "error": rpc_error(&reason),
                        }),
                    );
                }
                Err(RecvTimeoutError::Timeout) => {}
                Err(RecvTimeoutError::Disconnected) => {
                    bail!("Castle filesystem watcher stopped unexpectedly");
                }
            }

            let now = Instant::now();
            let content_changed = refresh_deadline.is_some_and(|deadline| now >= deadline);
            let fallback_scan_due = now >= fallback_deadline;
            if !content_changed && !fallback_scan_due {
                continue;
            }

            refresh_deadline = None;
            fallback_deadline = now + WATCH_FALLBACK_SCAN;
            let should_publish = if content_changed {
                Ok(true)
            } else {
                watcher_service
                    .lock()
                    .map_err(lock_error)
                    .and_then(|service| service.library_changed_since_publication())
            };
            match should_publish {
                Ok(true) => {
                    let generation = watcher_generation.fetch_add(1, Ordering::AcqRel) + 1;
                    let full_snapshot = refresh_full_snapshot || fallback_scan_due;
                    let changed_source_files = std::mem::take(&mut refresh_source_files);
                    let _ = watcher_publication_sender.send(Some(PublicationRequest {
                        generation,
                        full_snapshot,
                        full_compile: full_snapshot || changed_source_files.is_empty(),
                        changed_source_files,
                    }));
                }
                Ok(false) => {}
                Err(reason) => {
                    let _ = emit(
                        &watcher_writer,
                        &json!({
                            "event": "snapshotError",
                            "error": rpc_error(&reason),
                        }),
                    );
                }
            }
            refresh_full_snapshot = false;
            refresh_source_files.clear();
        }
        Ok(())
    });

    let stdin = std::io::stdin();
    for line in BufReader::new(stdin.lock()).lines() {
        let line = line?;
        if line.trim().is_empty() {
            continue;
        }
        let request = match serde_json::from_str::<Value>(&line) {
            Ok(Value::Object(request)) => request,
            Ok(_) => {
                emit(
                    &writer,
                    &json!({ "id": null, "error": { "code": "INVALID_REQUEST", "message": "Castle received an invalid native request." } }),
                )?;
                continue;
            }
            Err(reason) => {
                emit(
                    &writer,
                    &json!({ "id": null, "error": { "code": "INVALID_JSON", "message": reason.to_string() } }),
                )?;
                continue;
            }
        };
        let id = request.get("id").cloned().unwrap_or(Value::Null);
        if request.get("protocolVersion").and_then(Value::as_u64)
            != Some(castle_contracts::RPC_PROTOCOL_VERSION.into())
        {
            emit(
                &writer,
                &json!({ "id": id, "error": { "code": "CASTLE_PROTOCOL_MISMATCH", "message": "Castle received an incompatible native protocol request.", "retryable": false } }),
            )?;
            continue;
        }
        let method = request.get("method").and_then(Value::as_str).unwrap_or("");
        let params = request.get("params").cloned().unwrap_or_else(|| json!({}));
        if method == "shutdown" {
            emit(&writer, &json!({ "id": id, "result": { "ok": true } }))?;
            running.store(false, Ordering::Release);
            break;
        }
        let requested_revision = params
            .get("expectedRevision")
            .and_then(Value::as_str)
            .map(str::to_owned);
        let (mut result, generation) = service.lock().map_err(lock_error).map(|mut service| {
            let result = handle_request(
                &mut service,
                &publisher,
                &index_status,
                &embedding_runtime,
                method,
                params,
            );
            let generation = result
                .as_ref()
                .ok()
                .filter(|result| {
                    source_mutation_changed(method, requested_revision.as_deref(), result)
                })
                .map(|_| source_generation.fetch_add(1, Ordering::AcqRel) + 1);
            (result, generation)
        })?;
        let change_event = generation.and_then(|generation| {
            is_source_mutation(method).then(|| {
                result
                    .as_mut()
                    .ok()
                    .and_then(|result| attach_source_change(method, generation, result))
            })?
        });
        if let Some(generation) = generation {
            let source_file = result
                .as_ref()
                .ok()
                .and_then(result_source)
                .and_then(|result| result.get("sourceFile"))
                .and_then(Value::as_str)
                .map(str::to_owned);
            let incremental = matches!(method, "saveSource" | "mutateTask" | "updatePerson")
                && source_file.is_some();
            let _ = publication_sender.send(Some(PublicationRequest {
                generation,
                full_snapshot: false,
                full_compile: !incremental,
                changed_source_files: source_file.into_iter().collect(),
            }));
        }
        match result {
            Ok(result) => {
                emit(&writer, &json!({ "id": id, "result": result }))?;
                if let Some(change_event) = change_event {
                    emit(
                        &writer,
                        &json!({ "event": "sourceChanged", "data": change_event }),
                    )?;
                }
            }
            Err(reason) => emit(&writer, &json!({ "id": id, "error": rpc_error(&reason) }))?,
        }
    }
    running.store(false, Ordering::Release);
    let _ = publication_sender.send(None);
    watcher
        .join()
        .map_err(|_| anyhow!("Castle native watcher stopped unexpectedly"))??;
    publication
        .join()
        .map_err(|_| anyhow!("Castle native publisher stopped unexpectedly"))??;
    let _ = index_sender.send(None);
    indexer
        .join()
        .map_err(|_| anyhow!("Castle native indexer stopped unexpectedly"))??;
    embedding_runtime.shutdown()?;
    Ok(())
}

fn is_library_content_event(event: &Event, library_root: &Path) -> bool {
    if matches!(event.kind, EventKind::Access(_)) {
        return false;
    }

    event.paths.iter().any(|path| {
        let Ok(relative) = path.strip_prefix(library_root) else {
            return false;
        };
        relative.components().all(|component| {
            let name = component.as_os_str().to_string_lossy();
            !name.starts_with('.')
        })
    })
}

fn event_requires_full_snapshot(event: &Event, library_root: &Path) -> bool {
    event.paths.iter().any(|path| {
        let Ok(relative) = path.strip_prefix(library_root) else {
            return false;
        };
        if relative
            .components()
            .any(|component| component.as_os_str().to_string_lossy().starts_with('.'))
        {
            return false;
        }
        matches!(
            path.extension().and_then(|extension| extension.to_str()),
            Some(extension) if !matches!(extension, "md" | "mdx")
        )
    })
}

fn event_markdown_source_files(event: &Event, library_root: &Path) -> Vec<String> {
    event
        .paths
        .iter()
        .filter_map(|path| {
            let relative = path.strip_prefix(library_root).ok()?;
            if relative
                .components()
                .any(|component| component.as_os_str().to_string_lossy().starts_with('.'))
            {
                return None;
            }
            matches!(
                path.extension().and_then(|extension| extension.to_str()),
                Some("md" | "mdx")
            )
            .then(|| relative.to_string_lossy().replace('\\', "/"))
        })
        .collect()
}

fn handle_request(
    service: &mut CastleService,
    publisher: &IndexPublisher,
    index_status: &Arc<Mutex<IndexStatus>>,
    embedding_runtime: &EmbeddingRuntime,
    method: &str,
    params: Value,
) -> Result<Value> {
    match method {
        "getState" => Ok(serde_json::to_value(service.state())?),
        "readSource" => {
            let note_id = params
                .get("noteId")
                .and_then(Value::as_str)
                .ok_or_else(|| anyhow!("Castle rejected an invalid note ID."))?;
            Ok(serde_json::to_value(service.read_source(note_id)?)?)
        }
        "saveSource" => Ok(serde_json::to_value(
            service.commit_save_source(serde_json::from_value::<SaveSourceInput>(params)?)?,
        )?),
        "moveSource" => Ok(serde_json::to_value(
            service.commit_move_source(serde_json::from_value::<MoveSourceInput>(params)?)?,
        )?),
        "createSource" => Ok(serde_json::to_value(service.commit_create_source(
            serde_json::from_value::<CreateSourceInput>(params)?,
        )?)?),
        "createFolder" => Ok(serde_json::to_value(service.commit_create_folder(
            serde_json::from_value::<CreateFolderInput>(params)?,
        )?)?),
        "deleteSource" => Ok(serde_json::to_value(service.commit_delete_source(
            serde_json::from_value::<DeleteSourceInput>(params)?,
        )?)?),
        "deleteFolder" => Ok(serde_json::to_value(service.commit_delete_folder(
            serde_json::from_value::<DeleteFolderInput>(params)?,
        )?)?),
        "restoreSource" => Ok(serde_json::to_value(service.commit_restore_source(
            serde_json::from_value::<RestoreSourceInput>(params)?,
        )?)?),
        "mutateTask" => Ok(serde_json::to_value(
            service.mutate_task(serde_json::from_value::<MutateTaskInput>(params)?)?,
        )?),
        "createTask" => Ok(serde_json::to_value(
            service.create_task(serde_json::from_value::<CreateTaskInput>(params)?)?,
        )?),
        "deleteTask" => Ok(serde_json::to_value(
            service.delete_task(serde_json::from_value::<DeleteTaskInput>(params)?)?,
        )?),
        "restoreTask" => Ok(serde_json::to_value(
            service.restore_task(serde_json::from_value::<RestoreTaskInput>(params)?)?,
        )?),
        "updatePerson" => Ok(serde_json::to_value(
            service.update_person(serde_json::from_value::<UpdatePersonInput>(params)?)?,
        )?),
        "refresh" => Ok(serde_json::to_value(service.refresh()?)?),
        "getIndexStatus" => daemon_index_status(publisher, index_status, embedding_runtime),
        "searchKnowledge" => Ok(serde_json::to_value(daemon_search(
            publisher,
            embedding_runtime,
            serde_json::from_value::<SearchRequest>(params)?,
        )?)?),
        "readNoteContext" => Ok(serde_json::to_value(
            daemon_tools(publisher)?
                .read_note(serde_json::from_value::<NoteContextRequest>(params)?)?,
        )?),
        "relatedNotes" => Ok(serde_json::to_value(
            daemon_tools(publisher)?
                .related_notes(serde_json::from_value::<RelatedNotesRequest>(params)?)?,
        )?),
        "queryTasks" => Ok(serde_json::to_value(
            TursoKnowledgeIndex::open(publisher)?.query_entities(
                EntityKind::Task,
                serde_json::from_value::<EntityQuery>(params)?,
            )?,
        )?),
        "queryEvents" => Ok(serde_json::to_value(
            TursoKnowledgeIndex::open(publisher)?.query_entities(
                EntityKind::Event,
                serde_json::from_value::<EntityQuery>(params)?,
            )?,
        )?),
        "listProjects" => Ok(serde_json::to_value(
            TursoKnowledgeIndex::open(publisher)?.query_entities(
                EntityKind::Project,
                serde_json::from_value::<EntityQuery>(params)?,
            )?,
        )?),
        "queryPeople" => Ok(serde_json::to_value(
            TursoKnowledgeIndex::open(publisher)?.query_entities(
                EntityKind::Person,
                serde_json::from_value::<EntityQuery>(params)?,
            )?,
        )?),
        "queryRelationships" => Ok(serde_json::to_value(
            TursoKnowledgeIndex::open(publisher)?.query_entities(
                EntityKind::Relationship,
                serde_json::from_value::<EntityQuery>(params)?,
            )?,
        )?),
        "getKnowledgeOverview" => Ok(serde_json::to_value(
            TursoKnowledgeIndex::open(publisher)?.knowledge_overview()?,
        )?),
        "getRelationshipGraph" => {
            Ok(TursoKnowledgeIndex::open(publisher)?.read_domain_document("relationship_graph")?)
        }
        "cancelRequest" => Ok(json!({ "cancelled": false })),
        _ => bail!("Castle received an unknown native method: {method}"),
    }
}

fn building_index_status(publisher: &IndexPublisher) -> Result<IndexStatus> {
    let previous = publisher.status()?;
    Ok(IndexStatus {
        state: "building",
        message: Some("Castle is publishing a newer immutable index generation".to_owned()),
        ..previous
    })
}

fn daemon_tools(publisher: &IndexPublisher) -> Result<CastleToolService> {
    Ok(CastleToolService::new(Arc::new(TursoKnowledgeIndex::open(
        publisher,
    )?)))
}

fn daemon_search(
    publisher: &IndexPublisher,
    embedding_runtime: &EmbeddingRuntime,
    request: SearchRequest,
) -> Result<castle_index::SearchResponse> {
    let index = Arc::new(TursoKnowledgeIndex::open(publisher)?);
    let mut tools = CastleToolService::new(index);
    if let Some(provider) = embedding_runtime.provider()? {
        tools = tools.with_embedding_provider(provider);
    }
    tools.search_knowledge(request)
}

fn daemon_index_status(
    publisher: &IndexPublisher,
    index_status: &Arc<Mutex<IndexStatus>>,
    embedding_runtime: &EmbeddingRuntime,
) -> Result<Value> {
    let cached = index_status.lock().map_err(lock_error)?.clone();
    let current = if matches!(cached.state, "ready" | "degraded") {
        publisher.status().unwrap_or(cached)
    } else {
        cached
    };
    let mut value = serde_json::to_value(current)?;
    value
        .as_object_mut()
        .ok_or_else(|| anyhow!("Castle generated an invalid index status"))?
        .insert(
            "embedding".to_owned(),
            serde_json::to_value(embedding_runtime.status()?)?,
        );
    Ok(value)
}

fn source_mutation_changed(method: &str, requested_revision: Option<&str>, result: &Value) -> bool {
    match method {
        "saveSource" => result
            .get("revision")
            .and_then(Value::as_str)
            .is_some_and(|revision| Some(revision) != requested_revision),
        "createSource" | "createFolder" | "moveSource" | "deleteSource" | "deleteFolder"
        | "restoreSource" | "mutateTask" | "createTask" | "deleteTask" | "restoreTask"
        | "updatePerson" => true,
        _ => false,
    }
}

fn is_source_mutation(method: &str) -> bool {
    matches!(
        method,
        "saveSource"
            | "createSource"
            | "moveSource"
            | "deleteSource"
            | "restoreSource"
            | "mutateTask"
            | "createTask"
            | "deleteTask"
            | "restoreTask"
            | "updatePerson"
    )
}

fn attach_source_change(method: &str, generation: u64, result: &mut Value) -> Option<Value> {
    let result = result_source_mut(result)?;
    result.insert("sourceGeneration".to_owned(), json!(generation));
    result.insert("publicationPending".to_owned(), Value::Bool(true));
    Some(json!({
        "sourceGeneration": generation,
        "operation": method,
        "noteId": result.get("noteId").and_then(Value::as_str).unwrap_or(""),
        "sourceFile": result.get("sourceFile").and_then(Value::as_str).unwrap_or(""),
        "revision": result.get("revision").and_then(Value::as_str).unwrap_or(""),
        "trashId": result.get("trashId").and_then(Value::as_str).unwrap_or(""),
    }))
}

fn result_source(result: &Value) -> Option<&serde_json::Map<String, Value>> {
    let result = result.as_object()?;
    result
        .get("source")
        .and_then(Value::as_object)
        .or(Some(result))
}

fn result_source_mut(result: &mut Value) -> Option<&mut serde_json::Map<String, Value>> {
    let result = result.as_object_mut()?;
    if result.contains_key("source") {
        result.get_mut("source")?.as_object_mut()
    } else {
        Some(result)
    }
}

fn rpc_error(reason: &anyhow::Error) -> Value {
    json!({
        "code": if reason.downcast_ref::<SourceConflict>().is_some() {
            "CASTLE_SOURCE_CONFLICT"
        } else {
            "CASTLE_NATIVE_ERROR"
        },
        "message": reason.to_string(),
        "retryable": false,
    })
}

fn emit(writer: &Arc<Mutex<BufWriter<std::io::Stdout>>>, value: &Value) -> Result<()> {
    let mut writer = writer.lock().map_err(lock_error)?;
    let mut envelope = value.clone();
    envelope
        .as_object_mut()
        .ok_or_else(|| anyhow!("Castle native envelope must be an object"))?
        .insert(
            "protocolVersion".to_owned(),
            castle_contracts::RPC_PROTOCOL_VERSION.into(),
        );
    serde_json::to_writer(&mut *writer, &envelope)?;
    writer.write_all(b"\n")?;
    writer.flush()?;
    Ok(())
}

fn lock_error<T>(_: std::sync::PoisonError<T>) -> anyhow::Error {
    anyhow!(
        "Castle native service lock was poisoned (pid {})",
        process::id()
    )
}

fn run(paths: Paths, write: bool) -> Result<()> {
    let (library, repository) = configured_paths(paths.library, paths.repository)?;
    let compilation = compile_library(&CompileOptions::new(&library, &repository))
        .with_context(|| format!("Castle could not compile {}", library.display()))?;
    if write {
        write_snapshot(
            &compilation,
            &SnapshotOptions {
                generated_path: paths.generated,
                public_root: paths.public,
            },
        )?;
    }
    for diagnostic in &compilation.diagnostics.obsidian {
        let target = diagnostic["target"].as_str().unwrap_or("");
        eprintln!(
            "- {}:{}:{} [{}] {} Target: \"{}\".",
            diagnostic["sourceFile"].as_str().unwrap_or("unknown"),
            diagnostic["line"].as_u64().unwrap_or_default(),
            diagnostic["column"].as_u64().unwrap_or_default(),
            diagnostic["kind"].as_str().unwrap_or("unknown"),
            diagnostic["message"].as_str().unwrap_or(""),
            if target.is_empty() { "(empty)" } else { target },
        );
    }
    for warning in &compilation.diagnostics.record_warnings {
        eprintln!("Castle Record warning: {warning}");
    }
    let stats = compilation.stats;
    println!(
        "{} {} notes across {} sections, {} records, {} projects, {} tasks, {} relationship nodes, and {} calendar events; converted {} Obsidian links and embeds.",
        if write { "Generated" } else { "Validated" },
        stats.note_count,
        stats.section_count,
        stats.record_count,
        stats.project_count,
        stats.task_count,
        stats.relationship_node_count,
        stats.calendar_event_count,
        stats.obsidian_replacement_count,
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{event_requires_full_snapshot, is_library_content_event, mcp_model_cache};
    use notify::{
        Event, EventKind,
        event::{AccessKind, ModifyKind},
    };
    use std::path::Path;

    #[test]
    fn watcher_ignores_access_hidden_and_external_paths() {
        let root = Path::new("/tmp/castle-library");
        let content =
            Event::new(EventKind::Modify(ModifyKind::Any)).add_path(root.join("notes/example.md"));
        let hidden = Event::new(EventKind::Modify(ModifyKind::Any))
            .add_path(root.join(".castle/trash/example.md"));
        let access =
            Event::new(EventKind::Access(AccessKind::Any)).add_path(root.join("notes/example.md"));
        let external = Event::new(EventKind::Modify(ModifyKind::Any))
            .add_path(Path::new("/tmp/other/example.md").to_owned());

        assert!(is_library_content_event(&content, root));
        assert!(!is_library_content_event(&hidden, root));
        assert!(!is_library_content_event(&access, root));
        assert!(!is_library_content_event(&external, root));
    }

    #[test]
    fn watcher_syncs_assets_without_treating_directory_events_as_assets() {
        let root = Path::new("/tmp/castle-library");
        let directory = Event::new(EventKind::Modify(ModifyKind::Any)).add_path(root.join("notes"));
        let markdown =
            Event::new(EventKind::Modify(ModifyKind::Any)).add_path(root.join("notes/example.md"));
        let asset = Event::new(EventKind::Modify(ModifyKind::Any))
            .add_path(root.join("assets/example.png"));

        assert!(!event_requires_full_snapshot(&directory, root));
        assert!(!event_requires_full_snapshot(&markdown, root));
        assert!(event_requires_full_snapshot(&asset, root));
    }

    #[test]
    fn mcp_reuses_the_desktop_model_cache_next_to_knowledge_indexes() {
        assert_eq!(
            mcp_model_cache(Path::new("/private/castle/knowledge/indexes")),
            Path::new("/private/castle/knowledge/models")
        );
        assert_eq!(
            mcp_model_cache(Path::new("/private/custom")),
            Path::new("/private/custom/models")
        );
    }
}
