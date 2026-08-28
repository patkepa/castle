use std::{
    sync::{Arc, Condvar, Mutex},
    thread::{self, JoinHandle},
    time::{Duration, Instant},
};

use anyhow::{Result, anyhow};
use castle_core::{INDEX_PROJECTION_SCHEMA_VERSION, IndexProjection};
use serde::Serialize;

use crate::{
    EmbeddingCache, EmbeddingCancellationToken, EmbeddingProvider, EmbeddingProviderMetadata,
    EmbeddingSyncOptions, EmbeddingSyncResult, IndexPublisher, PublishResult,
};

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum EmbeddingEnrichmentState {
    Published,
    Cancelled,
    Stale,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EmbeddingEnrichmentResult {
    pub state: EmbeddingEnrichmentState,
    pub synchronization: EmbeddingSyncResult,
    pub publication: Option<PublishResult>,
}

pub struct EmbeddingEnricher {
    publisher: IndexPublisher,
    cache: EmbeddingCache,
    provider: Arc<dyn EmbeddingProvider>,
    options: EmbeddingSyncOptions,
}

impl EmbeddingEnricher {
    pub fn new(
        publisher: IndexPublisher,
        cache: EmbeddingCache,
        provider: Arc<dyn EmbeddingProvider>,
        options: EmbeddingSyncOptions,
    ) -> Result<Self> {
        let metadata = provider.metadata();
        validate_provider_metadata(&metadata)?;
        Ok(Self {
            publisher,
            cache,
            provider,
            options,
        })
    }

    pub fn provider_metadata(&self) -> EmbeddingProviderMetadata {
        self.provider.metadata()
    }

    pub fn enrich(
        &self,
        projection: &IndexProjection,
        cancellation: &EmbeddingCancellationToken,
    ) -> Result<EmbeddingEnrichmentResult> {
        if projection.schema_version != INDEX_PROJECTION_SCHEMA_VERSION {
            return Err(anyhow!("Castle index projection schema is incompatible"));
        }
        let synchronization = self.cache.synchronize_controlled(
            projection,
            self.provider.as_ref(),
            cancellation,
            &self.options,
        )?;
        if cancellation.is_cancelled() || !synchronization.completed {
            return Ok(EmbeddingEnrichmentResult {
                state: EmbeddingEnrichmentState::Cancelled,
                synchronization,
                publication: None,
            });
        }
        let publication = self
            .publisher
            .publish_enriched_if_current(projection, &synchronization.embeddings)?;
        Ok(EmbeddingEnrichmentResult {
            state: if publication.is_some() {
                EmbeddingEnrichmentState::Published
            } else {
                EmbeddingEnrichmentState::Stale
            },
            synchronization,
            publication,
        })
    }
}

fn validate_provider_metadata(metadata: &EmbeddingProviderMetadata) -> Result<()> {
    if metadata.provider.trim().is_empty()
        || metadata.model.trim().is_empty()
        || metadata.input_version.trim().is_empty()
        || !(1..=65_536).contains(&metadata.dimensions)
        || !(1..=1_024).contains(&metadata.maximum_batch_size)
    {
        return Err(anyhow!("Castle embedding provider metadata is invalid"));
    }
    Ok(())
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum EmbeddingSchedulerState {
    Idle,
    Scheduled,
    Running,
    Failed,
    Shutdown,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct EmbeddingSchedulerStatus {
    pub state: EmbeddingSchedulerState,
    pub provider: Option<EmbeddingProviderMetadata>,
    pub active_source_fingerprint: Option<String>,
    pub queued_source_fingerprint: Option<String>,
    pub published_runs: u64,
    pub cancelled_runs: u64,
    pub stale_runs: u64,
    pub failed_runs: u64,
    pub last_unique_content_count: usize,
    pub last_cache_hits: usize,
    pub last_generated: usize,
    pub last_pending: usize,
    pub last_retries: usize,
    pub last_error_class: Option<String>,
}

impl Default for EmbeddingSchedulerStatus {
    fn default() -> Self {
        Self {
            state: EmbeddingSchedulerState::Idle,
            provider: None,
            active_source_fingerprint: None,
            queued_source_fingerprint: None,
            published_runs: 0,
            cancelled_runs: 0,
            stale_runs: 0,
            failed_runs: 0,
            last_unique_content_count: 0,
            last_cache_hits: 0,
            last_generated: 0,
            last_pending: 0,
            last_retries: 0,
            last_error_class: None,
        }
    }
}

struct WorkerState {
    pending: Option<IndexProjection>,
    active_cancellation: Option<EmbeddingCancellationToken>,
    shutdown: bool,
    status: EmbeddingSchedulerStatus,
}

struct WorkerShared {
    state: Mutex<WorkerState>,
    changed: Condvar,
}

pub struct EmbeddingScheduler {
    shared: Arc<WorkerShared>,
    worker: Option<JoinHandle<()>>,
}

impl EmbeddingScheduler {
    pub fn start(enricher: EmbeddingEnricher) -> Result<Self> {
        let provider = enricher.provider_metadata();
        let shared = Arc::new(WorkerShared {
            state: Mutex::new(WorkerState {
                pending: None,
                active_cancellation: None,
                shutdown: false,
                status: EmbeddingSchedulerStatus {
                    provider: Some(provider),
                    ..EmbeddingSchedulerStatus::default()
                },
            }),
            changed: Condvar::new(),
        });
        let worker_shared = Arc::clone(&shared);
        let worker = thread::Builder::new()
            .name("castle-embeddings".to_owned())
            .spawn(move || run_worker(enricher, &worker_shared))
            .map_err(|reason| anyhow!("Castle could not start the embedding worker: {reason}"))?;
        Ok(Self {
            shared,
            worker: Some(worker),
        })
    }

    pub fn schedule(&self, projection: IndexProjection) -> Result<()> {
        let mut state = self
            .shared
            .state
            .lock()
            .map_err(|_| anyhow!("Castle embedding scheduler lock was poisoned"))?;
        if state.shutdown {
            return Err(anyhow!("Castle embedding scheduler is shut down"));
        }
        if let Some(cancellation) = &state.active_cancellation {
            cancellation.cancel();
        }
        state.status.state = EmbeddingSchedulerState::Scheduled;
        state.status.queued_source_fingerprint = Some(projection.source_fingerprint.clone());
        state.pending = Some(projection);
        self.shared.changed.notify_all();
        Ok(())
    }

    pub fn status(&self) -> Result<EmbeddingSchedulerStatus> {
        self.shared
            .state
            .lock()
            .map(|state| state.status.clone())
            .map_err(|_| anyhow!("Castle embedding scheduler lock was poisoned"))
    }

    pub fn wait_for_idle(&self, timeout: Duration) -> Result<bool> {
        let deadline = Instant::now() + timeout;
        let mut state = self
            .shared
            .state
            .lock()
            .map_err(|_| anyhow!("Castle embedding scheduler lock was poisoned"))?;
        while state.pending.is_some() || state.active_cancellation.is_some() {
            let now = Instant::now();
            if now >= deadline {
                return Ok(false);
            }
            let (next, result) = self
                .shared
                .changed
                .wait_timeout(state, deadline.saturating_duration_since(now))
                .map_err(|_| anyhow!("Castle embedding scheduler lock was poisoned"))?;
            state = next;
            if result.timed_out()
                && (state.pending.is_some() || state.active_cancellation.is_some())
            {
                return Ok(false);
            }
        }
        Ok(true)
    }

    pub fn shutdown(&mut self) -> Result<()> {
        {
            let mut state = self
                .shared
                .state
                .lock()
                .map_err(|_| anyhow!("Castle embedding scheduler lock was poisoned"))?;
            state.shutdown = true;
            state.pending = None;
            if let Some(cancellation) = &state.active_cancellation {
                cancellation.cancel();
            }
            state.status.state = EmbeddingSchedulerState::Shutdown;
            state.status.queued_source_fingerprint = None;
            self.shared.changed.notify_all();
        }
        if let Some(worker) = self.worker.take() {
            worker
                .join()
                .map_err(|_| anyhow!("Castle embedding worker stopped unexpectedly"))?;
        }
        Ok(())
    }
}

impl Drop for EmbeddingScheduler {
    fn drop(&mut self) {
        let _ = self.shutdown();
    }
}

fn run_worker(enricher: EmbeddingEnricher, shared: &WorkerShared) {
    loop {
        let (projection, cancellation) = {
            let mut state = match shared.state.lock() {
                Ok(state) => state,
                Err(_) => return,
            };
            while state.pending.is_none() && !state.shutdown {
                state = match shared.changed.wait(state) {
                    Ok(state) => state,
                    Err(_) => return,
                };
            }
            if state.shutdown {
                return;
            }
            let projection = match state.pending.take() {
                Some(projection) => projection,
                None => continue,
            };
            let cancellation = EmbeddingCancellationToken::new();
            state.active_cancellation = Some(cancellation.clone());
            state.status.state = EmbeddingSchedulerState::Running;
            state.status.active_source_fingerprint = Some(projection.source_fingerprint.clone());
            state.status.queued_source_fingerprint = None;
            (projection, cancellation)
        };

        let result = enricher.enrich(&projection, &cancellation);
        let mut state = match shared.state.lock() {
            Ok(state) => state,
            Err(_) => return,
        };
        state.active_cancellation = None;
        state.status.active_source_fingerprint = None;
        let failed = result.is_err();
        match result {
            Ok(result) => {
                state.status.last_unique_content_count =
                    result.synchronization.unique_content_count;
                state.status.last_cache_hits = result.synchronization.cache_hits;
                state.status.last_generated = result.synchronization.generated;
                state.status.last_pending = result.synchronization.pending;
                state.status.last_retries = result.synchronization.retries;
                match result.state {
                    EmbeddingEnrichmentState::Published => state.status.published_runs += 1,
                    EmbeddingEnrichmentState::Cancelled => state.status.cancelled_runs += 1,
                    EmbeddingEnrichmentState::Stale => state.status.stale_runs += 1,
                }
            }
            Err(_) => {
                state.status.failed_runs += 1;
                state.status.last_error_class = Some("embedding_enrichment_error".to_owned());
            }
        }
        state.status.state = if state.shutdown {
            EmbeddingSchedulerState::Shutdown
        } else if state.pending.is_some() {
            state.status.queued_source_fingerprint = state
                .pending
                .as_ref()
                .map(|projection| projection.source_fingerprint.clone());
            EmbeddingSchedulerState::Scheduled
        } else if failed {
            EmbeddingSchedulerState::Failed
        } else {
            EmbeddingSchedulerState::Idle
        };
        shared.changed.notify_all();
    }
}

#[cfg(test)]
mod tests {
    use std::{
        fs,
        sync::{
            Condvar, Mutex,
            atomic::{AtomicBool, Ordering},
        },
    };

    use anyhow::ensure;
    use castle_core::{CompileOptions, build_index_projection, compile_library};

    use super::*;
    use crate::{DeterministicEmbeddingProvider, IndexPublisherOptions, create_library_key};

    fn fixture() -> (tempfile::TempDir, IndexProjection, IndexPublisher) {
        let root = tempfile::tempdir().unwrap();
        let library = root.path().join("library");
        fs::create_dir_all(library.join("notes")).unwrap();
        fs::write(
            library.join("notes/one.md"),
            "# One\n\nAlpha material for semantic retrieval.",
        )
        .unwrap();
        fs::write(
            library.join("notes/two.md"),
            "# Two\n\nBeta material for semantic retrieval.",
        )
        .unwrap();
        let compilation = compile_library(&CompileOptions::new(&library, root.path())).unwrap();
        let projection = build_index_projection(&compilation);
        let publisher = IndexPublisher::new(IndexPublisherOptions {
            indexes_root: root.path().join("indexes"),
            library_key: create_library_key(&library).unwrap(),
        })
        .unwrap();
        (root, projection, publisher)
    }

    #[test]
    fn publishes_a_later_semantic_generation_only_for_the_current_projection() {
        let (root, projection, publisher) = fixture();
        let structural = publisher.publish(&projection).unwrap();
        assert!(!structural.manifest.semantic_available);
        let enricher = EmbeddingEnricher::new(
            publisher.clone(),
            EmbeddingCache::new(root.path().join("cache/embeddings.db")),
            Arc::new(DeterministicEmbeddingProvider::new(16).unwrap()),
            EmbeddingSyncOptions::default(),
        )
        .unwrap();
        let cancelled = EmbeddingCancellationToken::new();
        cancelled.cancel();
        let incomplete = enricher.enrich(&projection, &cancelled).unwrap();
        assert_eq!(incomplete.state, EmbeddingEnrichmentState::Cancelled);
        assert!(incomplete.publication.is_none());
        assert_eq!(
            publisher.verify_current().unwrap().generation,
            structural.manifest.generation
        );

        let enriched = enricher
            .enrich(&projection, &EmbeddingCancellationToken::new())
            .unwrap();

        assert_eq!(enriched.state, EmbeddingEnrichmentState::Published);
        let publication = enriched.publication.unwrap();
        assert_ne!(
            publication.manifest.generation,
            structural.manifest.generation
        );
        assert!(publication.manifest.semantic_available);
        assert_eq!(
            publisher.verify_current().unwrap().generation,
            publication.manifest.generation
        );

        let mut newer = projection.clone();
        newer.source_fingerprint = "c".repeat(64);
        let newer_structural = publisher.publish(&newer).unwrap();
        let stale = enricher
            .enrich(&projection, &EmbeddingCancellationToken::new())
            .unwrap();
        assert_eq!(stale.state, EmbeddingEnrichmentState::Stale);
        assert!(stale.publication.is_none());
        assert_eq!(
            publisher.verify_current().unwrap().generation,
            newer_structural.manifest.generation
        );
    }

    struct ProviderGate {
        started: AtomicBool,
        released: Mutex<bool>,
        changed: Condvar,
    }

    impl ProviderGate {
        fn new() -> Self {
            Self {
                started: AtomicBool::new(false),
                released: Mutex::new(false),
                changed: Condvar::new(),
            }
        }

        fn wait_until_started(&self, timeout: Duration) -> bool {
            let deadline = Instant::now() + timeout;
            while !self.started.load(Ordering::Acquire) && Instant::now() < deadline {
                thread::sleep(Duration::from_millis(2));
            }
            self.started.load(Ordering::Acquire)
        }

        fn release(&self) {
            *self.released.lock().unwrap() = true;
            self.changed.notify_all();
        }
    }

    struct BlockingProvider {
        gate: Arc<ProviderGate>,
    }

    impl EmbeddingProvider for BlockingProvider {
        fn metadata(&self) -> EmbeddingProviderMetadata {
            EmbeddingProviderMetadata {
                provider: "blocking_test".to_owned(),
                model: "blocking_v1".to_owned(),
                input_version: "blocking_input_v1".to_owned(),
                dimensions: 16,
                maximum_batch_size: 128,
            }
        }

        fn embed_batch(
            &self,
            texts: &[String],
            cancellation: &EmbeddingCancellationToken,
        ) -> Result<Vec<Vec<f32>>> {
            self.gate.started.store(true, Ordering::Release);
            self.gate.changed.notify_all();
            let mut released = self.gate.released.lock().unwrap();
            while !*released && !cancellation.is_cancelled() {
                let (next, _) = self
                    .gate
                    .changed
                    .wait_timeout(released, Duration::from_millis(10))
                    .unwrap();
                released = next;
            }
            ensure!(
                !cancellation.is_cancelled(),
                "blocking provider was cancelled"
            );
            let deterministic = DeterministicEmbeddingProvider::new(16).unwrap();
            deterministic.embed_batch(texts, cancellation)
        }
    }

    #[test]
    fn schedules_embedding_work_without_blocking_the_structural_generation() {
        let (root, projection, publisher) = fixture();
        let structural = publisher.publish(&projection).unwrap();
        let gate = Arc::new(ProviderGate::new());
        let enricher = EmbeddingEnricher::new(
            publisher.clone(),
            EmbeddingCache::new(root.path().join("cache/embeddings.db")),
            Arc::new(BlockingProvider {
                gate: Arc::clone(&gate),
            }),
            EmbeddingSyncOptions::default(),
        )
        .unwrap();
        let mut scheduler = EmbeddingScheduler::start(enricher).unwrap();

        let started = Instant::now();
        scheduler.schedule(projection).unwrap();
        assert!(started.elapsed() < Duration::from_millis(50));
        assert!(gate.wait_until_started(Duration::from_secs(2)));
        assert_eq!(
            scheduler.status().unwrap().state,
            EmbeddingSchedulerState::Running
        );
        assert_eq!(
            publisher.verify_current().unwrap().generation,
            structural.manifest.generation
        );
        assert!(!publisher.verify_current().unwrap().semantic_available);

        gate.release();
        assert!(scheduler.wait_for_idle(Duration::from_secs(5)).unwrap());
        let status = scheduler.status().unwrap();
        assert_eq!(status.state, EmbeddingSchedulerState::Idle);
        assert_eq!(status.published_runs, 1);
        assert_eq!(status.provider.unwrap().model, "blocking_v1");
        assert!(status.last_unique_content_count > 0);
        assert_eq!(status.last_generated, status.last_unique_content_count);
        assert_eq!(status.last_pending, 0);
        assert!(publisher.verify_current().unwrap().semantic_available);
        scheduler.shutdown().unwrap();
    }

    #[test]
    fn cancels_superseded_work_and_publishes_only_the_latest_projection() {
        let (root, first_projection, publisher) = fixture();
        publisher.publish(&first_projection).unwrap();
        let gate = Arc::new(ProviderGate::new());
        let enricher = EmbeddingEnricher::new(
            publisher.clone(),
            EmbeddingCache::new(root.path().join("cache/embeddings.db")),
            Arc::new(BlockingProvider {
                gate: Arc::clone(&gate),
            }),
            EmbeddingSyncOptions::default(),
        )
        .unwrap();
        let mut scheduler = EmbeddingScheduler::start(enricher).unwrap();
        scheduler.schedule(first_projection).unwrap();
        assert!(gate.wait_until_started(Duration::from_secs(2)));

        let mut latest_projection = fixture_projection_for_update(root.path());
        latest_projection.source_fingerprint = "e".repeat(64);
        let latest_structural = publisher.publish(&latest_projection).unwrap();
        scheduler.schedule(latest_projection).unwrap();
        gate.release();

        assert!(scheduler.wait_for_idle(Duration::from_secs(5)).unwrap());
        let status = scheduler.status().unwrap();
        assert_eq!(status.cancelled_runs, 1);
        assert_eq!(status.published_runs, 1);
        let current = publisher.verify_current().unwrap();
        assert_ne!(current.generation, latest_structural.manifest.generation);
        assert_eq!(current.source_fingerprint, "e".repeat(64));
        assert!(current.semantic_available);
        scheduler.shutdown().unwrap();
    }

    fn fixture_projection_for_update(root: &std::path::Path) -> IndexProjection {
        let library = root.join("library");
        let compilation = compile_library(&CompileOptions::new(&library, root)).unwrap();
        build_index_projection(&compilation)
    }
}
