mod library_registry;

use std::{
    collections::HashMap,
    ops::Deref,
    path::{Path, PathBuf},
    sync::{
        Arc,
        atomic::{AtomicU64, Ordering},
        mpsc::{self, Receiver, RecvTimeoutError, Sender, SyncSender},
    },
    thread,
    time::{Duration, Instant},
};

use anyhow::{Context, Result, anyhow};
pub use castle_contracts::{
    CatalogNote, KnowledgeBase, LibraryFolder, SaveSourceInput, SaveSourceResult, SectionSummary,
    SourceDocument,
};
use castle_contracts::{
    CompilationDelta, CreateFolderInput, CreateFolderResult, CreateSourceInput, CreateTaskInput,
    DeleteFolderInput, DeleteFolderResult, DeleteSourceInput, DeleteSourceResult, DeleteTaskInput,
    DeleteTaskResult, MoveSourceInput, MoveSourceResult, MutateTaskInput, PersonMutationResult,
    RestoreSourceInput, RestoreTaskInput, ServiceState, TaskMutationResult, UpdatePersonInput,
};
use castle_core::{CastleCompilation, CastleService, ServiceOptions};
use notify::{Event, EventKind, RecursiveMode, Watcher};

pub use castle_core::{BacklinkGroup, BacklinkOccurrence, Heading, NoteContent};
pub use library_registry::{LibraryRegistry, RecentLibrary};

const COMMAND_CAPACITY: usize = 64;
const EVENT_CAPACITY: usize = 64;
const WATCH_DEBOUNCE: Duration = Duration::from_millis(100);
const WATCH_IDLE_TICK: Duration = Duration::from_millis(500);
#[cfg(not(test))]
const WATCH_FALLBACK_SCAN: Duration = Duration::from_secs(30);
#[cfg(test)]
const WATCH_FALLBACK_SCAN: Duration = Duration::from_secs(1);
static NEXT_SESSION_EPOCH: AtomicU64 = AtomicU64::new(1);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct SessionEpoch(u64);

impl SessionEpoch {
    pub fn next() -> Self {
        Self(NEXT_SESSION_EPOCH.fetch_add(1, Ordering::Relaxed))
    }

    pub fn get(self) -> u64 {
        self.0
    }
}

#[derive(Debug, Clone)]
pub struct LibrarySessionOptions {
    pub library_root: PathBuf,
    pub repository_root: PathBuf,
    pub cache_root: PathBuf,
}

impl LibrarySessionOptions {
    pub fn new(
        library_root: impl Into<PathBuf>,
        repository_root: impl Into<PathBuf>,
        cache_root: impl Into<PathBuf>,
    ) -> Self {
        Self {
            library_root: library_root.into(),
            repository_root: repository_root.into(),
            cache_root: cache_root.into(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
struct DirectoryKey {
    section: String,
    directory: Vec<String>,
}

#[derive(Debug)]
pub struct AppSnapshot {
    epoch: SessionEpoch,
    compilation: Arc<CastleCompilation>,
    note_indexes_by_id: HashMap<String, usize>,
    note_indexes_by_route: HashMap<String, usize>,
    note_resource_indexes_by_id: HashMap<String, usize>,
    note_indexes_by_directory: HashMap<DirectoryKey, Vec<usize>>,
    folder_indexes_by_directory: HashMap<DirectoryKey, Vec<usize>>,
}

impl AppSnapshot {
    pub fn new(epoch: SessionEpoch, compilation: Arc<CastleCompilation>) -> Self {
        let note_indexes_by_id = compilation
            .knowledge_base
            .notes
            .iter()
            .enumerate()
            .map(|(index, note)| (note.id.clone(), index))
            .collect();
        let note_indexes_by_route = compilation
            .knowledge_base
            .notes
            .iter()
            .enumerate()
            .map(|(index, note)| (note.route.clone(), index))
            .collect();
        let note_resource_indexes_by_id = compilation
            .note_resources
            .iter()
            .enumerate()
            .map(|(index, resource)| (resource.content.id.clone(), index))
            .collect();

        let mut note_indexes_by_directory = HashMap::<DirectoryKey, Vec<usize>>::new();
        for (index, note) in compilation.knowledge_base.notes.iter().enumerate() {
            note_indexes_by_directory
                .entry(DirectoryKey {
                    section: note.section.clone(),
                    directory: note_directory(note),
                })
                .or_default()
                .push(index);
        }

        let mut folder_indexes_by_directory = HashMap::<DirectoryKey, Vec<usize>>::new();
        for (index, folder) in compilation.knowledge_base.folders.iter().enumerate() {
            let parent = folder
                .directory
                .get(..folder.directory.len().saturating_sub(1))
                .unwrap_or_default()
                .to_vec();
            folder_indexes_by_directory
                .entry(DirectoryKey {
                    section: folder.section_id.clone(),
                    directory: parent,
                })
                .or_default()
                .push(index);
        }

        Self {
            epoch,
            compilation,
            note_indexes_by_id,
            note_indexes_by_route,
            note_resource_indexes_by_id,
            note_indexes_by_directory,
            folder_indexes_by_directory,
        }
    }

    pub fn epoch(&self) -> SessionEpoch {
        self.epoch
    }

    pub fn library_root(&self) -> &Path {
        &self.compilation.library_root
    }

    pub fn repository_root(&self) -> &Path {
        &self.compilation.repository_root
    }

    pub fn note_by_id(&self, note_id: &str) -> Option<&CatalogNote> {
        self.note_indexes_by_id
            .get(note_id)
            .and_then(|index| self.notes.get(*index))
    }

    pub fn note_index_by_id(&self, note_id: &str) -> Option<usize> {
        self.note_indexes_by_id.get(note_id).copied()
    }

    pub fn note_by_route(&self, route: &str) -> Option<&CatalogNote> {
        self.note_indexes_by_route
            .get(route)
            .and_then(|index| self.notes.get(*index))
    }

    pub fn note_markdown(&self, note_index: usize) -> Option<&str> {
        let note = self.notes.get(note_index)?;
        let resource_index = self.note_resource_indexes_by_id.get(&note.id)?;
        self.compilation
            .note_resources
            .get(*resource_index)
            .map(|resource| resource.content.content.as_str())
    }

    pub fn note_content(&self, note_id: &str) -> Option<&NoteContent> {
        let resource_index = self.note_resource_indexes_by_id.get(note_id)?;
        self.compilation
            .note_resources
            .get(*resource_index)
            .map(|resource| &resource.content)
    }

    pub fn asset_path(&self, source: &str) -> Option<PathBuf> {
        let relative = source
            .strip_prefix("/content-assets/")
            .or_else(|| source.strip_prefix('/'))?;
        let relative = decode_asset_path(relative)?;
        let path = self.library_root().join(relative);
        (self.compilation.asset_files.binary_search(&path).is_ok() && path.is_file())
            .then_some(path)
    }

    pub fn notes_in_section(&self, section: Option<&str>) -> Vec<usize> {
        self.notes
            .iter()
            .enumerate()
            .filter(|(_, note)| section.is_none_or(|section| note.section == section))
            .map(|(index, _)| index)
            .collect()
    }

    pub fn notes_in_directory(&self, section: &str, directory: &[String]) -> Vec<usize> {
        self.note_indexes_by_directory
            .get(&DirectoryKey {
                section: section.to_owned(),
                directory: directory.to_vec(),
            })
            .cloned()
            .unwrap_or_default()
    }

    pub fn folders_in_directory(&self, section: &str, directory: &[String]) -> Vec<usize> {
        self.folder_indexes_by_directory
            .get(&DirectoryKey {
                section: section.to_owned(),
                directory: directory.to_vec(),
            })
            .cloned()
            .unwrap_or_default()
    }

    pub fn section(&self, id: &str) -> Option<&SectionSummary> {
        self.sections.iter().find(|section| section.id == id)
    }
}

impl Deref for AppSnapshot {
    type Target = KnowledgeBase;

    fn deref(&self) -> &Self::Target {
        &self.compilation.knowledge_base
    }
}

fn note_directory(note: &CatalogNote) -> Vec<String> {
    let mut parts = note
        .relative_path
        .split('/')
        .map(str::to_owned)
        .collect::<Vec<_>>();
    parts.pop();
    parts
}

fn decode_asset_path(value: &str) -> Option<PathBuf> {
    let mut path = PathBuf::new();
    for component in value.split('/') {
        if component.is_empty() || matches!(component, "." | "..") {
            return None;
        }
        let bytes = component.as_bytes();
        let mut decoded = Vec::with_capacity(bytes.len());
        let mut index = 0;
        while index < bytes.len() {
            if bytes[index] == b'%' {
                let high = *bytes.get(index + 1)?;
                let low = *bytes.get(index + 2)?;
                decoded.push(hex_value(high)? * 16 + hex_value(low)?);
                index += 3;
            } else {
                decoded.push(bytes[index]);
                index += 1;
            }
        }
        let decoded = String::from_utf8(decoded).ok()?;
        if decoded.is_empty()
            || matches!(decoded.as_str(), "." | "..")
            || decoded.contains(['/', '\\'])
        {
            return None;
        }
        path.push(decoded);
    }
    Some(path)
}

fn hex_value(value: u8) -> Option<u8> {
    match value {
        b'0'..=b'9' => Some(value - b'0'),
        b'a'..=b'f' => Some(value - b'a' + 10),
        b'A'..=b'F' => Some(value - b'A' + 10),
        _ => None,
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ServiceStatusKind {
    Opening,
    Ready,
    Stale,
    Unavailable,
    Stopped,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RuntimeServiceStatus {
    pub kind: ServiceStatusKind,
    pub message: String,
    pub generated_at: String,
}

impl RuntimeServiceStatus {
    fn opening() -> Self {
        Self {
            kind: ServiceStatusKind::Opening,
            message: "Castle is opening the library.".into(),
            generated_at: String::new(),
        }
    }

    fn ready(state: &ServiceState) -> Self {
        Self {
            kind: ServiceStatusKind::Ready,
            message: "Castle's native library session is ready.".into(),
            generated_at: state.generated_at.clone(),
        }
    }

    fn failed(kind: ServiceStatusKind, reason: &anyhow::Error) -> Self {
        Self {
            kind,
            message: format!("{reason:#}"),
            generated_at: String::new(),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ContentOperation {
    Refresh,
    SaveSource,
    CreateSource,
    CreateFolder,
    MoveSource,
    DeleteSource,
    DeleteFolder,
    RestoreSource,
    MutateTask,
    CreateTask,
    DeleteTask,
    RestoreTask,
    UpdatePerson,
}

#[derive(Debug, Clone)]
pub enum RuntimeEvent {
    ServiceStatus {
        epoch: SessionEpoch,
        status: RuntimeServiceStatus,
    },
    LibraryReady {
        epoch: SessionEpoch,
        snapshot: Arc<AppSnapshot>,
    },
    ContentChanged {
        epoch: SessionEpoch,
        operation: ContentOperation,
        delta: Box<CompilationDelta>,
        snapshot: Arc<AppSnapshot>,
    },
}

impl RuntimeEvent {
    pub fn epoch(&self) -> SessionEpoch {
        match self {
            Self::ServiceStatus { epoch, .. }
            | Self::LibraryReady { epoch, .. }
            | Self::ContentChanged { epoch, .. } => *epoch,
        }
    }
}

type RuntimeResult<T> = std::result::Result<T, String>;
type Reply<T> = mpsc::Sender<RuntimeResult<T>>;

enum LibraryCommand {
    ReadSource {
        note_id: String,
        reply: Reply<SourceDocument>,
    },
    SaveSource {
        input: SaveSourceInput,
        reply: Reply<SaveSourceResult>,
    },
    CreateSource {
        input: CreateSourceInput,
        reply: Reply<SaveSourceResult>,
    },
    CreateFolder {
        input: CreateFolderInput,
        reply: Reply<CreateFolderResult>,
    },
    MoveSource {
        input: MoveSourceInput,
        reply: Reply<MoveSourceResult>,
    },
    DeleteSource {
        input: DeleteSourceInput,
        reply: Reply<DeleteSourceResult>,
    },
    DeleteFolder {
        input: DeleteFolderInput,
        reply: Reply<DeleteFolderResult>,
    },
    RestoreSource {
        input: RestoreSourceInput,
        reply: Reply<SaveSourceResult>,
    },
    MutateTask {
        input: MutateTaskInput,
        reply: Reply<TaskMutationResult>,
    },
    CreateTask {
        input: CreateTaskInput,
        reply: Reply<TaskMutationResult>,
    },
    DeleteTask {
        input: DeleteTaskInput,
        reply: Reply<DeleteTaskResult>,
    },
    RestoreTask {
        input: RestoreTaskInput,
        reply: Reply<TaskMutationResult>,
    },
    UpdatePerson {
        input: UpdatePersonInput,
        reply: Reply<PersonMutationResult>,
    },
    RefreshExternalChanges {
        reply: Option<Reply<bool>>,
    },
    Shutdown,
}

pub struct LibrarySession {
    epoch: SessionEpoch,
    commands: SyncSender<LibraryCommand>,
    worker: Option<thread::JoinHandle<()>>,
    watcher_stop: Sender<()>,
    watcher: Option<thread::JoinHandle<()>>,
}

#[derive(Clone)]
pub struct LibraryClient {
    epoch: SessionEpoch,
    commands: SyncSender<LibraryCommand>,
}

impl LibraryClient {
    pub fn epoch(&self) -> SessionEpoch {
        self.epoch
    }

    pub fn read_source(&self, note_id: impl Into<String>) -> Result<SourceDocument> {
        self.request(|reply| LibraryCommand::ReadSource {
            note_id: note_id.into(),
            reply,
        })
    }

    pub fn save_source(&self, input: SaveSourceInput) -> Result<SaveSourceResult> {
        self.request(|reply| LibraryCommand::SaveSource { input, reply })
    }

    fn request<T>(&self, command: impl FnOnce(Reply<T>) -> LibraryCommand) -> Result<T> {
        let (reply_sender, reply_receiver) = mpsc::channel();
        self.commands
            .send(command(reply_sender))
            .map_err(|_| anyhow!("Castle's library session is not running."))?;
        reply_receiver
            .recv()
            .map_err(|_| anyhow!("Castle's library session stopped before replying."))?
            .map_err(anyhow::Error::msg)
    }
}

impl LibrarySession {
    pub fn spawn(options: LibrarySessionOptions) -> (Self, Receiver<RuntimeEvent>) {
        let epoch = SessionEpoch::next();
        let (command_sender, command_receiver) = mpsc::sync_channel(COMMAND_CAPACITY);
        let (event_sender, event_receiver) = mpsc::sync_channel(EVENT_CAPACITY);
        let (watcher_stop, watcher_stop_receiver) = mpsc::channel();
        let (watcher_ready, watcher_ready_receiver) = mpsc::channel();
        let library_root = options
            .library_root
            .canonicalize()
            .unwrap_or_else(|_| options.library_root.clone());
        let watcher_commands = command_sender.clone();
        let watcher_events = event_sender.clone();
        let watcher = thread::Builder::new()
            .name(format!("castle-library-watcher-{}", epoch.get()))
            .spawn(move || {
                run_library_watcher(
                    epoch,
                    library_root,
                    watcher_commands,
                    watcher_events,
                    watcher_stop_receiver,
                    watcher_ready,
                );
            })
            .expect("Castle could not start its filesystem watcher thread");
        let _ = watcher_ready_receiver.recv();
        let worker = thread::Builder::new()
            .name(format!("castle-library-{}", epoch.get()))
            .spawn(move || run_library_session(epoch, options, command_receiver, event_sender))
            .expect("Castle could not start its library worker thread");
        (
            Self {
                epoch,
                commands: command_sender,
                worker: Some(worker),
                watcher_stop,
                watcher: Some(watcher),
            },
            event_receiver,
        )
    }

    pub fn epoch(&self) -> SessionEpoch {
        self.epoch
    }

    pub fn client(&self) -> LibraryClient {
        LibraryClient {
            epoch: self.epoch,
            commands: self.commands.clone(),
        }
    }

    pub fn read_source(&self, note_id: impl Into<String>) -> Result<SourceDocument> {
        self.request(|reply| LibraryCommand::ReadSource {
            note_id: note_id.into(),
            reply,
        })
    }

    pub fn save_source(&self, input: SaveSourceInput) -> Result<SaveSourceResult> {
        self.request(|reply| LibraryCommand::SaveSource { input, reply })
    }

    pub fn create_source(&self, input: CreateSourceInput) -> Result<SaveSourceResult> {
        self.request(|reply| LibraryCommand::CreateSource { input, reply })
    }

    pub fn create_folder(&self, input: CreateFolderInput) -> Result<CreateFolderResult> {
        self.request(|reply| LibraryCommand::CreateFolder { input, reply })
    }

    pub fn move_source(&self, input: MoveSourceInput) -> Result<MoveSourceResult> {
        self.request(|reply| LibraryCommand::MoveSource { input, reply })
    }

    pub fn delete_source(&self, input: DeleteSourceInput) -> Result<DeleteSourceResult> {
        self.request(|reply| LibraryCommand::DeleteSource { input, reply })
    }

    pub fn delete_folder(&self, input: DeleteFolderInput) -> Result<DeleteFolderResult> {
        self.request(|reply| LibraryCommand::DeleteFolder { input, reply })
    }

    pub fn restore_source(&self, input: RestoreSourceInput) -> Result<SaveSourceResult> {
        self.request(|reply| LibraryCommand::RestoreSource { input, reply })
    }

    pub fn mutate_task(&self, input: MutateTaskInput) -> Result<TaskMutationResult> {
        self.request(|reply| LibraryCommand::MutateTask { input, reply })
    }

    pub fn create_task(&self, input: CreateTaskInput) -> Result<TaskMutationResult> {
        self.request(|reply| LibraryCommand::CreateTask { input, reply })
    }

    pub fn delete_task(&self, input: DeleteTaskInput) -> Result<DeleteTaskResult> {
        self.request(|reply| LibraryCommand::DeleteTask { input, reply })
    }

    pub fn restore_task(&self, input: RestoreTaskInput) -> Result<TaskMutationResult> {
        self.request(|reply| LibraryCommand::RestoreTask { input, reply })
    }

    pub fn update_person(&self, input: UpdatePersonInput) -> Result<PersonMutationResult> {
        self.request(|reply| LibraryCommand::UpdatePerson { input, reply })
    }

    pub fn refresh_external_changes(&self) -> Result<bool> {
        self.request(|reply| LibraryCommand::RefreshExternalChanges { reply: Some(reply) })
    }

    pub fn shutdown(mut self) {
        let _ = self.watcher_stop.send(());
        let _ = self.commands.send(LibraryCommand::Shutdown);
        if let Some(watcher) = self.watcher.take() {
            let _ = watcher.join();
        }
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }

    fn request<T>(&self, command: impl FnOnce(Reply<T>) -> LibraryCommand) -> Result<T> {
        let (reply_sender, reply_receiver) = mpsc::channel();
        self.commands
            .send(command(reply_sender))
            .map_err(|_| anyhow!("Castle's library session is not running."))?;
        reply_receiver
            .recv()
            .map_err(|_| anyhow!("Castle's library session stopped before replying."))?
            .map_err(anyhow::Error::msg)
    }
}

impl Drop for LibrarySession {
    fn drop(&mut self) {
        let _ = self.watcher_stop.send(());
        if self.worker.is_some() {
            let _ = self.commands.try_send(LibraryCommand::Shutdown);
        }
    }
}

fn run_library_watcher(
    epoch: SessionEpoch,
    library_root: PathBuf,
    commands: SyncSender<LibraryCommand>,
    events: SyncSender<RuntimeEvent>,
    stop: Receiver<()>,
    ready: Sender<()>,
) {
    let (watch_event_sender, watch_events) = mpsc::channel();
    let mut watcher = match notify::recommended_watcher(move |result| {
        let _ = watch_event_sender.send(result);
    }) {
        Ok(watcher) => watcher,
        Err(reason) => {
            send_watcher_error(&events, epoch, anyhow!(reason));
            let _ = ready.send(());
            return;
        }
    };
    if let Err(reason) = watcher.watch(&library_root, RecursiveMode::Recursive) {
        send_watcher_error(&events, epoch, anyhow!(reason));
        let _ = ready.send(());
        return;
    }
    let _ = ready.send(());

    let mut refresh_deadline = None;
    let mut fallback_deadline = Instant::now() + WATCH_FALLBACK_SCAN;
    loop {
        if stop.try_recv().is_ok() {
            break;
        }
        let now = Instant::now();
        let wait = refresh_deadline
            .map(|deadline: Instant| deadline.saturating_duration_since(now))
            .unwrap_or(WATCH_IDLE_TICK)
            .min(WATCH_IDLE_TICK)
            .min(fallback_deadline.saturating_duration_since(now));
        match watch_events.recv_timeout(wait) {
            Ok(Ok(event)) if is_library_content_event(&event, &library_root) => {
                refresh_deadline = Some(Instant::now() + WATCH_DEBOUNCE);
            }
            Ok(Ok(_)) => {}
            Ok(Err(reason)) => send_watcher_error(&events, epoch, anyhow!(reason)),
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => {
                send_watcher_error(
                    &events,
                    epoch,
                    anyhow!("Castle's filesystem watcher stopped unexpectedly."),
                );
                break;
            }
        }

        let now = Instant::now();
        let notification_due = refresh_deadline.is_some_and(|deadline| now >= deadline);
        let fallback_due = now >= fallback_deadline;
        if notification_due || fallback_due {
            refresh_deadline = None;
            fallback_deadline = now + WATCH_FALLBACK_SCAN;
            if commands
                .send(LibraryCommand::RefreshExternalChanges { reply: None })
                .is_err()
            {
                break;
            }
        }
    }
}

fn is_library_content_event(event: &Event, library_root: &Path) -> bool {
    if matches!(event.kind, EventKind::Access(_)) {
        return false;
    }
    event.paths.iter().any(|path| {
        path.strip_prefix(library_root).is_ok_and(|relative| {
            relative
                .components()
                .all(|component| !component.as_os_str().to_string_lossy().starts_with('.'))
        })
    })
}

fn send_watcher_error(
    events: &SyncSender<RuntimeEvent>,
    epoch: SessionEpoch,
    reason: anyhow::Error,
) {
    let _ = send_status(
        events,
        epoch,
        RuntimeServiceStatus::failed(ServiceStatusKind::Stale, &reason),
    );
}

fn run_library_session(
    epoch: SessionEpoch,
    options: LibrarySessionOptions,
    commands: Receiver<LibraryCommand>,
    events: SyncSender<RuntimeEvent>,
) {
    if send_status(&events, epoch, RuntimeServiceStatus::opening()).is_err() {
        return;
    }
    let mut service = match CastleService::open(ServiceOptions {
        library_root: options.library_root,
        repository_root: options.repository_root,
        cache_root: options.cache_root,
    }) {
        Ok(service) => service,
        Err(reason) => {
            let _ = send_status(
                &events,
                epoch,
                RuntimeServiceStatus::failed(ServiceStatusKind::Unavailable, &reason),
            );
            return;
        }
    };
    let state = service.state();
    let snapshot = Arc::new(AppSnapshot::new(epoch, service.publication_compilation()));
    if events
        .send(RuntimeEvent::LibraryReady { epoch, snapshot })
        .is_err()
    {
        return;
    }
    if send_status(&events, epoch, RuntimeServiceStatus::ready(&state)).is_err() {
        return;
    }

    while let Ok(command) = commands.recv() {
        match command {
            LibraryCommand::ReadSource { note_id, reply } => {
                send_reply(reply, service.read_source(&note_id));
            }
            LibraryCommand::SaveSource { input, reply } => {
                let result = service.save_source(input);
                finish_mutation(
                    &mut service,
                    epoch,
                    &events,
                    ContentOperation::SaveSource,
                    reply,
                    result,
                );
            }
            LibraryCommand::CreateSource { input, reply } => {
                let result = service.create_source(input);
                finish_mutation(
                    &mut service,
                    epoch,
                    &events,
                    ContentOperation::CreateSource,
                    reply,
                    result,
                );
            }
            LibraryCommand::CreateFolder { input, reply } => {
                let result = service.create_folder(input);
                finish_mutation(
                    &mut service,
                    epoch,
                    &events,
                    ContentOperation::CreateFolder,
                    reply,
                    result,
                );
            }
            LibraryCommand::MoveSource { input, reply } => {
                let result = service
                    .commit_move_source(input)
                    .and_then(|result| service.refresh().map(|_| result));
                finish_mutation(
                    &mut service,
                    epoch,
                    &events,
                    ContentOperation::MoveSource,
                    reply,
                    result,
                );
            }
            LibraryCommand::DeleteSource { input, reply } => {
                let result = service.delete_source(input);
                finish_mutation(
                    &mut service,
                    epoch,
                    &events,
                    ContentOperation::DeleteSource,
                    reply,
                    result,
                );
            }
            LibraryCommand::DeleteFolder { input, reply } => {
                let result = service.delete_folder(input);
                finish_mutation(
                    &mut service,
                    epoch,
                    &events,
                    ContentOperation::DeleteFolder,
                    reply,
                    result,
                );
            }
            LibraryCommand::RestoreSource { input, reply } => {
                let result = service.restore_source(input);
                finish_mutation(
                    &mut service,
                    epoch,
                    &events,
                    ContentOperation::RestoreSource,
                    reply,
                    result,
                );
            }
            LibraryCommand::MutateTask { input, reply } => {
                let result = service.mutate_task(input);
                finish_mutation(
                    &mut service,
                    epoch,
                    &events,
                    ContentOperation::MutateTask,
                    reply,
                    result,
                );
            }
            LibraryCommand::CreateTask { input, reply } => {
                let result = service.create_task(input);
                finish_mutation(
                    &mut service,
                    epoch,
                    &events,
                    ContentOperation::CreateTask,
                    reply,
                    result,
                );
            }
            LibraryCommand::DeleteTask { input, reply } => {
                let result = service.delete_task(input);
                finish_mutation(
                    &mut service,
                    epoch,
                    &events,
                    ContentOperation::DeleteTask,
                    reply,
                    result,
                );
            }
            LibraryCommand::RestoreTask { input, reply } => {
                let result = service.restore_task(input);
                finish_mutation(
                    &mut service,
                    epoch,
                    &events,
                    ContentOperation::RestoreTask,
                    reply,
                    result,
                );
            }
            LibraryCommand::UpdatePerson { input, reply } => {
                let result = service.update_person(input);
                finish_mutation(
                    &mut service,
                    epoch,
                    &events,
                    ContentOperation::UpdatePerson,
                    reply,
                    result,
                );
            }
            LibraryCommand::RefreshExternalChanges { reply } => {
                let result = service.refresh_if_changed();
                match result {
                    Ok(Some(_)) => {
                        let published = publish_current(
                            &mut service,
                            epoch,
                            &events,
                            ContentOperation::Refresh,
                        );
                        if let Err(reason) = &published {
                            let _ = send_status(
                                &events,
                                epoch,
                                RuntimeServiceStatus::failed(ServiceStatusKind::Stale, reason),
                            );
                        }
                        send_optional_reply(reply, published.map(|()| true));
                    }
                    Ok(None) => send_optional_reply(reply, Ok(false)),
                    Err(reason) => {
                        let _ = send_status(
                            &events,
                            epoch,
                            RuntimeServiceStatus::failed(ServiceStatusKind::Stale, &reason),
                        );
                        send_optional_reply(reply, Err(reason));
                    }
                }
            }
            LibraryCommand::Shutdown => break,
        }
    }

    let _ = send_status(
        &events,
        epoch,
        RuntimeServiceStatus {
            kind: ServiceStatusKind::Stopped,
            message: "Castle's native library session stopped.".into(),
            generated_at: service.state().generated_at,
        },
    );
}

fn finish_mutation<T>(
    service: &mut CastleService,
    epoch: SessionEpoch,
    events: &SyncSender<RuntimeEvent>,
    operation: ContentOperation,
    reply: Reply<T>,
    result: Result<T>,
) {
    match result {
        Ok(value) => {
            if let Err(reason) = publish_current(service, epoch, events, operation) {
                let _ = send_status(
                    events,
                    epoch,
                    RuntimeServiceStatus::failed(ServiceStatusKind::Stale, &reason),
                );
            }
            send_reply(reply, Ok(value));
        }
        Err(reason) => send_reply(reply, Err(reason)),
    }
}

fn publish_current(
    service: &mut CastleService,
    epoch: SessionEpoch,
    events: &SyncSender<RuntimeEvent>,
    operation: ContentOperation,
) -> Result<()> {
    let compilation = service.publication_compilation();
    let delta = service.compilation_delta(&compilation)?;
    let snapshot = Arc::new(AppSnapshot::new(epoch, compilation));
    service.acknowledge_current_publication();
    events
        .send(RuntimeEvent::ContentChanged {
            epoch,
            operation,
            delta: Box::new(delta),
            snapshot,
        })
        .map_err(|_| anyhow!("Castle's runtime event receiver was closed."))?;
    Ok(())
}

fn send_status(
    events: &SyncSender<RuntimeEvent>,
    epoch: SessionEpoch,
    status: RuntimeServiceStatus,
) -> std::result::Result<(), mpsc::SendError<RuntimeEvent>> {
    events.send(RuntimeEvent::ServiceStatus { epoch, status })
}

fn send_reply<T>(reply: Reply<T>, result: Result<T>) {
    let _ = reply.send(result.map_err(|reason| format!("{reason:#}")));
}

fn send_optional_reply<T>(reply: Option<Reply<T>>, result: Result<T>) {
    if let Some(reply) = reply {
        send_reply(reply, result);
    }
}

pub fn configured_session_options(
    application_repository_root: &Path,
    library_override: Option<&Path>,
    cache_root: impl Into<PathBuf>,
) -> Result<LibrarySessionOptions> {
    let configuration = castle_core::load_castle_configuration(application_repository_root)
        .context("Castle could not load its application configuration")?;
    Ok(LibrarySessionOptions::new(
        library_override
            .map(Path::to_path_buf)
            .unwrap_or(configuration.library_path),
        configuration.repository_path,
        cache_root,
    ))
}

#[cfg(test)]
mod tests {
    use std::{fs, time::Duration};

    use super::*;

    fn repository_root() -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../..")
            .canonicalize()
            .unwrap()
    }

    fn copy_tree(source: &Path, destination: &Path) {
        fs::create_dir_all(destination).unwrap();
        for entry in fs::read_dir(source).unwrap() {
            let entry = entry.unwrap();
            let target = destination.join(entry.file_name());
            if entry.file_type().unwrap().is_dir() {
                copy_tree(&entry.path(), &target);
            } else {
                fs::copy(entry.path(), target).unwrap();
            }
        }
    }

    fn receive_ready(events: &Receiver<RuntimeEvent>) -> Arc<AppSnapshot> {
        loop {
            match events.recv_timeout(Duration::from_secs(30)).unwrap() {
                RuntimeEvent::LibraryReady { snapshot, .. } => return snapshot,
                RuntimeEvent::ServiceStatus { .. } => {}
                RuntimeEvent::ContentChanged { .. } => {
                    panic!("content changed before the library became ready")
                }
            }
        }
    }

    #[test]
    fn asset_paths_reject_encoded_traversal() {
        assert_eq!(
            decode_asset_path("notes/My%20Image.png"),
            Some(PathBuf::from("notes/My Image.png"))
        );
        assert!(decode_asset_path("%2E%2E/secret.png").is_none());
        assert!(decode_asset_path("notes%2F..%2Fsecret.png").is_none());
        assert!(decode_asset_path("notes/%ZZ.png").is_none());
    }

    #[test]
    fn opens_a_library_off_thread_and_indexes_its_snapshot() {
        let cache = tempfile::tempdir().unwrap();
        let repository = repository_root();
        let options = configured_session_options(&repository, None, cache.path()).unwrap();
        let (session, events) = LibrarySession::spawn(options);

        let opening = events.recv_timeout(Duration::from_secs(10)).unwrap();
        assert_eq!(opening.epoch(), session.epoch());
        assert!(matches!(
            opening,
            RuntimeEvent::ServiceStatus {
                status: RuntimeServiceStatus {
                    kind: ServiceStatusKind::Opening,
                    ..
                },
                ..
            }
        ));

        let ready = events.recv_timeout(Duration::from_secs(30)).unwrap();
        let RuntimeEvent::LibraryReady { epoch, snapshot } = ready else {
            panic!("expected a ready snapshot");
        };
        assert_eq!(epoch, session.epoch());
        let welcome = snapshot
            .notes
            .iter()
            .find(|note| note.title == "Welcome to Castle")
            .unwrap();
        assert_eq!(snapshot.note_by_id(&welcome.id), Some(welcome));
        assert_eq!(snapshot.note_by_route(&welcome.route), Some(welcome));
        assert!(
            snapshot
                .note_markdown(snapshot.note_indexes_by_id[&welcome.id])
                .unwrap()
                .contains("synthetic library")
        );
        assert!(!snapshot.sections.is_empty());

        let client = session.client();
        assert_eq!(client.epoch(), session.epoch());
        let source = client.read_source(welcome.id.clone()).unwrap();
        assert!(source.markdown.contains("Welcome to Castle"));
        session.shutdown();
    }

    #[test]
    fn directory_queries_return_only_direct_children() {
        let cache = tempfile::tempdir().unwrap();
        let repository = repository_root();
        let configuration = castle_core::load_castle_configuration(&repository).unwrap();
        let service = CastleService::open(ServiceOptions {
            library_root: configuration.library_path,
            repository_root: configuration.repository_path,
            cache_root: cache.path().to_owned(),
        })
        .unwrap();
        let snapshot = AppSnapshot::new(SessionEpoch::next(), service.publication_compilation());

        let direct_note_indexes = snapshot.notes_in_directory("notes", &[]);
        assert!(
            direct_note_indexes
                .iter()
                .all(|index| note_directory(&snapshot.notes[*index]).is_empty())
        );
        assert!(
            snapshot
                .folders_in_directory("notes", &[])
                .iter()
                .all(|index| snapshot.folders[*index].directory.len() == 1)
        );
    }

    #[test]
    fn successful_mutations_publish_authoritative_snapshots_and_deltas() {
        let temporary = tempfile::tempdir().unwrap();
        let library_root = temporary.path().join("library");
        copy_tree(&repository_root().join("examples/library"), &library_root);
        let cache_root = temporary.path().join("cache");
        let (session, events) = LibrarySession::spawn(LibrarySessionOptions::new(
            &library_root,
            temporary.path(),
            cache_root,
        ));
        let before = receive_ready(&events);
        assert!(before.note_by_id("notes/runtime_created").is_none());

        session
            .create_source(CreateSourceInput {
                note_id: "notes/runtime_created".into(),
                source_file: "notes/runtime_created.md".into(),
                markdown: "# Runtime Created\n\nWritten through the session actor.\n".into(),
            })
            .unwrap();

        loop {
            match events.recv_timeout(Duration::from_secs(30)).unwrap() {
                RuntimeEvent::ContentChanged {
                    epoch,
                    operation,
                    delta,
                    snapshot,
                } => {
                    assert_eq!(epoch, session.epoch());
                    assert_eq!(operation, ContentOperation::CreateSource);
                    assert!(
                        delta
                            .notes
                            .upserted
                            .iter()
                            .any(|note| note.id == "notes/runtime_created")
                    );
                    assert!(snapshot.note_by_id("notes/runtime_created").is_some());
                    break;
                }
                RuntimeEvent::ServiceStatus { .. } => {}
                RuntimeEvent::LibraryReady { .. } => panic!("received two ready snapshots"),
            }
        }
        session.shutdown();
    }

    #[test]
    fn external_markdown_edits_are_debounced_and_published() {
        let temporary = tempfile::tempdir().unwrap();
        let library_root = temporary.path().join("library");
        copy_tree(&repository_root().join("examples/library"), &library_root);
        let cache_root = temporary.path().join("cache");
        let (session, events) = LibrarySession::spawn(LibrarySessionOptions::new(
            &library_root,
            temporary.path(),
            cache_root,
        ));
        let before = receive_ready(&events);
        let welcome = before
            .notes
            .iter()
            .find(|note| note.title == "Welcome to Castle")
            .unwrap();
        let welcome_id = welcome.id.clone();
        let source_path = library_root.join(&welcome.source_file);
        let edited = fs::read_to_string(&source_path)
            .unwrap()
            .replace("synthetic library", "filesystem watcher");
        assert!(edited.contains("filesystem watcher"));
        fs::write(source_path, edited).unwrap();

        loop {
            match events.recv_timeout(Duration::from_secs(30)).unwrap() {
                RuntimeEvent::ContentChanged {
                    epoch,
                    operation,
                    snapshot,
                    ..
                } => {
                    assert_eq!(epoch, session.epoch());
                    assert_eq!(operation, ContentOperation::Refresh);
                    let note_index = snapshot.note_index_by_id(&welcome_id).unwrap();
                    assert!(
                        snapshot
                            .note_markdown(note_index)
                            .unwrap()
                            .contains("filesystem watcher")
                    );
                    break;
                }
                RuntimeEvent::ServiceStatus { .. } => {}
                RuntimeEvent::LibraryReady { .. } => panic!("received two ready snapshots"),
            }
        }
        session.shutdown();
    }
}
