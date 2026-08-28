use std::{
    sync::{Arc, Mutex},
    thread,
};

use anyhow::{Result, anyhow};
use castle_core::IndexProjection;
use serde::Serialize;

use crate::{
    EmbeddingCache, EmbeddingEnricher, EmbeddingProvider, EmbeddingProviderMetadata,
    EmbeddingScheduler, EmbeddingSchedulerState, EmbeddingSchedulerStatus, EmbeddingSyncOptions,
    IndexPublisher, QueryEmbedding,
};

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum EmbeddingRuntimeState {
    Preparing,
    Ready,
    Scheduled,
    Running,
    Failed,
    Shutdown,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct EmbeddingRuntimeStatus {
    pub state: EmbeddingRuntimeState,
    pub local: bool,
    pub model_ready: bool,
    pub provider: EmbeddingProviderMetadata,
    pub scheduler: Option<EmbeddingSchedulerStatus>,
    pub last_error_class: Option<String>,
    pub message: Option<String>,
}

struct RuntimeState {
    lifecycle: EmbeddingRuntimeState,
    provider: Option<Arc<dyn EmbeddingProvider>>,
    scheduler: Option<EmbeddingScheduler>,
    pending: Option<IndexProjection>,
    last_error_class: Option<String>,
    message: Option<String>,
    shutdown: bool,
}

struct RuntimeShared {
    state: Mutex<RuntimeState>,
    expected_provider: EmbeddingProviderMetadata,
}

#[derive(Clone)]
pub struct EmbeddingRuntime {
    shared: Arc<RuntimeShared>,
}

impl EmbeddingRuntime {
    /// Starts provider preparation on a detached background thread. Structural
    /// index publication and all Markdown operations remain independent of model
    /// download, loading, inference, or failure.
    pub fn start<F>(
        publisher: IndexPublisher,
        cache: EmbeddingCache,
        expected_provider: EmbeddingProviderMetadata,
        sync_options: EmbeddingSyncOptions,
        provider_factory: F,
    ) -> Result<Self>
    where
        F: FnOnce() -> Result<Arc<dyn EmbeddingProvider>> + Send + 'static,
    {
        validate_expected_provider(&expected_provider)?;
        let shared = Arc::new(RuntimeShared {
            state: Mutex::new(RuntimeState {
                lifecycle: EmbeddingRuntimeState::Preparing,
                provider: None,
                scheduler: None,
                pending: None,
                last_error_class: None,
                message: Some(
                    "Castle is preparing the on-device multilingual search model".to_owned(),
                ),
                shutdown: false,
            }),
            expected_provider,
        });
        let initializer_shared = Arc::clone(&shared);
        thread::Builder::new()
            .name("castle-embedding-model".to_owned())
            .spawn(move || {
                let initialized = provider_factory().and_then(|provider| {
                    let actual = provider.metadata();
                    if actual != initializer_shared.expected_provider {
                        return Err(anyhow!(
                            "Castle local embedding provider metadata does not match its configured contract"
                        ));
                    }
                    let enricher = EmbeddingEnricher::new(
                        publisher,
                        cache,
                        Arc::clone(&provider),
                        sync_options,
                    )?;
                    Ok((provider, EmbeddingScheduler::start(enricher)?))
                });
                finish_initialization(&initializer_shared, initialized);
            })
            .map_err(|reason| anyhow!("Castle could not start the model initializer: {reason}"))?;
        Ok(Self { shared })
    }

    pub fn schedule(&self, projection: IndexProjection) -> Result<()> {
        let mut state = self.shared.state.lock().map_err(|_| runtime_lock_error())?;
        if state.shutdown {
            return Err(anyhow!("Castle embedding runtime is shut down"));
        }
        if let Some(scheduler) = &state.scheduler {
            scheduler.schedule(projection)?;
            state.lifecycle = EmbeddingRuntimeState::Scheduled;
        } else {
            // Model initialization can take time. Only the newest immutable
            // projection matters once it becomes ready.
            state.pending = Some(projection);
        }
        Ok(())
    }

    pub fn query_embedding(&self, query: &str) -> Result<Option<QueryEmbedding>> {
        let provider = self
            .shared
            .state
            .lock()
            .map_err(|_| runtime_lock_error())?
            .provider
            .clone();
        provider
            .map(|provider| QueryEmbedding::from_provider(provider.as_ref(), query))
            .transpose()
    }

    pub fn provider(&self) -> Result<Option<Arc<dyn EmbeddingProvider>>> {
        self.shared
            .state
            .lock()
            .map(|state| state.provider.clone())
            .map_err(|_| runtime_lock_error())
    }

    pub fn status(&self) -> Result<EmbeddingRuntimeStatus> {
        let state = self.shared.state.lock().map_err(|_| runtime_lock_error())?;
        let scheduler = state
            .scheduler
            .as_ref()
            .map(EmbeddingScheduler::status)
            .transpose()?;
        let lifecycle = scheduler
            .as_ref()
            .map(|status| match status.state {
                EmbeddingSchedulerState::Idle => EmbeddingRuntimeState::Ready,
                EmbeddingSchedulerState::Scheduled => EmbeddingRuntimeState::Scheduled,
                EmbeddingSchedulerState::Running => EmbeddingRuntimeState::Running,
                EmbeddingSchedulerState::Failed => EmbeddingRuntimeState::Failed,
                EmbeddingSchedulerState::Shutdown => EmbeddingRuntimeState::Shutdown,
            })
            .unwrap_or(state.lifecycle);
        Ok(EmbeddingRuntimeStatus {
            state: lifecycle,
            local: true,
            model_ready: state.provider.is_some(),
            provider: self.shared.expected_provider.clone(),
            scheduler,
            last_error_class: state.last_error_class.clone(),
            message: state.message.clone(),
        })
    }

    pub fn shutdown(&self) -> Result<()> {
        let scheduler = {
            let mut state = self.shared.state.lock().map_err(|_| runtime_lock_error())?;
            if state.shutdown {
                return Ok(());
            }
            state.shutdown = true;
            state.lifecycle = EmbeddingRuntimeState::Shutdown;
            state.pending = None;
            state.provider = None;
            state.message = None;
            state.scheduler.take()
        };
        if let Some(mut scheduler) = scheduler {
            scheduler.shutdown()?;
        }
        Ok(())
    }
}

fn finish_initialization(
    shared: &RuntimeShared,
    initialized: Result<(Arc<dyn EmbeddingProvider>, EmbeddingScheduler)>,
) {
    let Ok(mut state) = shared.state.lock() else {
        return;
    };
    if state.shutdown {
        return;
    }
    match initialized {
        Ok((provider, scheduler)) => {
            if let Some(projection) = state.pending.take()
                && let Err(reason) = scheduler.schedule(projection)
            {
                state.lifecycle = EmbeddingRuntimeState::Failed;
                state.last_error_class = Some("embedding_schedule_error".to_owned());
                state.message = Some(reason.to_string());
                return;
            }
            state.provider = Some(provider);
            state.scheduler = Some(scheduler);
            state.lifecycle = if state.pending.is_some() {
                EmbeddingRuntimeState::Scheduled
            } else {
                EmbeddingRuntimeState::Ready
            };
            state.last_error_class = None;
            state.message = None;
        }
        Err(reason) => {
            state.lifecycle = EmbeddingRuntimeState::Failed;
            state.last_error_class = Some("embedding_provider_initialization_error".to_owned());
            state.message = Some(format!("{reason:#}"));
        }
    }
}

fn validate_expected_provider(metadata: &EmbeddingProviderMetadata) -> Result<()> {
    if metadata.provider.trim().is_empty()
        || metadata.model.trim().is_empty()
        || metadata.input_version.trim().is_empty()
        || !(1..=65_536).contains(&metadata.dimensions)
        || !(1..=1_024).contains(&metadata.maximum_batch_size)
    {
        return Err(anyhow!("Castle embedding runtime metadata is invalid"));
    }
    Ok(())
}

fn runtime_lock_error() -> anyhow::Error {
    anyhow!("Castle embedding runtime lock was poisoned")
}

#[cfg(test)]
mod tests {
    use std::{
        fs,
        sync::{Condvar, Mutex},
        time::{Duration, Instant},
    };

    use castle_core::{CompileOptions, build_index_projection, compile_library};

    use super::*;
    use crate::{DeterministicEmbeddingProvider, IndexPublisherOptions, create_library_key};

    fn fixture() -> (tempfile::TempDir, IndexProjection, IndexPublisher) {
        let root = tempfile::tempdir().unwrap();
        let library = root.path().join("library");
        fs::create_dir_all(library.join("notes")).unwrap();
        fs::write(
            library.join("notes/one.md"),
            "# One\n\nZażółć gęślą jaźń. Local semantic retrieval.",
        )
        .unwrap();
        let projection = build_index_projection(
            &compile_library(&CompileOptions::new(&library, root.path())).unwrap(),
        );
        let publisher = IndexPublisher::new(IndexPublisherOptions {
            indexes_root: root.path().join("indexes"),
            library_key: create_library_key(&library).unwrap(),
        })
        .unwrap();
        publisher.publish(&projection).unwrap();
        (root, projection, publisher)
    }

    #[test]
    fn initialization_is_non_blocking_and_coalesces_pending_projection() {
        let (root, projection, publisher) = fixture();
        let gate = Arc::new((Mutex::new(false), Condvar::new()));
        let factory_gate = Arc::clone(&gate);
        let provider = Arc::new(DeterministicEmbeddingProvider::new(16).unwrap());
        let metadata = provider.metadata();
        let started = Instant::now();
        let runtime = EmbeddingRuntime::start(
            publisher.clone(),
            EmbeddingCache::new(root.path().join("embeddings.db")),
            metadata,
            EmbeddingSyncOptions::default(),
            move || {
                let (lock, changed) = &*factory_gate;
                let mut released = lock.lock().unwrap();
                while !*released {
                    released = changed.wait(released).unwrap();
                }
                Ok(provider as Arc<dyn EmbeddingProvider>)
            },
        )
        .unwrap();
        assert!(started.elapsed() < Duration::from_millis(100));
        runtime.schedule(projection.clone()).unwrap();
        runtime.schedule(projection).unwrap();
        assert_eq!(
            runtime.status().unwrap().state,
            EmbeddingRuntimeState::Preparing
        );
        let (lock, changed) = &*gate;
        *lock.lock().unwrap() = true;
        changed.notify_all();
        wait_until_ready(&runtime);
        assert!(
            publisher
                .status()
                .unwrap()
                .manifest
                .unwrap()
                .semantic_available
        );
        runtime.shutdown().unwrap();
    }

    #[test]
    fn provider_failure_is_observable_and_does_not_remove_structural_index() {
        let (root, projection, publisher) = fixture();
        let metadata = DeterministicEmbeddingProvider::new(16).unwrap().metadata();
        let runtime = EmbeddingRuntime::start(
            publisher.clone(),
            EmbeddingCache::new(root.path().join("embeddings.db")),
            metadata,
            EmbeddingSyncOptions::default(),
            || Err(anyhow!("offline")),
        )
        .unwrap();
        runtime.schedule(projection).unwrap();
        let deadline = Instant::now() + Duration::from_secs(2);
        loop {
            let status = runtime.status().unwrap();
            if status.state == EmbeddingRuntimeState::Failed {
                assert_eq!(
                    status.last_error_class.as_deref(),
                    Some("embedding_provider_initialization_error")
                );
                break;
            }
            assert!(Instant::now() < deadline);
            thread::yield_now();
        }
        assert!(
            !publisher
                .status()
                .unwrap()
                .manifest
                .unwrap()
                .semantic_available
        );
    }

    #[test]
    fn ready_runtime_generates_compatible_query_embeddings() {
        let (root, projection, publisher) = fixture();
        let provider = Arc::new(DeterministicEmbeddingProvider::new(16).unwrap());
        let metadata = provider.metadata();
        let runtime = EmbeddingRuntime::start(
            publisher,
            EmbeddingCache::new(root.path().join("embeddings.db")),
            metadata.clone(),
            EmbeddingSyncOptions::default(),
            move || Ok(provider as Arc<dyn EmbeddingProvider>),
        )
        .unwrap();
        runtime.schedule(projection).unwrap();
        wait_until_ready(&runtime);
        let query = runtime.query_embedding("polskie pytanie").unwrap().unwrap();
        assert_eq!(query.model, metadata.model);
        assert_eq!(query.values.len(), metadata.dimensions);
        runtime.shutdown().unwrap();
    }

    fn wait_until_ready(runtime: &EmbeddingRuntime) {
        let deadline = Instant::now() + Duration::from_secs(5);
        loop {
            let status = runtime.status().unwrap();
            if status.state == EmbeddingRuntimeState::Ready
                && status
                    .scheduler
                    .as_ref()
                    .is_some_and(|scheduler| scheduler.published_runs > 0)
            {
                return;
            }
            assert!(
                Instant::now() < deadline,
                "embedding runtime did not become ready"
            );
            thread::sleep(Duration::from_millis(10));
        }
    }
}
