use std::path::PathBuf;

use anyhow::{Context, Result};
use castle_core::{
    CompileOptions, SnapshotOptions, compile_library, load_castle_configuration, write_snapshot,
};
use clap::Parser;

#[derive(Debug, Parser)]
#[command(
    name = "castle-web-build",
    about = "Generate Castle's static web content"
)]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Debug, clap::Subcommand)]
enum Command {
    Build(Paths),
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

fn main() -> Result<()> {
    let Cli {
        command: Command::Build(paths),
    } = Cli::parse();
    let configuration = load_castle_configuration(&std::env::current_dir()?)?;
    let library = paths.library.unwrap_or(configuration.library_path);
    let repository = paths.repository.unwrap_or(configuration.repository_path);
    let compilation = compile_library(&CompileOptions::new(&library, &repository))
        .with_context(|| format!("Castle could not compile {}", library.display()))?;
    write_snapshot(
        &compilation,
        &SnapshotOptions {
            generated_path: paths.generated,
            public_root: paths.public,
        },
    )?;

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
        "Generated {} notes across {} sections, {} records, {} projects, {} tasks, {} relationship nodes, and {} calendar events; converted {} Obsidian links and embeds.",
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
