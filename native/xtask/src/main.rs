use std::env;
use std::ffi::{OsStr, OsString};
use std::path::{Path, PathBuf};
use std::process::{Command, ExitStatus};

use anyhow::{Context, Result, bail};
use clap::{Args, Parser, Subcommand, ValueEnum};

#[derive(Debug, Parser)]
#[command(about = "Castle repository automation", version)]
struct Cli {
    #[command(subcommand)]
    command: Task,
}

#[derive(Debug, Subcommand)]
enum Task {
    /// Build an application target or the native CLI.
    Build(BuildArgs),
    /// Run all repository checks used before merging.
    Check,
    /// Check application and package dependency boundaries.
    CheckArchitecture,
    /// Start a development server or the desktop application.
    Dev(DevArgs),
    /// Deploy the private Cloudflare web application.
    Deploy,
    /// Format the Rust workspace.
    Format(FormatArgs),
    /// Generate contracts, snapshots, and application assets.
    Generate(GenerateArgs),
    /// Run repository linters.
    Lint(LintArgs),
    /// Package the Electron desktop application.
    PackageDesktop,
    /// Create distributables for the Electron desktop application.
    MakeDesktop,
    /// Migrate legacy library records.
    MigrateRecords(PassthroughArgs),
    /// Preview a production application build.
    Preview(PreviewArgs),
    /// Synchronize cached coordinates for person records.
    SyncPersonLocations(SyncPersonLocationsArgs),
    /// Run repository tests.
    Test(TestArgs),
    /// Type-check TypeScript sources.
    Typecheck,
    /// Validate the configured Markdown library.
    ValidateLibrary,
}

#[derive(Clone, Copy, Debug, Default, ValueEnum)]
enum BuildTarget {
    #[default]
    Web,
    WebTechnical,
    Viewer,
    Native,
}

#[derive(Debug, Args)]
struct BuildArgs {
    #[arg(value_enum, default_value_t)]
    target: BuildTarget,
}

#[derive(Clone, Copy, Debug, Default, ValueEnum)]
enum DevTarget {
    #[default]
    Web,
    Viewer,
    Desktop,
}

#[derive(Debug, Args)]
struct DevArgs {
    #[arg(value_enum, default_value_t)]
    target: DevTarget,
}

#[derive(Debug, Args)]
struct FormatArgs {
    /// Check formatting without changing files.
    #[arg(long)]
    check: bool,
}

#[derive(Debug, Args)]
struct GenerateArgs {
    #[command(subcommand)]
    command: Option<GenerateTask>,
}

#[derive(Debug, Subcommand)]
enum GenerateTask {
    /// Generate every desktop development input.
    All,
    /// Export Rust contracts and generate their TypeScript representation.
    Contracts,
    /// Generate a snapshot for an application target.
    Content(GenerateContentArgs),
    /// Generate the Blueprint icon loader.
    Icons,
}

#[derive(Clone, Copy, Debug, Default, ValueEnum)]
enum ContentTarget {
    #[default]
    Desktop,
    Web,
    WebTechnical,
}

#[derive(Debug, Args)]
struct GenerateContentArgs {
    #[arg(value_enum, default_value_t)]
    target: ContentTarget,
}

#[derive(Clone, Copy, Debug, Default, ValueEnum)]
enum LintTarget {
    #[default]
    All,
    Web,
    Native,
}

#[derive(Debug, Args)]
struct LintArgs {
    #[arg(value_enum, default_value_t)]
    target: LintTarget,
}

#[derive(Clone, Copy, Debug, Default, ValueEnum)]
enum PreviewTarget {
    #[default]
    Web,
    Viewer,
}

#[derive(Debug, Args)]
struct PreviewArgs {
    #[arg(value_enum, default_value_t)]
    target: PreviewTarget,
}

#[derive(Debug, Args)]
struct SyncPersonLocationsArgs {
    /// Report stale coordinates without updating the library.
    #[arg(long)]
    check: bool,
}

#[derive(Debug, Args)]
struct PassthroughArgs {
    /// Arguments forwarded to `castle migrate` (for example, `--apply`).
    #[arg(
        value_name = "ARGS",
        allow_hyphen_values = true,
        trailing_var_arg = true
    )]
    args: Vec<OsString>,
}

#[derive(Clone, Copy, Debug, Default, ValueEnum)]
enum TestTarget {
    #[default]
    All,
    Native,
    Javascript,
}

#[derive(Debug, Args)]
struct TestArgs {
    #[arg(value_enum, default_value_t)]
    target: TestTarget,
}

struct Xtask {
    root: PathBuf,
}

impl Xtask {
    fn new() -> Self {
        Self {
            root: Path::new(env!("CARGO_MANIFEST_DIR"))
                .parent()
                .and_then(Path::parent)
                .expect("xtask must remain under native/xtask")
                .to_path_buf(),
        }
    }

    fn run(&self, task: Task) -> Result<()> {
        match task {
            Task::Build(args) => self.build(args.target),
            Task::Check => self.check(),
            Task::CheckArchitecture => self.node(["scripts/check-architecture.mjs"]),
            Task::Dev(args) => self.dev(args.target),
            Task::Deploy => self.deploy(),
            Task::Format(args) => self.format(args.check),
            Task::Generate(args) => self.generate(args.command.unwrap_or(GenerateTask::All)),
            Task::Lint(args) => self.lint(args.target),
            Task::PackageDesktop => {
                self.generate(GenerateTask::All)?;
                self.npm(["run", "package", "--workspace", "@castle/desktop"])
            }
            Task::MakeDesktop => {
                self.generate(GenerateTask::All)?;
                self.npm(["run", "make", "--workspace", "@castle/desktop"])
            }
            Task::MigrateRecords(args) => {
                let mut command = strings([
                    "run",
                    "--quiet",
                    "--manifest-path",
                    "native/Cargo.toml",
                    "-p",
                    "castle-cli",
                    "--",
                    "migrate",
                ]);
                command.extend(args.args);
                self.cargo(command)
            }
            Task::Preview(args) => self.preview(args.target),
            Task::SyncPersonLocations(args) => self.sync_person_locations(args.check),
            Task::Test(args) => self.test(args.target),
            Task::Typecheck => self.typecheck(),
            Task::ValidateLibrary => self.validate_library(),
        }
    }

    fn build(&self, target: BuildTarget) -> Result<()> {
        match target {
            BuildTarget::Web => {
                self.sync_person_locations(true)?;
                self.generate_content(ContentTarget::Web)?;
                self.npm(["run", "build", "--workspace", "@castle/web"])
            }
            BuildTarget::WebTechnical => {
                self.generate_content(ContentTarget::WebTechnical)?;
                self.npm(["run", "build", "--workspace", "@castle/web"])
            }
            BuildTarget::Viewer => {
                self.sync_person_locations(true)?;
                self.generate(GenerateTask::Contracts)?;
                self.generate_content(ContentTarget::Desktop)?;
                self.generate(GenerateTask::Icons)?;
                self.npm(["run", "build", "--workspace", "@castle/desktop"])
            }
            BuildTarget::Native => self.cargo([
                "build",
                "--release",
                "--quiet",
                "--manifest-path",
                "native/Cargo.toml",
                "-p",
                "castle-cli",
            ]),
        }
    }

    fn check(&self) -> Result<()> {
        self.format(true)?;
        self.lint(LintTarget::All)?;
        self.test(TestTarget::All)?;
        self.build(BuildTarget::Viewer)?;
        self.build(BuildTarget::Web)?;
        self.typecheck()
    }

    fn dev(&self, target: DevTarget) -> Result<()> {
        match target {
            DevTarget::Web => {
                self.generate_content(ContentTarget::Web)?;
                self.npm(["run", "dev", "--workspace", "@castle/web"])
            }
            DevTarget::Viewer => {
                self.generate(GenerateTask::All)?;
                self.npm(["run", "dev", "--workspace", "@castle/desktop"])
            }
            DevTarget::Desktop => {
                self.generate(GenerateTask::All)?;
                self.npm(["run", "start", "--workspace", "@castle/desktop"])
            }
        }
    }

    fn deploy(&self) -> Result<()> {
        self.node(["apps/web/scripts/check-private-deploy.mjs"])?;
        self.check()?;
        self.npm([
            "exec",
            "--",
            "wrangler",
            "deploy",
            "--config",
            "apps/web/wrangler.jsonc",
        ])
    }

    fn format(&self, check: bool) -> Result<()> {
        let mut args = vec!["fmt", "--manifest-path", "native/Cargo.toml", "--all"];
        if check {
            args.push("--");
            args.push("--check");
        }
        self.cargo(args)
    }

    fn generate(&self, task: GenerateTask) -> Result<()> {
        match task {
            GenerateTask::All => {
                self.sync_person_locations(false)?;
                self.generate(GenerateTask::Contracts)?;
                self.generate_content(ContentTarget::Desktop)?;
                self.generate(GenerateTask::Icons)
            }
            GenerateTask::Contracts => {
                self.cargo([
                    "run",
                    "--quiet",
                    "--manifest-path",
                    "native/Cargo.toml",
                    "-p",
                    "castle-contracts",
                    "--bin",
                    "export-contracts",
                    "--",
                    "packages/contracts/src/castle_contract_schema.json",
                ])?;
                self.npm(["run", "generate", "--workspace", "@castle/contracts"])
            }
            GenerateTask::Content(args) => self.generate_content(args.target),
            GenerateTask::Icons => {
                self.npm(["run", "generate:icons", "--workspace", "@castle/desktop"])
            }
        }
    }

    fn generate_content(&self, target: ContentTarget) -> Result<()> {
        let (profile, public, extra): (&str, &str, &[&str]) = match target {
            ContentTarget::Desktop => ("desktop", "apps/desktop/public", &[]),
            ContentTarget::Web => ("public", "apps/web/public", &[]),
            ContentTarget::WebTechnical => (
                "public",
                "apps/web/public",
                &["--library", "examples/technical-docs", "--repository", "."],
            ),
        };
        let mut args = vec![
            "run",
            "--release",
            "--quiet",
            "--manifest-path",
            "native/Cargo.toml",
            "-p",
            "castle-snapshot",
            "--",
            "build",
            "--profile",
            profile,
        ];
        args.extend_from_slice(extra);
        args.extend_from_slice(&["--public", public]);
        self.cargo(args)?;
        self.node(["scripts/check-snapshot-profile.mjs", profile, public])
    }

    fn lint(&self, target: LintTarget) -> Result<()> {
        match target {
            LintTarget::All => {
                self.lint(LintTarget::Web)?;
                self.lint(LintTarget::Native)
            }
            LintTarget::Web => {
                self.node(["scripts/check-architecture.mjs"])?;
                self.npm([
                    "exec",
                    "--",
                    "eslint",
                    "--max-warnings=0",
                    "apps",
                    "packages",
                    "scripts",
                ])
            }
            LintTarget::Native => self.cargo([
                "clippy",
                "--manifest-path",
                "native/Cargo.toml",
                "--workspace",
                "--all-targets",
                "--",
                "-D",
                "warnings",
            ]),
        }
    }

    fn preview(&self, target: PreviewTarget) -> Result<()> {
        let workspace = match target {
            PreviewTarget::Web => "@castle/web",
            PreviewTarget::Viewer => "@castle/desktop",
        };
        self.npm(["run", "preview", "--workspace", workspace])
    }

    fn sync_person_locations(&self, check: bool) -> Result<()> {
        let mut args = vec!["scripts/sync-person-locations.mjs"];
        if check {
            args.push("--check");
        }
        self.node(args)
    }

    fn test(&self, target: TestTarget) -> Result<()> {
        match target {
            TestTarget::All => {
                self.test(TestTarget::Native)?;
                self.test(TestTarget::Javascript)
            }
            TestTarget::Native => self.cargo([
                "test",
                "--manifest-path",
                "native/Cargo.toml",
                "--workspace",
            ]),
            TestTarget::Javascript => self.npm(["run", "test", "--workspaces", "--if-present"]),
        }
    }

    fn typecheck(&self) -> Result<()> {
        self.npm(["run", "typecheck", "--workspace", "@castle/desktop"])?;
        self.npm(["exec", "--", "tsc", "-p", "config/typescript/scripts.json"])
    }

    fn validate_library(&self) -> Result<()> {
        self.sync_person_locations(true)?;
        self.cargo([
            "run",
            "--release",
            "--quiet",
            "--manifest-path",
            "native/Cargo.toml",
            "-p",
            "castle-cli",
            "--",
            "validate",
        ])
    }

    fn cargo<I, S>(&self, args: I) -> Result<()>
    where
        I: IntoIterator<Item = S>,
        S: AsRef<OsStr>,
    {
        let cargo = env::var_os("CARGO").unwrap_or_else(|| OsString::from("cargo"));
        self.command(cargo, args)
    }

    fn node<I, S>(&self, args: I) -> Result<()>
    where
        I: IntoIterator<Item = S>,
        S: AsRef<OsStr>,
    {
        self.command("node", args)
    }

    fn npm<I, S>(&self, args: I) -> Result<()>
    where
        I: IntoIterator<Item = S>,
        S: AsRef<OsStr>,
    {
        self.command("npm", args)
    }

    fn command<P, I, S>(&self, program: P, args: I) -> Result<()>
    where
        P: AsRef<OsStr>,
        I: IntoIterator<Item = S>,
        S: AsRef<OsStr>,
    {
        let args = args
            .into_iter()
            .map(|arg| arg.as_ref().to_os_string())
            .collect::<Vec<_>>();
        eprintln!(
            "+ {} {}",
            program.as_ref().to_string_lossy(),
            args.iter()
                .map(|arg| shell_arg(arg))
                .collect::<Vec<_>>()
                .join(" ")
        );
        let status = Command::new(&program)
            .args(&args)
            .current_dir(&self.root)
            .status()
            .with_context(|| format!("failed to start {}", program.as_ref().to_string_lossy()))?;
        ensure_success(program.as_ref(), status)
    }
}

fn shell_arg(value: &OsStr) -> String {
    let value = value.to_string_lossy();
    if value
        .chars()
        .all(|character| character.is_ascii_alphanumeric() || "-._/@:".contains(character))
    {
        value.into_owned()
    } else {
        format!("'{value}'")
    }
}

fn ensure_success(program: &OsStr, status: ExitStatus) -> Result<()> {
    if status.success() {
        Ok(())
    } else if let Some(code) = status.code() {
        bail!("{} exited with status {code}", program.to_string_lossy())
    } else {
        bail!("{} was terminated by a signal", program.to_string_lossy())
    }
}

fn strings<const N: usize>(values: [&str; N]) -> Vec<OsString> {
    values.into_iter().map(OsString::from).collect()
}

fn main() -> Result<()> {
    Xtask::new().run(Cli::parse().command)
}
