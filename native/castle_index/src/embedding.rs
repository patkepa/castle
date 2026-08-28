use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    thread,
    time::Duration,
};

use anyhow::{Context, Result, anyhow, bail, ensure};
use castle_core::{IndexProjection, normalize_search_text};
use chrono::{SecondsFormat, Utc};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use turso::{Builder, Connection};

use crate::{
    CHUNKING_VERSION, chunk_note,
    publisher::{harden_database_files, remove_empty_sidecars},
};

const EMBEDDING_CACHE_SCHEMA_VERSION: u32 = 4;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct EmbeddingProviderMetadata {
    pub provider: String,
    pub model: String,
    /// Versions tokenization, prefixes, normalization, and other model inputs.
    pub input_version: String,
    pub dimensions: usize,
    pub maximum_batch_size: usize,
}

pub trait EmbeddingProvider: Send + Sync {
    fn metadata(&self) -> EmbeddingProviderMetadata;
    fn embed_batch(
        &self,
        texts: &[String],
        cancellation: &EmbeddingCancellationToken,
    ) -> Result<Vec<Vec<f32>>>;

    /// Embeds a retrieval query. Providers with asymmetric input contracts
    /// (for example E5's `query:`/`passage:` prefixes) override this method.
    fn embed_query(
        &self,
        query: &str,
        cancellation: &EmbeddingCancellationToken,
    ) -> Result<Vec<f32>> {
        let mut values = self.embed_batch(&[query.to_owned()], cancellation)?;
        ensure!(
            values.len() == 1,
            "Castle embedding provider returned the wrong query batch size"
        );
        Ok(values.remove(0))
    }
}

#[derive(Debug, Clone, Default)]
pub struct EmbeddingCancellationToken {
    cancelled: Arc<AtomicBool>,
}

impl EmbeddingCancellationToken {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn cancel(&self) {
        self.cancelled.store(true, Ordering::Release);
    }

    pub fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::Acquire)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EmbeddingFailureClass {
    Retryable,
    Permanent,
}

#[derive(Debug)]
pub struct EmbeddingProviderFailure {
    class: EmbeddingFailureClass,
    message: String,
}

impl EmbeddingProviderFailure {
    pub fn retryable(message: impl Into<String>) -> Self {
        Self {
            class: EmbeddingFailureClass::Retryable,
            message: message.into(),
        }
    }

    pub fn permanent(message: impl Into<String>) -> Self {
        Self {
            class: EmbeddingFailureClass::Permanent,
            message: message.into(),
        }
    }

    pub fn class(&self) -> EmbeddingFailureClass {
        self.class
    }
}

impl std::fmt::Display for EmbeddingProviderFailure {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for EmbeddingProviderFailure {}

#[derive(Debug, Clone)]
pub struct EmbeddingSyncOptions {
    pub maximum_retries_per_batch: usize,
    pub retry_backoff: Duration,
    pub batch_delay: Duration,
}

impl Default for EmbeddingSyncOptions {
    fn default() -> Self {
        Self {
            maximum_retries_per_batch: 2,
            retry_backoff: Duration::from_millis(250),
            batch_delay: Duration::ZERO,
        }
    }
}

/// Deterministic provider for tests and offline architecture verification. Its
/// output is not a semantic model and must not be presented as AI retrieval.
#[derive(Debug, Clone)]
pub struct DeterministicEmbeddingProvider {
    dimensions: usize,
}

impl DeterministicEmbeddingProvider {
    pub fn new(dimensions: usize) -> Result<Self> {
        ensure!(
            (4..=4_096).contains(&dimensions),
            "Castle deterministic embedding dimensions are invalid"
        );
        Ok(Self { dimensions })
    }
}

impl EmbeddingProvider for DeterministicEmbeddingProvider {
    fn metadata(&self) -> EmbeddingProviderMetadata {
        EmbeddingProviderMetadata {
            provider: "castle_test".to_owned(),
            model: "deterministic_hash_v1".to_owned(),
            input_version: "normalized_tokens_v1".to_owned(),
            dimensions: self.dimensions,
            maximum_batch_size: 128,
        }
    }

    fn embed_batch(
        &self,
        texts: &[String],
        cancellation: &EmbeddingCancellationToken,
    ) -> Result<Vec<Vec<f32>>> {
        ensure!(
            !cancellation.is_cancelled(),
            "Castle embedding generation was cancelled"
        );
        Ok(texts
            .iter()
            .map(|text| deterministic_embedding(text, self.dimensions))
            .collect())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EmbeddingRecord {
    pub content_hash: String,
    pub provider: String,
    pub model: String,
    pub input_version: String,
    pub dimensions: usize,
    pub values: Vec<f32>,
}

#[derive(Debug, Clone, Default)]
pub struct EmbeddingSet {
    records: HashMap<String, EmbeddingRecord>,
    metadata: Option<EmbeddingProviderMetadata>,
    expected_unique_content_count: usize,
    complete: bool,
}

impl EmbeddingSet {
    pub fn get(&self, content_hash: &str) -> Option<&EmbeddingRecord> {
        self.records.get(content_hash)
    }

    pub fn len(&self) -> usize {
        self.records.len()
    }

    pub fn is_empty(&self) -> bool {
        self.records.is_empty()
    }

    pub fn metadata(&self) -> Option<EmbeddingProviderMetadata> {
        self.metadata.clone()
    }

    pub fn is_complete(&self) -> bool {
        self.complete && self.records.len() == self.expected_unique_content_count
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EmbeddingSyncResult {
    #[serde(skip)]
    pub embeddings: EmbeddingSet,
    pub chunk_count: usize,
    pub unique_content_count: usize,
    pub cache_hits: usize,
    pub generated: usize,
    pub pending: usize,
    pub retries: usize,
    pub completed: bool,
    pub provider: EmbeddingProviderMetadata,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct EmbeddingCacheStatus {
    pub provider: String,
    pub model: String,
    pub input_version: String,
    pub dimensions: usize,
    pub pending: usize,
    pub running: usize,
    pub retry_wait: usize,
    pub failed: usize,
    pub completed: usize,
}

#[derive(Debug, Clone)]
pub struct QueryEmbedding {
    pub provider: String,
    pub model: String,
    pub input_version: String,
    pub values: Vec<f32>,
}

impl QueryEmbedding {
    pub fn from_provider(provider: &dyn EmbeddingProvider, query: &str) -> Result<Self> {
        ensure!(
            !query.trim().is_empty(),
            "Castle cannot embed an empty query"
        );
        let metadata = provider.metadata();
        ensure!(
            !metadata.provider.trim().is_empty()
                && !metadata.model.trim().is_empty()
                && !metadata.input_version.trim().is_empty()
                && (1..=65_536).contains(&metadata.dimensions),
            "Castle embedding provider metadata is invalid"
        );
        let values = provider.embed_query(query, &EmbeddingCancellationToken::new())?;
        validate_vector(&values, metadata.dimensions)?;
        Ok(Self {
            provider: metadata.provider,
            model: metadata.model,
            input_version: metadata.input_version,
            values,
        })
    }
}

#[derive(Debug, Clone)]
pub struct EmbeddingCache {
    database_path: PathBuf,
}

impl EmbeddingCache {
    pub fn new(database_path: impl Into<PathBuf>) -> Self {
        Self {
            database_path: database_path.into(),
        }
    }

    pub fn synchronize(
        &self,
        projection: &IndexProjection,
        provider: &dyn EmbeddingProvider,
    ) -> Result<EmbeddingSyncResult> {
        self.synchronize_controlled(
            projection,
            provider,
            &EmbeddingCancellationToken::new(),
            &EmbeddingSyncOptions::default(),
        )
    }

    pub fn synchronize_controlled(
        &self,
        projection: &IndexProjection,
        provider: &dyn EmbeddingProvider,
        cancellation: &EmbeddingCancellationToken,
        options: &EmbeddingSyncOptions,
    ) -> Result<EmbeddingSyncResult> {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .context("Castle could not start the embedding-cache runtime")?;
        let result =
            runtime.block_on(self.synchronize_async(projection, provider, cancellation, options));
        if self.database_path.exists() {
            harden_database_files(&self.database_path)?;
            remove_empty_sidecars(&self.database_path)?;
        }
        result
    }

    pub fn status(&self, metadata: &EmbeddingProviderMetadata) -> Result<EmbeddingCacheStatus> {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .context("Castle could not start the embedding-cache runtime")?;
        runtime.block_on(self.status_async(metadata))
    }

    async fn synchronize_async(
        &self,
        projection: &IndexProjection,
        provider: &dyn EmbeddingProvider,
        cancellation: &EmbeddingCancellationToken,
        options: &EmbeddingSyncOptions,
    ) -> Result<EmbeddingSyncResult> {
        if let Some(parent) = self.database_path.parent() {
            create_private_directory(parent)?;
        }
        let database = Builder::new_local(utf8_path(&self.database_path)?)
            .build()
            .await
            .context("Castle could not open the embedding cache")?;
        let mut connection = database
            .connect()
            .context("Castle could not connect to the embedding cache")?;
        connection
            .execute_batch(
                "CREATE TABLE IF NOT EXISTS cache_metadata (
                   key TEXT PRIMARY KEY, value TEXT NOT NULL
                 );",
            )
            .await?;
        if load_cache_schema_version(&connection).await? != Some(EMBEDDING_CACHE_SCHEMA_VERSION) {
            connection
                .execute_batch(
                    "DROP TABLE IF EXISTS embedding_jobs;
                     DROP TABLE IF EXISTS embeddings;",
                )
                .await?;
        }
        connection
            .execute_batch(
                "CREATE TABLE IF NOT EXISTS embeddings (
                   cache_key TEXT PRIMARY KEY,
                   content_hash TEXT NOT NULL,
                   provider TEXT NOT NULL,
                   model TEXT NOT NULL,
                   input_version TEXT NOT NULL,
                   dimensions INTEGER NOT NULL,
                   chunking_version INTEGER NOT NULL,
                   values_json TEXT NOT NULL,
                   UNIQUE(
                     content_hash, provider, model, input_version,
                     dimensions, chunking_version
                   )
                 );
                 CREATE INDEX IF NOT EXISTS embeddings_content
                   ON embeddings(
                     content_hash, provider, model, input_version,
                     dimensions, chunking_version
                   );
                 CREATE TABLE IF NOT EXISTS embedding_jobs (
                   cache_key TEXT PRIMARY KEY,
                   content_hash TEXT NOT NULL,
                   provider TEXT NOT NULL,
                   model TEXT NOT NULL,
                   input_version TEXT NOT NULL,
                   dimensions INTEGER NOT NULL,
                   chunking_version INTEGER NOT NULL,
                   source_fingerprint TEXT NOT NULL,
                   status TEXT NOT NULL CHECK (
                     status IN ('pending', 'running', 'retry_wait', 'failed', 'completed')
                   ),
                   attempts INTEGER NOT NULL DEFAULT 0,
                   last_error_class TEXT,
                   updated_at TEXT NOT NULL,
                   UNIQUE(
                     content_hash, provider, model, input_version,
                     dimensions, chunking_version
                   )
                 );
                 CREATE INDEX IF NOT EXISTS embedding_jobs_status
                   ON embedding_jobs(
                     provider, model, input_version, dimensions,
                     chunking_version, status
                   );",
            )
            .await?;
        connection
            .execute(
                "INSERT OR REPLACE INTO cache_metadata (key, value) VALUES (?1, ?2)",
                ("schema_version", EMBEDDING_CACHE_SCHEMA_VERSION.to_string()),
            )
            .await?;

        let metadata = provider.metadata();
        ensure!(
            !metadata.provider.trim().is_empty()
                && !metadata.model.trim().is_empty()
                && !metadata.input_version.trim().is_empty()
                && (1..=65_536).contains(&metadata.dimensions)
                && (1..=1_024).contains(&metadata.maximum_batch_size),
            "Castle embedding provider metadata is invalid"
        );
        let chunks = projection
            .notes
            .iter()
            .flat_map(chunk_note)
            .collect::<Vec<_>>();
        let unique = chunks
            .iter()
            .map(|chunk| (chunk.content_hash.clone(), chunk.plain_text.clone()))
            .collect::<std::collections::BTreeMap<_, _>>();
        let mut records = HashMap::new();
        let mut missing = Vec::<(String, String)>::new();
        let mut cache_hits = 0;
        for (content_hash, text) in unique {
            if let Some(record) = load_cached(&connection, &content_hash, &metadata).await? {
                if validate_vector(&record.values, metadata.dimensions).is_ok() {
                    upsert_job(
                        &mut connection,
                        &record.content_hash,
                        &metadata,
                        &projection.source_fingerprint,
                        "completed",
                    )
                    .await?;
                    records.insert(content_hash, record);
                    cache_hits += 1;
                    continue;
                }
                delete_cached(&connection, &content_hash, &metadata).await?;
            }
            upsert_job(
                &mut connection,
                &content_hash,
                &metadata,
                &projection.source_fingerprint,
                "pending",
            )
            .await?;
            missing.push((content_hash, text));
        }
        prune_obsolete_jobs(&mut connection, &metadata, &projection.source_fingerprint).await?;

        let mut generated = 0;
        let mut retries = 0;
        for batch in missing.chunks(metadata.maximum_batch_size) {
            if cancellation.is_cancelled() {
                break;
            }
            let texts = batch
                .iter()
                .map(|(_, text)| text.clone())
                .collect::<Vec<_>>();
            let hashes = batch
                .iter()
                .map(|(content_hash, _)| content_hash.as_str())
                .collect::<Vec<_>>();
            let mut batch_retries = 0;
            let vectors = loop {
                mark_jobs(&mut connection, &hashes, &metadata, "running", None, true).await?;
                match provider.embed_batch(&texts, cancellation) {
                    Ok(vectors) => break vectors,
                    Err(_reason) if cancellation.is_cancelled() => {
                        mark_jobs(&mut connection, &hashes, &metadata, "pending", None, false)
                            .await?;
                        break Vec::new();
                    }
                    Err(reason) => {
                        let class = provider_failure_class(&reason);
                        let class_name = failure_class_name(class);
                        if class == EmbeddingFailureClass::Retryable
                            && batch_retries < options.maximum_retries_per_batch
                        {
                            mark_jobs(
                                &mut connection,
                                &hashes,
                                &metadata,
                                "retry_wait",
                                Some(class_name),
                                false,
                            )
                            .await?;
                            batch_retries += 1;
                            retries += 1;
                            if wait_with_cancellation(options.retry_backoff, cancellation) {
                                break Vec::new();
                            }
                            continue;
                        }
                        mark_jobs(
                            &mut connection,
                            &hashes,
                            &metadata,
                            "failed",
                            Some(class_name),
                            false,
                        )
                        .await?;
                        return Err(reason)
                            .context(format!("Castle embedding batch failed ({class_name})"));
                    }
                }
            };
            if cancellation.is_cancelled() {
                break;
            }
            if vectors.len() != batch.len()
                || vectors
                    .iter()
                    .any(|values| validate_vector(values, metadata.dimensions).is_err())
            {
                mark_jobs(
                    &mut connection,
                    &hashes,
                    &metadata,
                    "failed",
                    Some("invalid_provider_output"),
                    false,
                )
                .await?;
                bail!("Castle embedding provider returned invalid vectors");
            }
            let transaction = connection.transaction().await?;
            let mut insert = transaction
                .prepare(
                    "INSERT OR REPLACE INTO embeddings (
                       cache_key, content_hash, provider, model, input_version,
                       dimensions, chunking_version, values_json
                     ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                )
                .await?;
            for ((content_hash, _), values) in batch.iter().zip(vectors) {
                let record = EmbeddingRecord {
                    content_hash: content_hash.clone(),
                    provider: metadata.provider.clone(),
                    model: metadata.model.clone(),
                    input_version: metadata.input_version.clone(),
                    dimensions: metadata.dimensions,
                    values,
                };
                insert
                    .execute((
                        cache_key(&record),
                        record.content_hash.clone(),
                        record.provider.clone(),
                        record.model.clone(),
                        record.input_version.clone(),
                        record.dimensions as i64,
                        CHUNKING_VERSION as i64,
                        serde_json::to_string(&record.values)?,
                    ))
                    .await?;
                records.insert(content_hash.clone(), record);
                generated += 1;
            }
            drop(insert);
            transaction.commit().await?;
            mark_jobs(
                &mut connection,
                &hashes,
                &metadata,
                "completed",
                None,
                false,
            )
            .await?;
            if wait_with_cancellation(options.batch_delay, cancellation) {
                break;
            }
        }
        let pending = missing.len().saturating_sub(generated);
        let completed = pending == 0;
        Ok(EmbeddingSyncResult {
            chunk_count: chunks.len(),
            unique_content_count: cache_hits + missing.len(),
            cache_hits,
            generated,
            pending,
            retries,
            completed,
            embeddings: EmbeddingSet {
                records,
                metadata: Some(metadata.clone()),
                expected_unique_content_count: cache_hits + missing.len(),
                complete: completed,
            },
            provider: metadata,
        })
    }

    async fn status_async(
        &self,
        metadata: &EmbeddingProviderMetadata,
    ) -> Result<EmbeddingCacheStatus> {
        if !self.database_path.is_file() {
            return Ok(EmbeddingCacheStatus {
                provider: metadata.provider.clone(),
                model: metadata.model.clone(),
                input_version: metadata.input_version.clone(),
                dimensions: metadata.dimensions,
                pending: 0,
                running: 0,
                retry_wait: 0,
                failed: 0,
                completed: 0,
            });
        }
        let database = Builder::new_local(utf8_path(&self.database_path)?)
            .build()
            .await
            .context("Castle could not open the embedding cache")?;
        let connection = database
            .connect()
            .context("Castle could not connect to the embedding cache")?;
        let mut status = EmbeddingCacheStatus {
            provider: metadata.provider.clone(),
            model: metadata.model.clone(),
            input_version: metadata.input_version.clone(),
            dimensions: metadata.dimensions,
            pending: 0,
            running: 0,
            retry_wait: 0,
            failed: 0,
            completed: 0,
        };
        let mut rows = connection
            .query(
                "SELECT status, COUNT(*) FROM embedding_jobs
                 WHERE provider = ?1 AND model = ?2 AND input_version = ?3
                   AND dimensions = ?4 AND chunking_version = ?5
                 GROUP BY status",
                (
                    metadata.provider.as_str(),
                    metadata.model.as_str(),
                    metadata.input_version.as_str(),
                    metadata.dimensions as i64,
                    CHUNKING_VERSION as i64,
                ),
            )
            .await?;
        while let Some(row) = rows.next().await? {
            let state: String = row.get(0)?;
            let count: i64 = row.get(1)?;
            let count = usize::try_from(count).context("Castle embedding job count is invalid")?;
            match state.as_str() {
                "pending" => status.pending = count,
                "running" => status.running = count,
                "retry_wait" => status.retry_wait = count,
                "failed" => status.failed = count,
                "completed" => status.completed = count,
                _ => return Err(anyhow!("Castle embedding job status is invalid")),
            }
        }
        Ok(status)
    }
}

async fn load_cached(
    connection: &Connection,
    content_hash: &str,
    metadata: &EmbeddingProviderMetadata,
) -> Result<Option<EmbeddingRecord>> {
    let mut rows = connection
        .query(
            "SELECT values_json FROM embeddings
             WHERE content_hash = ?1 AND provider = ?2 AND model = ?3
               AND input_version = ?4 AND dimensions = ?5
               AND chunking_version = ?6",
            (
                content_hash,
                metadata.provider.as_str(),
                metadata.model.as_str(),
                metadata.input_version.as_str(),
                metadata.dimensions as i64,
                CHUNKING_VERSION as i64,
            ),
        )
        .await?;
    let Some(row) = rows.next().await? else {
        return Ok(None);
    };
    let values_json: String = row.get(0)?;
    drop(rows);
    let Ok(values) = serde_json::from_str(&values_json) else {
        delete_cached(connection, content_hash, metadata).await?;
        return Ok(None);
    };
    Ok(Some(EmbeddingRecord {
        content_hash: content_hash.to_owned(),
        provider: metadata.provider.clone(),
        model: metadata.model.clone(),
        input_version: metadata.input_version.clone(),
        dimensions: metadata.dimensions,
        values,
    }))
}

async fn delete_cached(
    connection: &Connection,
    content_hash: &str,
    metadata: &EmbeddingProviderMetadata,
) -> Result<()> {
    connection
        .execute(
            "DELETE FROM embeddings
             WHERE content_hash = ?1 AND provider = ?2 AND model = ?3
               AND input_version = ?4 AND dimensions = ?5
               AND chunking_version = ?6",
            (
                content_hash,
                metadata.provider.as_str(),
                metadata.model.as_str(),
                metadata.input_version.as_str(),
                metadata.dimensions as i64,
                CHUNKING_VERSION as i64,
            ),
        )
        .await?;
    Ok(())
}

async fn load_cache_schema_version(connection: &Connection) -> Result<Option<u32>> {
    let mut rows = connection
        .query(
            "SELECT value FROM cache_metadata WHERE key = 'schema_version'",
            (),
        )
        .await?;
    let Some(row) = rows.next().await? else {
        return Ok(None);
    };
    let value: String = row.get(0)?;
    Ok(value.parse().ok())
}

async fn upsert_job(
    connection: &mut Connection,
    content_hash: &str,
    metadata: &EmbeddingProviderMetadata,
    source_fingerprint: &str,
    status: &str,
) -> Result<()> {
    let now = Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true);
    connection
        .execute(
            "INSERT INTO embedding_jobs (
               cache_key, content_hash, provider, model, input_version,
               dimensions, chunking_version, source_fingerprint, status, attempts,
               last_error_class, updated_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 0, NULL, ?10)
             ON CONFLICT(cache_key) DO UPDATE SET
               source_fingerprint = excluded.source_fingerprint,
               status = excluded.status,
               last_error_class = NULL,
               updated_at = excluded.updated_at",
            (
                cache_key_for(content_hash, metadata),
                content_hash,
                metadata.provider.as_str(),
                metadata.model.as_str(),
                metadata.input_version.as_str(),
                metadata.dimensions as i64,
                CHUNKING_VERSION as i64,
                source_fingerprint,
                status,
                now,
            ),
        )
        .await?;
    Ok(())
}

async fn prune_obsolete_jobs(
    connection: &mut Connection,
    metadata: &EmbeddingProviderMetadata,
    source_fingerprint: &str,
) -> Result<()> {
    connection
        .execute(
            "DELETE FROM embedding_jobs
             WHERE provider = ?1 AND model = ?2 AND input_version = ?3
               AND dimensions = ?4 AND chunking_version = ?5
               AND source_fingerprint <> ?6",
            (
                metadata.provider.as_str(),
                metadata.model.as_str(),
                metadata.input_version.as_str(),
                metadata.dimensions as i64,
                CHUNKING_VERSION as i64,
                source_fingerprint,
            ),
        )
        .await?;
    Ok(())
}

async fn mark_jobs(
    connection: &mut Connection,
    content_hashes: &[&str],
    metadata: &EmbeddingProviderMetadata,
    status: &str,
    error_class: Option<&str>,
    increment_attempts: bool,
) -> Result<()> {
    let now = Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true);
    let transaction = connection.transaction().await?;
    let mut update = transaction
        .prepare(
            "UPDATE embedding_jobs
             SET status = ?1,
                 attempts = attempts + ?2,
                 last_error_class = ?3,
                 updated_at = ?4
             WHERE cache_key = ?5",
        )
        .await?;
    for content_hash in content_hashes {
        update
            .execute((
                status,
                i64::from(increment_attempts),
                error_class,
                now.as_str(),
                cache_key_for(content_hash, metadata),
            ))
            .await?;
    }
    drop(update);
    transaction.commit().await?;
    Ok(())
}

fn provider_failure_class(reason: &anyhow::Error) -> EmbeddingFailureClass {
    reason
        .downcast_ref::<EmbeddingProviderFailure>()
        .map(EmbeddingProviderFailure::class)
        .unwrap_or(EmbeddingFailureClass::Permanent)
}

fn failure_class_name(class: EmbeddingFailureClass) -> &'static str {
    match class {
        EmbeddingFailureClass::Retryable => "retryable_provider_error",
        EmbeddingFailureClass::Permanent => "permanent_provider_error",
    }
}

fn wait_with_cancellation(duration: Duration, cancellation: &EmbeddingCancellationToken) -> bool {
    let poll_interval = Duration::from_millis(10);
    let mut remaining = duration;
    while !remaining.is_zero() {
        if cancellation.is_cancelled() {
            return true;
        }
        let delay = remaining.min(poll_interval);
        thread::sleep(delay);
        remaining = remaining.saturating_sub(delay);
    }
    cancellation.is_cancelled()
}

fn deterministic_embedding(text: &str, dimensions: usize) -> Vec<f32> {
    let mut values = vec![0.0_f32; dimensions];
    for token in normalize_search_text(text).split_whitespace() {
        let digest = Sha256::digest(token.as_bytes());
        let index = u64::from_le_bytes(digest[..8].try_into().unwrap()) as usize % dimensions;
        let sign = if digest[8] & 1 == 0 { 1.0 } else { -1.0 };
        values[index] += sign;
    }
    let norm = values.iter().map(|value| value * value).sum::<f32>().sqrt();
    if norm > 0.0 {
        for value in &mut values {
            *value /= norm;
        }
    }
    values
}

fn validate_vector(values: &[f32], dimensions: usize) -> Result<()> {
    let norm_squared = values.iter().map(|value| value * value).sum::<f32>();
    ensure!(
        values.len() == dimensions
            && values.iter().all(|value| value.is_finite())
            && norm_squared.is_finite()
            && norm_squared > f32::EPSILON,
        "Castle rejected an embedding with incompatible dimensions or values"
    );
    Ok(())
}

fn cache_key(record: &EmbeddingRecord) -> String {
    cache_key_for(
        &record.content_hash,
        &EmbeddingProviderMetadata {
            provider: record.provider.clone(),
            model: record.model.clone(),
            input_version: record.input_version.clone(),
            dimensions: record.dimensions,
            maximum_batch_size: 0,
        },
    )
}

fn cache_key_for(content_hash: &str, metadata: &EmbeddingProviderMetadata) -> String {
    let mut digest = Sha256::new();
    digest.update(content_hash.as_bytes());
    digest.update([0]);
    digest.update(metadata.provider.as_bytes());
    digest.update([0]);
    digest.update(metadata.model.as_bytes());
    digest.update([0]);
    digest.update(metadata.input_version.as_bytes());
    digest.update([0]);
    digest.update(metadata.dimensions.to_le_bytes());
    digest.update([0]);
    digest.update(CHUNKING_VERSION.to_le_bytes());
    format!("{:x}", digest.finalize())
}

fn create_private_directory(path: &Path) -> Result<()> {
    fs::create_dir_all(path)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o700))?;
    }
    Ok(())
}

fn utf8_path(path: &Path) -> Result<&str> {
    path.to_str()
        .ok_or_else(|| anyhow!("Castle requires a UTF-8 embedding-cache path"))
}

#[cfg(test)]
mod tests {
    use std::{
        collections::BTreeMap,
        fs,
        sync::{
            Mutex,
            atomic::{AtomicUsize, Ordering},
        },
    };

    use castle_core::{CompileOptions, build_index_projection, compile_library};

    use super::*;

    struct ScriptedProvider {
        metadata: EmbeddingProviderMetadata,
        calls: AtomicUsize,
        failures: Mutex<BTreeMap<usize, EmbeddingFailureClass>>,
        cancel_on_call: Option<usize>,
    }

    impl ScriptedProvider {
        fn new(maximum_batch_size: usize) -> Self {
            Self {
                metadata: EmbeddingProviderMetadata {
                    provider: "scripted_test".to_owned(),
                    model: "scripted_v1".to_owned(),
                    input_version: "scripted_input_v1".to_owned(),
                    dimensions: 16,
                    maximum_batch_size,
                },
                calls: AtomicUsize::new(0),
                failures: Mutex::new(BTreeMap::new()),
                cancel_on_call: None,
            }
        }

        fn failing(self, call: usize, class: EmbeddingFailureClass) -> Self {
            self.failures.lock().unwrap().insert(call, class);
            self
        }

        fn cancelling(mut self, call: usize) -> Self {
            self.cancel_on_call = Some(call);
            self
        }

        fn with_input_version(mut self, input_version: &str) -> Self {
            self.metadata.input_version = input_version.to_owned();
            self
        }
    }

    impl EmbeddingProvider for ScriptedProvider {
        fn metadata(&self) -> EmbeddingProviderMetadata {
            self.metadata.clone()
        }

        fn embed_batch(
            &self,
            texts: &[String],
            cancellation: &EmbeddingCancellationToken,
        ) -> Result<Vec<Vec<f32>>> {
            let call = self.calls.fetch_add(1, Ordering::SeqCst) + 1;
            if self.cancel_on_call == Some(call) {
                cancellation.cancel();
                return Err(anyhow!("scripted cancellation"));
            }
            if let Some(class) = self.failures.lock().unwrap().remove(&call) {
                return Err(anyhow!(match class {
                    EmbeddingFailureClass::Retryable => {
                        EmbeddingProviderFailure::retryable("temporary scripted failure")
                    }
                    EmbeddingFailureClass::Permanent => {
                        EmbeddingProviderFailure::permanent("permanent scripted failure")
                    }
                }));
            }
            Ok(texts
                .iter()
                .map(|text| deterministic_embedding(text, self.metadata.dimensions))
                .collect())
        }
    }

    struct InvalidOutputProvider;

    impl EmbeddingProvider for InvalidOutputProvider {
        fn metadata(&self) -> EmbeddingProviderMetadata {
            EmbeddingProviderMetadata {
                provider: "invalid_test".to_owned(),
                model: "invalid_v1".to_owned(),
                input_version: "invalid_input_v1".to_owned(),
                dimensions: 16,
                maximum_batch_size: 128,
            }
        }

        fn embed_batch(
            &self,
            _texts: &[String],
            _cancellation: &EmbeddingCancellationToken,
        ) -> Result<Vec<Vec<f32>>> {
            Ok(vec![vec![f32::NAN; 16]])
        }
    }

    fn projection(root: &Path) -> IndexProjection {
        let library = root.join("library/notes");
        fs::create_dir_all(&library).unwrap();
        fs::write(library.join("one.md"), "# One\n\nAlpha material.").unwrap();
        fs::write(library.join("two.md"), "# Two\n\nBeta material.").unwrap();
        fs::write(library.join("three.md"), "# Three\n\nGamma material.").unwrap();
        let compilation =
            compile_library(&CompileOptions::new(root.join("library"), root)).unwrap();
        build_index_projection(&compilation)
    }

    #[test]
    fn reuses_content_addressed_embeddings_and_rejects_dimension_changes() {
        let root = tempfile::tempdir().unwrap();
        let library = root.path().join("library/notes");
        fs::create_dir_all(&library).unwrap();
        fs::write(library.join("one.md"), "# One\n\nShared content.").unwrap();
        fs::write(library.join("two.md"), "# Two\n\nShared content.").unwrap();
        let compilation = compile_library(&CompileOptions::new(
            root.path().join("library"),
            root.path(),
        ))
        .unwrap();
        let projection = build_index_projection(&compilation);
        let cache = EmbeddingCache::new(root.path().join("cache/embeddings.db"));
        let provider = DeterministicEmbeddingProvider::new(16).unwrap();

        let first = cache.synchronize(&projection, &provider).unwrap();
        let second = cache.synchronize(&projection, &provider).unwrap();
        assert!(first.generated > 0);
        assert_eq!(second.generated, 0);
        assert_eq!(second.cache_hits, first.unique_content_count);
        assert_eq!(second.embeddings.len(), first.embeddings.len());

        let different_dimensions = DeterministicEmbeddingProvider::new(24).unwrap();
        let changed = cache
            .synchronize(&projection, &different_dimensions)
            .unwrap();
        assert_eq!(changed.generated, changed.unique_content_count);
    }

    #[test]
    fn retries_classified_failures_and_records_only_aggregate_job_state() {
        let root = tempfile::tempdir().unwrap();
        let projection = projection(root.path());
        let cache = EmbeddingCache::new(root.path().join("cache/embeddings.db"));
        let provider = ScriptedProvider::new(128).failing(1, EmbeddingFailureClass::Retryable);
        let result = cache
            .synchronize_controlled(
                &projection,
                &provider,
                &EmbeddingCancellationToken::new(),
                &EmbeddingSyncOptions {
                    maximum_retries_per_batch: 1,
                    retry_backoff: Duration::ZERO,
                    batch_delay: Duration::ZERO,
                },
            )
            .unwrap();

        assert!(result.completed);
        assert_eq!(result.retries, 1);
        assert_eq!(provider.calls.load(Ordering::SeqCst), 2);
        let status = cache.status(&provider.metadata()).unwrap();
        assert_eq!(status.completed, result.unique_content_count);
        assert_eq!(
            status.pending + status.running + status.retry_wait + status.failed,
            0
        );
    }

    #[test]
    fn resumes_after_failure_without_regenerating_committed_batches() {
        let root = tempfile::tempdir().unwrap();
        let projection = projection(root.path());
        let cache = EmbeddingCache::new(root.path().join("cache/embeddings.db"));
        let failing = ScriptedProvider::new(1).failing(2, EmbeddingFailureClass::Permanent);
        assert!(cache.synchronize(&projection, &failing).is_err());
        let interrupted = cache.status(&failing.metadata()).unwrap();
        assert_eq!(interrupted.completed, 1);
        assert!(interrupted.failed >= 1);

        let resumed = ScriptedProvider::new(1);
        let result = cache.synchronize(&projection, &resumed).unwrap();
        assert!(result.completed);
        assert_eq!(result.cache_hits, 1);
        assert_eq!(
            result.generated + result.cache_hits,
            result.unique_content_count
        );
        assert_eq!(
            resumed.calls.load(Ordering::SeqCst),
            result.unique_content_count - 1
        );
    }

    #[test]
    fn cancellation_keeps_committed_batches_and_leaves_remaining_work_pending() {
        let root = tempfile::tempdir().unwrap();
        let projection = projection(root.path());
        let cache = EmbeddingCache::new(root.path().join("cache/embeddings.db"));
        let provider = ScriptedProvider::new(1).cancelling(2);
        let cancellation = EmbeddingCancellationToken::new();
        let result = cache
            .synchronize_controlled(
                &projection,
                &provider,
                &cancellation,
                &EmbeddingSyncOptions::default(),
            )
            .unwrap();

        assert!(cancellation.is_cancelled());
        assert!(!result.completed);
        assert_eq!(result.generated, 1);
        assert_eq!(
            result.pending + result.generated,
            result.unique_content_count
        );
        let status = cache.status(&provider.metadata()).unwrap();
        assert_eq!(status.completed, 1);
        assert_eq!(status.failed, 0);
        assert_eq!(status.pending, result.pending);
    }

    #[test]
    fn rejects_invalid_provider_output_and_records_a_permanent_failure() {
        let root = tempfile::tempdir().unwrap();
        let projection = projection(root.path());
        let cache = EmbeddingCache::new(root.path().join("cache/embeddings.db"));
        let provider = InvalidOutputProvider;

        assert!(cache.synchronize(&projection, &provider).is_err());
        let status = cache.status(&provider.metadata()).unwrap();
        assert_eq!(status.failed, projection.notes.len());
        assert_eq!(status.completed, 0);
        assert_eq!(status.running, 0);
    }

    #[test]
    fn removes_obsolete_work_rows_but_reuses_content_addressed_vectors() {
        let root = tempfile::tempdir().unwrap();
        let mut projection = projection(root.path());
        let cache = EmbeddingCache::new(root.path().join("cache/embeddings.db"));
        let provider = ScriptedProvider::new(128);
        let first = cache.synchronize(&projection, &provider).unwrap();
        assert!(first.unique_content_count > 1);

        projection.notes.pop();
        projection.source_fingerprint = "d".repeat(64);
        let second = cache.synchronize(&projection, &provider).unwrap();
        let status = cache.status(&provider.metadata()).unwrap();
        assert!(second.completed);
        assert_eq!(second.generated, 0);
        assert_eq!(second.cache_hits, second.unique_content_count);
        assert_eq!(status.completed, second.unique_content_count);
        assert!(status.completed < first.unique_content_count);
    }

    #[test]
    fn namespaces_cached_vectors_by_the_complete_model_input_contract() {
        let root = tempfile::tempdir().unwrap();
        let projection = projection(root.path());
        let cache = EmbeddingCache::new(root.path().join("cache/embeddings.db"));
        let first_provider = ScriptedProvider::new(128);
        let first = cache.synchronize(&projection, &first_provider).unwrap();
        let changed_provider = ScriptedProvider::new(128).with_input_version("scripted_input_v2");
        let changed = cache.synchronize(&projection, &changed_provider).unwrap();

        assert_eq!(changed.cache_hits, 0);
        assert_eq!(changed.generated, first.unique_content_count);
        assert_eq!(changed.unique_content_count, first.unique_content_count);
    }

    #[test]
    fn regenerates_only_content_hashes_changed_by_a_markdown_edit() {
        let root = tempfile::tempdir().unwrap();
        let first_projection = projection(root.path());
        let cache = EmbeddingCache::new(root.path().join("cache/embeddings.db"));
        let provider = ScriptedProvider::new(128);
        let first = cache.synchronize(&first_projection, &provider).unwrap();

        fs::write(
            root.path().join("library/notes/one.md"),
            "# One\n\nChanged alpha material.",
        )
        .unwrap();
        let compilation = compile_library(&CompileOptions::new(
            root.path().join("library"),
            root.path(),
        ))
        .unwrap();
        let changed_projection = build_index_projection(&compilation);
        let changed = cache.synchronize(&changed_projection, &provider).unwrap();

        assert_eq!(changed.unique_content_count, first.unique_content_count);
        assert_eq!(changed.generated, 1);
        assert_eq!(changed.cache_hits + 1, first.unique_content_count);
    }

    #[test]
    fn regenerates_corrupt_cached_vectors_without_losing_work() {
        let root = tempfile::tempdir().unwrap();
        let projection = projection(root.path());
        let database_path = root.path().join("cache/embeddings.db");
        let cache = EmbeddingCache::new(&database_path);
        let provider = ScriptedProvider::new(128);
        let first = cache.synchronize(&projection, &provider).unwrap();

        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        runtime.block_on(async {
            let database = Builder::new_local(database_path.to_str().unwrap())
                .build()
                .await
                .unwrap();
            let connection = database.connect().unwrap();
            connection
                .execute("UPDATE embeddings SET values_json = 'broken'", ())
                .await
                .unwrap();
        });

        let recovered = cache.synchronize(&projection, &provider).unwrap();
        assert!(recovered.completed);
        assert_eq!(recovered.cache_hits, 0);
        assert_eq!(recovered.generated, first.unique_content_count);
    }
}
