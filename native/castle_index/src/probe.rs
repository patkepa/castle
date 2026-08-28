use std::{
    fs,
    path::Path,
    time::{Duration, Instant},
};

use anyhow::{Context, Result, anyhow, ensure};
use serde::Serialize;
use turso::{Builder, Connection};

pub const TURSO_PINNED_VERSION: &str = "0.8.0-pre.2";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TursoCapabilityReport {
    pub turso_version: &'static str,
    pub database_bytes: u64,
    pub create_milliseconds: u128,
    pub reopen_milliseconds: u128,
    pub structured_query_p95_microseconds: u128,
    pub vector_query_p95_microseconds: u128,
    pub full_text_query_p95_microseconds: u128,
    pub prepared_statements: bool,
    pub transactions: bool,
    pub foreign_keys: bool,
    pub integrity_check: bool,
    pub private_file_permissions: bool,
    pub query_only_reopen: bool,
    pub vector_distance_cosine: f64,
    pub vector_search: bool,
    pub full_text_search: bool,
    pub full_text_unicode: bool,
    pub full_text_phrase: bool,
    pub full_text_prefix: bool,
    pub full_text_substring: bool,
    pub full_text_highlight: bool,
    pub full_text_updates: bool,
    pub full_text_index_integrity: bool,
}

pub fn run_capability_probe(database_path: &Path) -> Result<TursoCapabilityReport> {
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .context("Castle could not start the Turso capability runtime")?;
    runtime.block_on(run_capability_probe_async(database_path))
}

/// Opens an existing Turso generation in query-only mode and rejects files
/// that cannot pass the engine's structural integrity check.
pub fn verify_database_integrity(database_path: &Path) -> Result<()> {
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .context("Castle could not start the Turso verification runtime")?;
    runtime.block_on(verify_database_integrity_async(database_path))
}

async fn verify_database_integrity_async(database_path: &Path) -> Result<()> {
    ensure!(
        database_path.is_file(),
        "Castle Turso verification requires an existing database file"
    );
    let database_path_text = database_path
        .to_str()
        .ok_or_else(|| anyhow!("Castle requires a UTF-8 Turso database path"))?;
    let database = Builder::new_local(database_path_text)
        .experimental_index_method(true)
        .experimental_vacuum(true)
        .build()
        .await
        .context("Castle could not open the local Turso database for verification")?;
    let connection = database
        .connect()
        .context("Castle could not connect to the local Turso database for verification")?;
    connection
        .execute("PRAGMA query_only = 1", ())
        .await
        .context("Castle could not make the Turso verification connection query-only")?;
    let integrity_result = scalar_string(&connection, "PRAGMA integrity_check", ()).await?;
    ensure!(
        integrity_result.eq_ignore_ascii_case("ok"),
        "Castle rejected a Turso database that failed integrity verification (result={integrity_result:?})"
    );
    Ok(())
}

async fn run_capability_probe_async(database_path: &Path) -> Result<TursoCapabilityReport> {
    ensure!(
        !database_path.exists(),
        "Castle Turso probe requires a database path that does not exist"
    );
    if let Some(parent) = database_path.parent() {
        fs::create_dir_all(parent).with_context(|| {
            format!(
                "Castle could not create the Turso probe directory {}",
                parent.display()
            )
        })?;
    }
    let database_path_text = database_path
        .to_str()
        .ok_or_else(|| anyhow!("Castle requires a UTF-8 Turso probe path"))?;

    let create_started = Instant::now();
    let database = Builder::new_local(database_path_text)
        .experimental_index_method(true)
        .experimental_vacuum(true)
        .build()
        .await
        .context("Castle could not create the local Turso probe database")?;
    let mut connection = database
        .connect()
        .context("Castle could not connect to the local Turso probe database")?;

    connection
        .execute_batch(
            "PRAGMA foreign_keys = ON;
             CREATE TABLE documents (
               id INTEGER PRIMARY KEY,
               title TEXT NOT NULL,
               body TEXT NOT NULL,
               embedding BLOB
             );
             CREATE TABLE document_links (
               source_id INTEGER NOT NULL REFERENCES documents(id),
               target_id INTEGER NOT NULL REFERENCES documents(id),
               PRIMARY KEY (source_id, target_id)
             );
             CREATE INDEX documents_fts ON documents USING fts (title, body);",
        )
        .await
        .context("Castle could not initialize the Turso probe schema")?;

    let transaction = connection
        .transaction()
        .await
        .context("Castle could not start a Turso probe transaction")?;
    let mut insert = transaction
        .prepare(
            "INSERT INTO documents (id, title, body, embedding)
             VALUES (?1, ?2, ?3, vector32(?4))",
        )
        .await
        .context("Castle could not prepare the Turso probe insert")?;
    insert
        .execute((
            1_i64,
            "Żółty przewodnik po Warszawie",
            "Zażółć gęślą jaźń. Castle remembers Polish text and exact phrases.",
            "[1.0,0.0,0.0,0.0]",
        ))
        .await
        .context("Castle could not insert the first Turso probe document")?;
    insert
        .execute((
            2_i64,
            "Semantic retrieval",
            "Vector search finds conceptually related notes.",
            "[0.9,0.1,0.0,0.0]",
        ))
        .await
        .context("Castle could not insert the second Turso probe document")?;
    drop(insert);
    transaction
        .commit()
        .await
        .context("Castle could not commit the Turso probe transaction")?;

    let prepared_statements = scalar_i64(
        &connection,
        "SELECT COUNT(*) FROM documents WHERE id >= ?1",
        [1_i64],
    )
    .await?
        == 2;
    ensure!(prepared_statements, "Turso prepared-statement probe failed");

    let transactions = scalar_i64(&connection, "SELECT COUNT(*) FROM documents", ()).await? == 2;
    ensure!(transactions, "Turso transaction probe failed");

    let foreign_keys = connection
        .execute(
            "INSERT INTO document_links (source_id, target_id) VALUES (?1, ?2)",
            (1_i64, 999_i64),
        )
        .await
        .is_err();
    ensure!(foreign_keys, "Turso foreign-key enforcement probe failed");

    let vector_distance_cosine = scalar_f64(
        &connection,
        "SELECT vector_distance_cos(embedding, vector32(?1))
         FROM documents WHERE id = 2",
        ["[1.0,0.0,0.0,0.0]"],
    )
    .await?;
    let vector_search = vector_distance_cosine.is_finite() && vector_distance_cosine > 0.0;
    ensure!(vector_search, "Turso vector-distance probe failed");

    let unicode_matches = fts_count(&connection, "żółty").await?;
    let phrase_matches = fts_count(&connection, "\"zażółć gęślą\"").await?;
    let prefix_matches = fts_count(&connection, "warsz*").await?;
    let substring_matches = fts_count(&connection, "arsz").await?;
    let full_text_unicode = unicode_matches == 1;
    let full_text_phrase = phrase_matches == 1;
    let full_text_prefix = prefix_matches == 1;
    let full_text_substring = substring_matches == 1;
    let full_text_search = full_text_unicode && full_text_phrase;
    ensure!(
        full_text_search,
        "Turso full-text matching probe failed (unicode={unicode_matches}, phrase={phrase_matches})"
    );

    let highlighted = scalar_string(
        &connection,
        "SELECT fts_highlight(body, '<mark>', '</mark>', ?1)
         FROM documents
         WHERE fts_match(title, body, ?1)
         LIMIT 1",
        ["Castle"],
    )
    .await?;
    let full_text_highlight = highlighted.contains("<mark>Castle</mark>");
    ensure!(
        full_text_highlight,
        "Turso full-text highlight probe failed"
    );

    connection
        .execute(
            "UPDATE documents SET body = ?1 WHERE id = ?2",
            ("Updated searchable phrase: Bursztynowy kompas.", 1_i64),
        )
        .await
        .context("Castle could not update a Turso FTS probe document")?;
    let full_text_updates = fts_count(&connection, "Bursztynowy").await? == 1
        && fts_count(&connection, "gęślą").await? == 0;
    ensure!(full_text_updates, "Turso full-text update probe failed");

    let mut structured_query_micros = Vec::with_capacity(100);
    let mut vector_query_micros = Vec::with_capacity(100);
    let mut full_text_query_micros = Vec::with_capacity(100);
    for _ in 0..100 {
        let started = Instant::now();
        let _ = scalar_i64(
            &connection,
            "SELECT COUNT(*) FROM documents WHERE id >= ?1",
            [1_i64],
        )
        .await?;
        structured_query_micros.push(elapsed_microseconds(started.elapsed()));

        let started = Instant::now();
        let _ = scalar_f64(
            &connection,
            "SELECT vector_distance_cos(embedding, vector32(?1))
             FROM documents WHERE id = 2",
            ["[1.0,0.0,0.0,0.0]"],
        )
        .await?;
        vector_query_micros.push(elapsed_microseconds(started.elapsed()));

        let started = Instant::now();
        let _ = fts_count(&connection, "Bursztynowy").await?;
        full_text_query_micros.push(elapsed_microseconds(started.elapsed()));
    }
    let structured_query_p95_microseconds = p95(structured_query_micros);
    let vector_query_p95_microseconds = p95(vector_query_micros);
    let full_text_query_p95_microseconds = p95(full_text_query_micros);

    // The pinned engine currently reports an internal index mismatch after a
    // valid FTS update. Record that capability result, then remove the
    // experimental index so the durable probe database must still pass the
    // core engine integrity gate.
    let full_text_integrity_result =
        scalar_string(&connection, "PRAGMA integrity_check", ()).await?;
    let full_text_index_integrity = full_text_integrity_result.eq_ignore_ascii_case("ok");
    connection
        .execute("DROP INDEX documents_fts", ())
        .await
        .context("Castle could not remove the experimental Turso FTS probe index")?;
    connection
        .execute("VACUUM", ())
        .await
        .context("Castle could not compact the Turso probe after the FTS experiment")?;

    let integrity_result = scalar_string(&connection, "PRAGMA integrity_check", ()).await?;
    let integrity_check = integrity_result.eq_ignore_ascii_case("ok");
    ensure!(
        integrity_check,
        "Turso integrity-check probe failed (result={integrity_result:?})"
    );

    drop(connection);
    drop(database);
    let create_milliseconds = elapsed_milliseconds(create_started.elapsed());

    let reopen_started = Instant::now();
    let reopened_database = Builder::new_local(database_path_text)
        .experimental_index_method(true)
        .experimental_vacuum(true)
        .build()
        .await
        .context("Castle could not reopen the local Turso probe database")?;
    let reopened_connection = reopened_database
        .connect()
        .context("Castle could not reconnect to the local Turso probe database")?;
    reopened_connection
        .execute("PRAGMA query_only = 1", ())
        .await
        .context("Castle could not make the Turso probe connection query-only")?;
    let reopened_count =
        scalar_i64(&reopened_connection, "SELECT COUNT(*) FROM documents", ()).await?;
    let rejected_write = reopened_connection
        .execute("DELETE FROM documents", ())
        .await
        .is_err();
    let query_only_reopen = reopened_count == 2 && rejected_write;
    ensure!(query_only_reopen, "Turso query-only reopen probe failed");
    drop(reopened_connection);
    drop(reopened_database);
    let reopen_milliseconds = elapsed_milliseconds(reopen_started.elapsed());

    harden_database_permissions(database_path)?;
    let private_file_permissions = database_permissions_are_private(database_path)?;
    ensure!(
        private_file_permissions,
        "Castle could not make the Turso probe database owner-only"
    );

    let database_bytes = fs::metadata(database_path)
        .with_context(|| {
            format!(
                "Castle could not inspect the Turso probe database {}",
                database_path.display()
            )
        })?
        .len();

    Ok(TursoCapabilityReport {
        turso_version: TURSO_PINNED_VERSION,
        database_bytes,
        create_milliseconds,
        reopen_milliseconds,
        structured_query_p95_microseconds,
        vector_query_p95_microseconds,
        full_text_query_p95_microseconds,
        prepared_statements,
        transactions,
        foreign_keys,
        integrity_check,
        private_file_permissions,
        query_only_reopen,
        vector_distance_cosine,
        vector_search,
        full_text_search,
        full_text_unicode,
        full_text_phrase,
        full_text_prefix,
        full_text_substring,
        full_text_highlight,
        full_text_updates,
        full_text_index_integrity,
    })
}

async fn fts_count(connection: &Connection, query: &str) -> Result<i64> {
    scalar_i64(
        connection,
        "SELECT COUNT(*) FROM documents WHERE fts_match(title, body, ?1)",
        [query],
    )
    .await
}

async fn scalar_i64(
    connection: &Connection,
    sql: &str,
    params: impl turso::IntoParams,
) -> Result<i64> {
    let mut rows = connection
        .query(sql, params)
        .await
        .with_context(|| format!("Castle Turso probe query failed: {sql}"))?;
    let row = rows
        .next()
        .await
        .context("Castle could not read a Turso probe row")?
        .ok_or_else(|| anyhow!("Castle Turso probe query returned no rows: {sql}"))?;
    row.get(0)
        .with_context(|| format!("Castle could not decode a Turso integer: {sql}"))
}

async fn scalar_f64(
    connection: &Connection,
    sql: &str,
    params: impl turso::IntoParams,
) -> Result<f64> {
    let mut rows = connection
        .query(sql, params)
        .await
        .with_context(|| format!("Castle Turso probe query failed: {sql}"))?;
    let row = rows
        .next()
        .await
        .context("Castle could not read a Turso probe row")?
        .ok_or_else(|| anyhow!("Castle Turso probe query returned no rows: {sql}"))?;
    row.get(0)
        .with_context(|| format!("Castle could not decode a Turso real: {sql}"))
}

async fn scalar_string(
    connection: &Connection,
    sql: &str,
    params: impl turso::IntoParams,
) -> Result<String> {
    let mut rows = connection
        .query(sql, params)
        .await
        .with_context(|| format!("Castle Turso probe query failed: {sql}"))?;
    let row = rows
        .next()
        .await
        .context("Castle could not read a Turso probe row")?
        .ok_or_else(|| anyhow!("Castle Turso probe query returned no rows: {sql}"))?;
    row.get(0)
        .with_context(|| format!("Castle could not decode Turso text: {sql}"))
}

fn elapsed_milliseconds(duration: Duration) -> u128 {
    duration.as_millis().max(1)
}

fn elapsed_microseconds(duration: Duration) -> u128 {
    duration.as_micros().max(1)
}

fn p95(mut values: Vec<u128>) -> u128 {
    values.sort_unstable();
    values[(values.len() * 95).div_ceil(100).saturating_sub(1)]
}

#[cfg(unix)]
fn harden_database_permissions(database_path: &Path) -> Result<()> {
    use std::os::unix::fs::PermissionsExt;

    for path in database_files(database_path) {
        if path.exists() {
            fs::set_permissions(&path, fs::Permissions::from_mode(0o600)).with_context(|| {
                format!(
                    "Castle could not secure Turso database file {}",
                    path.display()
                )
            })?;
        }
    }
    Ok(())
}

#[cfg(not(unix))]
fn harden_database_permissions(_database_path: &Path) -> Result<()> {
    Ok(())
}

#[cfg(unix)]
fn database_permissions_are_private(database_path: &Path) -> Result<bool> {
    use std::os::unix::fs::PermissionsExt;

    for path in database_files(database_path) {
        if !path.exists() {
            continue;
        }
        let mode = fs::metadata(&path)
            .with_context(|| {
                format!(
                    "Castle could not inspect permissions for {}",
                    path.display()
                )
            })?
            .permissions()
            .mode();
        if mode & 0o077 != 0 {
            return Ok(false);
        }
    }
    Ok(true)
}

#[cfg(not(unix))]
fn database_permissions_are_private(_database_path: &Path) -> Result<bool> {
    Ok(true)
}

fn database_files(database_path: &Path) -> [std::path::PathBuf; 3] {
    [
        database_path.to_path_buf(),
        std::path::PathBuf::from(format!("{}-wal", database_path.display())),
        std::path::PathBuf::from(format!("{}-shm", database_path.display())),
    ]
}

#[cfg(test)]
mod tests {
    use std::fs;

    use super::{TURSO_PINNED_VERSION, run_capability_probe, verify_database_integrity};

    #[test]
    fn proves_required_local_turso_capabilities() {
        let directory = tempfile::tempdir().unwrap();
        let database_path = directory.path().join("capability_probe.db");
        let report = run_capability_probe(&database_path).unwrap();

        assert_eq!(report.turso_version, TURSO_PINNED_VERSION);
        assert!(report.database_bytes > 0);
        assert!(report.prepared_statements);
        assert!(report.transactions);
        assert!(report.foreign_keys);
        assert!(report.integrity_check);
        assert!(report.private_file_permissions);
        assert!(report.query_only_reopen);
        assert!(report.vector_search);
        assert!(report.full_text_search);
        assert!(report.full_text_highlight);
        assert!(report.full_text_updates);
        assert!(!report.full_text_index_integrity);
        verify_database_integrity(&database_path).unwrap();
    }

    #[test]
    fn rejects_a_corrupt_database() {
        let directory = tempfile::tempdir().unwrap();
        let database_path = directory.path().join("corrupt.db");
        fs::write(&database_path, b"not a database").unwrap();

        let reason = verify_database_integrity(&database_path).unwrap_err();
        assert!(!reason.to_string().is_empty());
    }
}
