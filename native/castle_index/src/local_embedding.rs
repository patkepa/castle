use std::{fs, path::PathBuf, sync::Mutex};

use anyhow::{Context, Result, ensure};
use fastembed::{
    InitOptionsUserDefined, Pooling, TextEmbedding, TokenizerFiles, UserDefinedEmbeddingModel,
};
use hf_hub::{Repo, RepoType, api::sync::ApiBuilder};
use sha2::{Digest, Sha256};

use crate::{
    EmbeddingCancellationToken, EmbeddingProvider, EmbeddingProviderFailure,
    EmbeddingProviderMetadata,
};

pub const LOCAL_EMBEDDING_PROVIDER: &str = "fastembed_local";
pub const LOCAL_EMBEDDING_MODEL: &str = "intfloat/multilingual-e5-small";
pub const LOCAL_EMBEDDING_MODEL_REVISION: &str = "0e60b8d9d2166d80387f86e3b48ec9ced55f4d15";
pub const LOCAL_EMBEDDING_INPUT_VERSION: &str =
    "e5_retrieval_v1_rev_0e60b8d_query_passage_prefix_mean_l2_max512_fastembed5";
pub const LOCAL_EMBEDDING_DIMENSIONS: usize = 384;
pub const LOCAL_EMBEDDING_MAXIMUM_BATCH_SIZE: usize = 16;
const LOCAL_EMBEDDING_MAXIMUM_TOKENS: usize = 512;
const MODEL_ASSET: ModelAsset = ModelAsset {
    path: "onnx/model.onnx",
    bytes: 470_268_510,
    sha256: Some("ca456c06b3a9505ddfd9131408916dd79290368331e7d76bb621f1cba6bc8665"),
};
const TOKENIZER_ASSET: ModelAsset = ModelAsset {
    path: "onnx/tokenizer.json",
    bytes: 17_082_730,
    sha256: Some("0b44a9d7b51c3c62626640cda0e2c2f70fdacdc25bbbd68038369d14ebdf4c39"),
};
const CONFIG_ASSET: ModelAsset = ModelAsset {
    path: "onnx/config.json",
    bytes: 653,
    sha256: Some("bbb7c1333fc4b3e27fbc9cd5d2070aabcc1d4dfb99917c3633e772f97545a6b6"),
};
const SPECIAL_TOKENS_ASSET: ModelAsset = ModelAsset {
    path: "onnx/special_tokens_map.json",
    bytes: 167,
    sha256: Some("d05497f1da52c5e09554c0cd874037a083e1dc1b9cfd48034d1c717f1afc07a7"),
};
const TOKENIZER_CONFIG_ASSET: ModelAsset = ModelAsset {
    path: "onnx/tokenizer_config.json",
    bytes: 443,
    sha256: Some("a1d6bc8734a6f635dc158508bef000f8e2e5a759c7d92f984b2c86e5ff53425b"),
};

#[derive(Debug, Clone, Copy)]
struct ModelAsset {
    path: &'static str,
    bytes: u64,
    sha256: Option<&'static str>,
}

#[derive(Debug, Clone)]
pub struct LocalEmbeddingOptions {
    pub model_cache_dir: PathBuf,
    pub maximum_batch_size: usize,
    pub intra_threads: usize,
}

impl LocalEmbeddingOptions {
    pub fn new(model_cache_dir: impl Into<PathBuf>) -> Self {
        Self {
            model_cache_dir: model_cache_dir.into(),
            maximum_batch_size: LOCAL_EMBEDDING_MAXIMUM_BATCH_SIZE,
            intra_threads: default_intra_threads(),
        }
    }
}

pub struct LocalEmbeddingProvider {
    model: Mutex<TextEmbedding>,
    metadata: EmbeddingProviderMetadata,
}

impl LocalEmbeddingProvider {
    /// Downloads the fixed MIT-licensed model into Castle's private cache on
    /// first use, then loads it entirely on-device on subsequent starts.
    /// Call this from a background thread because first-run preparation may do
    /// network and disk work.
    pub fn open(options: LocalEmbeddingOptions) -> Result<Self> {
        ensure!(
            (1..=256).contains(&options.maximum_batch_size),
            "Castle local embedding batch size is invalid"
        );
        ensure!(
            (1..=64).contains(&options.intra_threads),
            "Castle local embedding thread count is invalid"
        );
        fs::create_dir_all(&options.model_cache_dir).with_context(|| {
            format!(
                "Castle could not create the local model cache {}",
                options.model_cache_dir.display()
            )
        })?;
        harden_model_cache(&options.model_cache_dir)?;
        let api = ApiBuilder::new()
            .with_cache_dir(options.model_cache_dir)
            .with_progress(false)
            .with_retries(3)
            .with_token(None)
            .build()
            .context("Castle could not initialize its pinned model downloader")?;
        let repository = api.repo(Repo::with_revision(
            LOCAL_EMBEDDING_MODEL.to_owned(),
            RepoType::Model,
            LOCAL_EMBEDDING_MODEL_REVISION.to_owned(),
        ));
        let model_files = UserDefinedEmbeddingModel::new(
            read_verified_asset(&repository, MODEL_ASSET)?,
            TokenizerFiles {
                tokenizer_file: read_verified_asset(&repository, TOKENIZER_ASSET)?,
                config_file: read_verified_asset(&repository, CONFIG_ASSET)?,
                special_tokens_map_file: read_verified_asset(&repository, SPECIAL_TOKENS_ASSET)?,
                tokenizer_config_file: read_verified_asset(&repository, TOKENIZER_CONFIG_ASSET)?,
            },
        )
        .with_pooling(Pooling::Mean);
        let model = TextEmbedding::try_new_from_user_defined(
            model_files,
            InitOptionsUserDefined::new()
                .with_max_length(LOCAL_EMBEDDING_MAXIMUM_TOKENS)
                .with_intra_threads(options.intra_threads),
        )
        .context("Castle could not prepare the on-device multilingual embedding model")?;
        Ok(Self {
            model: Mutex::new(model),
            metadata: local_embedding_metadata(options.maximum_batch_size),
        })
    }

    fn embed_prefixed(
        &self,
        texts: &[String],
        prefix: &str,
        cancellation: &EmbeddingCancellationToken,
    ) -> Result<Vec<Vec<f32>>> {
        ensure!(
            !texts.is_empty() && texts.len() <= self.metadata.maximum_batch_size,
            "Castle local embedding batch is outside the configured bounds"
        );
        ensure!(
            !cancellation.is_cancelled(),
            "Castle embedding generation was cancelled"
        );
        let inputs = texts
            .iter()
            .map(|text| prefixed_input(prefix, text))
            .collect::<Vec<_>>();
        let mut model = self.model.lock().map_err(|_| {
            EmbeddingProviderFailure::permanent("Local embedding model lock failed")
        })?;
        let vectors = model
            .embed(&inputs, Some(self.metadata.maximum_batch_size))
            .map_err(|reason| {
                EmbeddingProviderFailure::retryable(format!(
                    "Local embedding inference failed: {reason}"
                ))
            })?;
        drop(model);
        ensure!(
            !cancellation.is_cancelled(),
            "Castle embedding generation was cancelled"
        );
        vectors
            .into_iter()
            .map(|values| normalize_vector(values, self.metadata.dimensions))
            .collect()
    }
}

impl EmbeddingProvider for LocalEmbeddingProvider {
    fn metadata(&self) -> EmbeddingProviderMetadata {
        self.metadata.clone()
    }

    fn embed_batch(
        &self,
        texts: &[String],
        cancellation: &EmbeddingCancellationToken,
    ) -> Result<Vec<Vec<f32>>> {
        self.embed_prefixed(texts, "passage: ", cancellation)
    }

    fn embed_query(
        &self,
        query: &str,
        cancellation: &EmbeddingCancellationToken,
    ) -> Result<Vec<f32>> {
        let mut vectors = self.embed_prefixed(&[query.to_owned()], "query: ", cancellation)?;
        ensure!(vectors.len() == 1, "Castle local query embedding failed");
        Ok(vectors.remove(0))
    }
}

pub fn local_embedding_metadata(maximum_batch_size: usize) -> EmbeddingProviderMetadata {
    EmbeddingProviderMetadata {
        provider: LOCAL_EMBEDDING_PROVIDER.to_owned(),
        model: LOCAL_EMBEDDING_MODEL.to_owned(),
        input_version: LOCAL_EMBEDDING_INPUT_VERSION.to_owned(),
        dimensions: LOCAL_EMBEDDING_DIMENSIONS,
        maximum_batch_size,
    }
}

fn default_intra_threads() -> usize {
    std::thread::available_parallelism()
        .map(|count| count.get().clamp(1, 4))
        .unwrap_or(1)
}

#[cfg(unix)]
fn harden_model_cache(path: &std::path::Path) -> Result<()> {
    use std::os::unix::fs::PermissionsExt;

    fs::set_permissions(path, fs::Permissions::from_mode(0o700)).with_context(|| {
        format!(
            "Castle could not restrict the local model cache {}",
            path.display()
        )
    })
}

#[cfg(not(unix))]
fn harden_model_cache(_path: &std::path::Path) -> Result<()> {
    Ok(())
}

fn prefixed_input(prefix: &str, text: &str) -> String {
    format!("{prefix}{}", text.trim())
}

fn read_verified_asset(
    repository: &hf_hub::api::sync::ApiRepo,
    asset: ModelAsset,
) -> Result<Vec<u8>> {
    let path = repository.get(asset.path).with_context(|| {
        format!(
            "Castle could not retrieve pinned model asset {}",
            asset.path
        )
    })?;
    let metadata = fs::metadata(&path)
        .with_context(|| format!("Castle could not inspect model asset {}", asset.path))?;
    ensure!(
        metadata.len() == asset.bytes,
        "Castle rejected model asset {} because its size is invalid",
        asset.path
    );
    let bytes = fs::read(&path)
        .with_context(|| format!("Castle could not read model asset {}", asset.path))?;
    if let Some(expected) = asset.sha256 {
        let actual = format!("{:x}", Sha256::digest(&bytes));
        ensure!(
            actual == expected,
            "Castle rejected model asset {} because its checksum is invalid",
            asset.path
        );
    }
    Ok(bytes)
}

fn normalize_vector(mut values: Vec<f32>, expected_dimensions: usize) -> Result<Vec<f32>> {
    ensure!(
        values.len() == expected_dimensions && values.iter().all(|value| value.is_finite()),
        "Castle local embedding model returned an invalid vector"
    );
    let magnitude = values
        .iter()
        .map(|value| f64::from(*value) * f64::from(*value))
        .sum::<f64>()
        .sqrt();
    ensure!(
        magnitude.is_finite() && magnitude > f64::EPSILON,
        "Castle local embedding model returned a zero vector"
    );
    for value in &mut values {
        *value = (f64::from(*value) / magnitude) as f32;
    }
    Ok(values)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn production_metadata_versions_the_complete_e5_input_contract() {
        let metadata = local_embedding_metadata(LOCAL_EMBEDDING_MAXIMUM_BATCH_SIZE);
        assert_eq!(metadata.provider, "fastembed_local");
        assert_eq!(metadata.model, "intfloat/multilingual-e5-small");
        assert_eq!(metadata.dimensions, 384);
        assert!(metadata.input_version.contains("query_passage_prefix"));
        assert!(metadata.input_version.contains("max512"));
        assert!(metadata.input_version.contains("rev_0e60b8d"));
    }

    #[test]
    fn e5_inputs_use_asymmetric_retrieval_prefixes_without_leading_whitespace() {
        assert_eq!(
            prefixed_input("query: ", "  polskie pytanie  "),
            "query: polskie pytanie"
        );
        assert_eq!(
            prefixed_input("passage: ", "  odpowiedź  "),
            "passage: odpowiedź"
        );
    }

    #[test]
    fn local_vectors_are_finite_and_unit_normalized() {
        let normalized = normalize_vector(vec![3.0, 4.0], 2).unwrap();
        assert!((normalized[0] - 0.6).abs() < 1e-6);
        assert!((normalized[1] - 0.8).abs() < 1e-6);
        assert!(normalize_vector(vec![0.0, 0.0], 2).is_err());
        assert!(normalize_vector(vec![f32::NAN, 1.0], 2).is_err());
    }

    #[test]
    #[ignore = "downloads and loads the pinned 487 MB production model"]
    fn pinned_production_model_embeds_polish_and_english_locally() {
        let cache = std::env::var_os("CASTLE_MODEL_TEST_CACHE")
            .map(PathBuf::from)
            .unwrap_or_else(|| std::env::temp_dir().join("castle-embedding-model-smoke"));
        let provider = LocalEmbeddingProvider::open(LocalEmbeddingOptions::new(cache)).unwrap();
        let documents = provider
            .embed_batch(
                &[
                    "Warszawa jest stolicą Polski.".to_owned(),
                    "A bicycle has two wheels.".to_owned(),
                ],
                &EmbeddingCancellationToken::new(),
            )
            .unwrap();
        let query = provider
            .embed_query(
                "Jaka jest stolica Polski?",
                &EmbeddingCancellationToken::new(),
            )
            .unwrap();
        assert_eq!(documents.len(), 2);
        assert_eq!(query.len(), LOCAL_EMBEDDING_DIMENSIONS);
        assert!(dot(&query, &documents[0]) > dot(&query, &documents[1]));

        let mut query_latencies = Vec::with_capacity(20);
        for index in 0..20 {
            let started = std::time::Instant::now();
            provider
                .embed_query(
                    &format!("Lokalne wyszukiwanie semantyczne Castle {index}"),
                    &EmbeddingCancellationToken::new(),
                )
                .unwrap();
            query_latencies.push(started.elapsed().as_micros());
        }
        query_latencies.sort_unstable();
        let p50 = query_latencies[query_latencies.len() / 2];
        let p95 = query_latencies[(query_latencies.len() * 95).div_ceil(100) - 1];
        eprintln!("local query embedding p50={p50}us p95={p95}us");
    }

    fn dot(left: &[f32], right: &[f32]) -> f32 {
        left.iter()
            .zip(right)
            .map(|(left, right)| left * right)
            .sum()
    }
}
