use std::{
    env,
    ffi::{OsStr, OsString},
    fs,
    path::{Path, PathBuf},
    process::Command,
};

use anyhow::{Context, Result, bail};
use castle_core::load_castle_configuration;
use clap::{Args, Parser, Subcommand, ValueEnum};

const NATIVE_MANIFEST: &str = "native/Cargo.toml";

#[derive(Debug, Parser)]
#[command(
    bin_name = "cargo xtask",
    about = "Build, run, test, and package Castle",
    version
)]
struct Cli {
    #[command(subcommand)]
    task: Task,
}

#[derive(Debug, Subcommand)]
enum Task {
    /// Build Castle. The native desktop app is the default target.
    Build(BuildArgs),
    /// Run Castle. The native desktop app is the default target.
    Run(RunArgs),
    /// Run repository checks. Desktop checks remain an explicit target.
    Check(CheckArgs),
    /// Run test suites.
    Test(TestArgs),
    /// Run linters.
    Lint(LintArgs),
    /// Generate checked-in contracts and disposable web content.
    Generate(GenerateArgs),
    /// Format the Rust workspace.
    #[command(visible_alias = "format")]
    Fmt(FormatArgs),
    /// Type-check the web, script, and Electron TypeScript projects.
    Typecheck,
    /// Validate the configured Markdown library.
    Validate(PassthroughArgs),
    /// Plan or apply Castle Record migrations.
    Migrate(PassthroughArgs),
    /// Package the native desktop app or legacy Electron application.
    Package(PackageArgs),
    /// Check and deploy the web application through Cloudflare.
    Deploy(DeployArgs),
}

#[derive(Debug, Args)]
struct BuildArgs {
    #[arg(value_enum, default_value_t)]
    target: BuildTarget,
    /// Build a release binary (desktop and native targets only).
    #[arg(long)]
    release: bool,
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, ValueEnum)]
enum BuildTarget {
    #[default]
    Desktop,
    Web,
    Native,
    Cloudflare,
}

#[derive(Debug, Args)]
struct RunArgs {
    #[arg(value_enum, default_value_t)]
    target: RunTarget,
    /// Run the native desktop app from a release build.
    #[arg(long)]
    release: bool,
    /// Arguments passed to the application. Put them after `--`.
    #[arg(last = true)]
    args: Vec<OsString>,
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, ValueEnum)]
enum RunTarget {
    #[default]
    Desktop,
    Web,
    Electron,
    Preview,
}

#[derive(Debug, Args)]
struct CheckArgs {
    #[arg(value_enum, default_value_t)]
    target: CheckTarget,
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, ValueEnum)]
enum CheckTarget {
    /// The portable repository checks used by CI (web and non-GPUI native code).
    #[default]
    All,
    Web,
    Native,
    Desktop,
}

#[derive(Debug, Args)]
struct TestArgs {
    #[arg(value_enum, default_value_t)]
    target: TestTarget,
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, ValueEnum)]
enum TestTarget {
    #[default]
    All,
    Web,
    Native,
    Desktop,
}

#[derive(Debug, Args)]
struct LintArgs {
    #[arg(value_enum, default_value_t)]
    target: LintTarget,
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, ValueEnum)]
enum LintTarget {
    #[default]
    All,
    Web,
    Native,
    Desktop,
    Architecture,
}

#[derive(Debug, Args)]
struct GenerateArgs {
    #[arg(value_enum, default_value_t)]
    target: GenerateTarget,
    /// Check generated person locations without changing Markdown.
    #[arg(long)]
    check: bool,
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, ValueEnum)]
enum GenerateTarget {
    #[default]
    All,
    Contracts,
    Content,
    Icons,
    PersonLocations,
}

#[derive(Debug, Args)]
struct FormatArgs {
    /// Check formatting without changing files.
    #[arg(long)]
    check: bool,
}

#[derive(Debug, Args)]
struct PassthroughArgs {
    /// Arguments passed to the Castle CLI. Put them after `--`.
    #[arg(last = true)]
    args: Vec<OsString>,
}

#[derive(Debug, Args)]
struct PackageArgs {
    #[arg(value_enum, default_value_t)]
    target: PackageTarget,
    /// Create a distributable archive with Electron Forge instead of an unpacked app.
    #[arg(long)]
    make: bool,
    /// macOS signing identity. Defaults to ad-hoc signing (`-`).
    #[arg(long, default_value = "-")]
    identity: String,
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, ValueEnum)]
enum PackageTarget {
    #[default]
    Desktop,
    Electron,
}

#[derive(Debug, Args)]
struct DeployArgs {
    #[arg(value_enum, default_value_t)]
    target: DeployTarget,
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, ValueEnum)]
enum DeployTarget {
    #[default]
    Web,
}

fn main() -> Result<()> {
    let repository_root = repository_root()?;
    run_task(&repository_root, Cli::parse().task)
}

fn repository_root() -> Result<PathBuf> {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .ancestors()
        .nth(2)
        .map(Path::to_path_buf)
        .context("xtask must live at native/xtask inside the Castle repository")
}

fn run_task(root: &Path, task: Task) -> Result<()> {
    match task {
        Task::Build(args) => build(root, args),
        Task::Run(args) => run_app(root, args),
        Task::Check(args) => check(root, args.target),
        Task::Test(args) => test(root, args.target),
        Task::Lint(args) => lint(root, args.target),
        Task::Generate(args) => generate(root, args.target, args.check),
        Task::Fmt(args) => format(root, args.check),
        Task::Typecheck => typecheck(root),
        Task::Validate(args) => validate(root, args.args),
        Task::Migrate(args) => migrate(root, args.args),
        Task::Package(args) => package(root, args),
        Task::Deploy(args) => deploy(root, args.target),
    }
}

fn build(root: &Path, args: BuildArgs) -> Result<()> {
    match args.target {
        BuildTarget::Desktop => {
            let mut command = words(&["-p", "castle-desktop"]);
            if args.release {
                command.push("--release".into());
            }
            run_cargo(root, "build", command)?;
            let profile = if args.release { "release" } else { "debug" };
            println!(
                "Built native desktop binary: {}",
                root.join("native/target")
                    .join(profile)
                    .join(executable("castle-desktop"))
                    .display()
            );
            Ok(())
        }
        BuildTarget::Web => build_web(root),
        BuildTarget::Native => {
            let mut command = words(&["-p", "castle-cli"]);
            if args.release {
                command.push("--release".into());
            }
            run_cargo(root, "build", command)
        }
        BuildTarget::Cloudflare => run_node(root, ["scripts/build-cloudflare.mjs"]),
    }
}

fn build_web(root: &Path) -> Result<()> {
    generate(root, GenerateTarget::All, false)?;
    run_npm_exec(root, "tsc", ["--noEmit"])?;
    run_npm_exec(root, "vite", ["build"])
}

fn run_app(root: &Path, args: RunArgs) -> Result<()> {
    match args.target {
        RunTarget::Desktop => {
            let mut command = words(&["-p", "castle-desktop"]);
            if args.release {
                command.push("--release".into());
            }
            command.push("--".into());
            command.extend(args.args);
            run_cargo(root, "run", command)
        }
        RunTarget::Web => {
            if args.release {
                bail!("--release only applies to the native desktop target");
            }
            generate(root, GenerateTarget::All, false)?;
            let mut command = words(&["--host", "127.0.0.1"]);
            command.extend(args.args);
            run_npm_exec(root, "vite", command)
        }
        RunTarget::Electron => {
            if args.release {
                bail!("--release only applies to the native desktop target");
            }
            build(
                root,
                BuildArgs {
                    target: BuildTarget::Native,
                    release: true,
                },
            )?;
            generate(root, GenerateTarget::All, false)?;
            let mut command = words(&["start"]);
            command.extend(args.args);
            run_npm_exec(root, "electron-forge", command)
        }
        RunTarget::Preview => {
            if args.release {
                bail!("--release only applies to the native desktop target");
            }
            let mut command = words(&["preview", "--host", "127.0.0.1"]);
            command.extend(args.args);
            run_npm_exec(root, "vite", command)
        }
    }
}

fn check(root: &Path, target: CheckTarget) -> Result<()> {
    match target {
        CheckTarget::All => {
            format(root, true)?;
            lint(root, LintTarget::All)?;
            test(root, TestTarget::Native)?;
            test(root, TestTarget::Web)?;
            build_web(root)?;
            typecheck(root)
        }
        CheckTarget::Web => {
            lint(root, LintTarget::Web)?;
            test(root, TestTarget::Web)?;
            build_web(root)?;
            typecheck(root)
        }
        CheckTarget::Native => {
            format(root, true)?;
            lint(root, LintTarget::Native)?;
            test(root, TestTarget::Native)
        }
        CheckTarget::Desktop => {
            test(root, TestTarget::Desktop)?;
            lint(root, LintTarget::Desktop)
        }
    }
}

fn test(root: &Path, target: TestTarget) -> Result<()> {
    match target {
        TestTarget::All => {
            test(root, TestTarget::Native)?;
            test(root, TestTarget::Desktop)?;
            test(root, TestTarget::Web)
        }
        TestTarget::Web => run_process(
            root,
            node_executable(),
            words(&["--preserve-symlinks", "--import", "tsx", "--test"]),
        ),
        TestTarget::Native => run_cargo(
            root,
            "test",
            words(&["--workspace", "--exclude", "castle-desktop"]),
        ),
        TestTarget::Desktop => run_cargo(
            root,
            "test",
            words(&["-p", "castle-runtime", "-p", "castle-desktop"]),
        ),
    }
}

fn lint(root: &Path, target: LintTarget) -> Result<()> {
    match target {
        LintTarget::All => {
            lint(root, LintTarget::Web)?;
            lint(root, LintTarget::Native)
        }
        LintTarget::Web => {
            lint(root, LintTarget::Architecture)?;
            run_npm_exec(
                root,
                "eslint",
                [
                    "--max-warnings=0",
                    "src",
                    "electron",
                    "scripts",
                    "test",
                    "config",
                    "vite.config.ts",
                ],
            )
        }
        LintTarget::Native => run_cargo(
            root,
            "clippy",
            words(&[
                "--workspace",
                "--exclude",
                "castle-desktop",
                "--all-targets",
                "--",
                "-D",
                "warnings",
            ]),
        ),
        LintTarget::Desktop => run_cargo(
            root,
            "clippy",
            words(&[
                "-p",
                "castle-runtime",
                "-p",
                "castle-desktop",
                "--all-targets",
                "--",
                "-D",
                "warnings",
            ]),
        ),
        LintTarget::Architecture => run_node(root, ["scripts/check-architecture.mjs"]),
    }
}

fn generate(root: &Path, target: GenerateTarget, check_only: bool) -> Result<()> {
    if check_only && target != GenerateTarget::PersonLocations {
        bail!("--check is only supported by `generate person-locations`");
    }

    match target {
        GenerateTarget::All => {
            generate(root, GenerateTarget::PersonLocations, false)?;
            generate(root, GenerateTarget::Contracts, false)?;
            generate(root, GenerateTarget::Content, false)?;
            generate(root, GenerateTarget::Icons, false)
        }
        GenerateTarget::Contracts => {
            run_cargo(
                root,
                "run",
                words(&[
                    "--quiet",
                    "-p",
                    "castle-contracts",
                    "--bin",
                    "export-contracts",
                    "--",
                    "src/generated/castle_contract_schema.json",
                ]),
            )?;
            run_node(root, ["scripts/generate-contracts.mjs"])
        }
        GenerateTarget::Content => run_cargo(
            root,
            "run",
            words(&[
                "--release",
                "--quiet",
                "-p",
                "castle-web-build",
                "--",
                "build",
            ]),
        ),
        GenerateTarget::Icons => run_node(root, ["scripts/generate-blueprint-icon-loader.mjs"]),
        GenerateTarget::PersonLocations => {
            let mut command = words(&["scripts/sync-person-locations.mjs"]);
            if check_only {
                command.push("--check".into());
            }
            run_process(root, node_executable(), command)
        }
    }
}

fn format(root: &Path, check_only: bool) -> Result<()> {
    let mut command = words(&["--all"]);
    if check_only {
        command.push("--check".into());
    }
    run_cargo(root, "fmt", command)
}

fn typecheck(root: &Path) -> Result<()> {
    run_npm_exec(root, "tsc", ["--noEmit"])?;
    run_npm_exec(root, "tsc", ["-p", "config/typescript/scripts.json"])?;
    run_npm_exec(root, "tsc", ["-p", "config/typescript/electron.json"])
}

fn validate(root: &Path, extra: Vec<OsString>) -> Result<()> {
    generate(root, GenerateTarget::PersonLocations, true)?;
    let mut command = words(&["--release", "--quiet", "-p", "castle-cli", "--", "validate"]);
    command.extend(extra);
    run_cargo(root, "run", command)
}

fn migrate(root: &Path, extra: Vec<OsString>) -> Result<()> {
    let mut command = words(&["--quiet", "-p", "castle-cli", "--", "migrate"]);
    command.extend(extra);
    run_cargo(root, "run", command)
}

fn package(root: &Path, args: PackageArgs) -> Result<()> {
    match args.target {
        PackageTarget::Desktop => package_desktop(root, &args),
        PackageTarget::Electron => {
            build(
                root,
                BuildArgs {
                    target: BuildTarget::Native,
                    release: true,
                },
            )?;
            generate(root, GenerateTarget::All, false)?;
            let action = if args.make { "make" } else { "package" };
            run_npm_exec(root, "electron-forge", [action])
        }
    }
}

fn package_desktop(root: &Path, args: &PackageArgs) -> Result<()> {
    if !cfg!(target_os = "macos") {
        bail!("native desktop packaging currently supports macOS only");
    }
    build(
        root,
        BuildArgs {
            target: BuildTarget::Desktop,
            release: true,
        },
    )?;

    let configuration = load_castle_configuration(root)?;
    validate_bundle_name(&configuration.application_name)?;
    let package_root = root.join("native/target/castle-package");
    let app_name = format!("{}.app", configuration.application_name);
    let app = package_root.join(&app_name);
    if app.exists() {
        fs::remove_dir_all(&app).with_context(|| format!("failed to replace {}", app.display()))?;
    }
    let contents = app.join("Contents");
    let macos = contents.join("MacOS");
    let resources = contents.join("Resources");
    fs::create_dir_all(&macos)?;
    fs::create_dir_all(&resources)?;

    let binary = root.join("native/target/release/castle-desktop");
    let packaged_binary = macos.join("castle-desktop");
    fs::copy(&binary, &packaged_binary).with_context(|| {
        format!(
            "failed to copy {} into the application bundle",
            binary.display()
        )
    })?;
    fs::copy(
        root.join("resources/app-icons/castle.icns"),
        resources.join("Castle.icns"),
    )?;
    fs::write(
        contents.join("Info.plist"),
        desktop_info_plist(
            &configuration.application_name,
            &configuration.application_bundle_id,
            env!("CARGO_PKG_VERSION"),
        ),
    )?;

    run_process(
        root,
        "codesign",
        vec![
            "--force".into(),
            "--deep".into(),
            "--sign".into(),
            args.identity.clone().into(),
            app.as_os_str().to_owned(),
        ],
    )?;
    run_process(
        root,
        "codesign",
        vec![
            "--verify".into(),
            "--deep".into(),
            app.as_os_str().to_owned(),
        ],
    )?;

    if args.make {
        let archive_name = format!("{}-macOS.zip", configuration.application_name);
        let archive = package_root.join(&archive_name);
        if archive.exists() {
            fs::remove_file(&archive)?;
        }
        run_process(
            &package_root,
            "ditto",
            vec![
                "-c".into(),
                "-k".into(),
                "--sequesterRsrc".into(),
                "--keepParent".into(),
                app_name.into(),
                archive_name.into(),
            ],
        )?;
        println!("Created native desktop archive: {}", archive.display());
    } else {
        println!("Packaged native desktop app: {}", app.display());
    }
    Ok(())
}

fn validate_bundle_name(name: &str) -> Result<()> {
    if name.is_empty()
        || name == "."
        || name == ".."
        || name.contains('/')
        || name.contains('\\')
        || name.contains('\0')
    {
        bail!("application.name is not safe for a macOS bundle name");
    }
    Ok(())
}

fn xml_escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

fn desktop_info_plist(name: &str, bundle_id: &str, version: &str) -> String {
    let name = xml_escape(name);
    let bundle_id = xml_escape(bundle_id);
    let version = xml_escape(version);
    format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key><string>en</string>
  <key>CFBundleDisplayName</key><string>{name}</string>
  <key>CFBundleExecutable</key><string>castle-desktop</string>
  <key>CFBundleIconFile</key><string>Castle</string>
  <key>CFBundleIdentifier</key><string>{bundle_id}</string>
  <key>CFBundleInfoDictionaryVersion</key><string>6.0</string>
  <key>CFBundleName</key><string>{name}</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>{version}</string>
  <key>CFBundleVersion</key><string>{version}</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>NSHighResolutionCapable</key><true/>
</dict>
</plist>
"#
    )
}

fn deploy(root: &Path, target: DeployTarget) -> Result<()> {
    match target {
        DeployTarget::Web => {
            run_node(root, ["scripts/check-private-deploy.mjs"])?;
            check(root, CheckTarget::All)?;
            run_npm_exec(root, "wrangler", ["deploy"])
        }
    }
}

fn run_cargo(root: &Path, subcommand: &str, args: Vec<OsString>) -> Result<()> {
    let mut command = words(&[subcommand, "--manifest-path", NATIVE_MANIFEST]);
    command.extend(args);
    run_process(root, cargo_executable(), command)
}

fn run_node<const N: usize>(root: &Path, args: [&str; N]) -> Result<()> {
    run_process(root, node_executable(), words(&args))
}

fn run_npm_exec<I, S>(root: &Path, executable: &str, args: I) -> Result<()>
where
    I: IntoIterator<Item = S>,
    S: AsRef<OsStr>,
{
    let mut command = words(&["exec", "--", executable]);
    command.extend(args.into_iter().map(|arg| arg.as_ref().to_owned()));
    run_process(root, npm_executable(), command)
}

fn run_process(root: &Path, program: &str, args: Vec<OsString>) -> Result<()> {
    eprintln!("$ {}", display_command(program, &args));
    let status = Command::new(program)
        .args(&args)
        .current_dir(root)
        .status()
        .with_context(|| format!("failed to start {program}"))?;
    if !status.success() {
        bail!(
            "command exited with {status}: {}",
            display_command(program, &args)
        );
    }
    Ok(())
}

fn display_command(program: &str, args: &[OsString]) -> String {
    std::iter::once(OsStr::new(program))
        .chain(args.iter().map(OsString::as_os_str))
        .map(|part| {
            let part = part.to_string_lossy();
            if part.contains([' ', '\t']) {
                format!("{part:?}")
            } else {
                part.into_owned()
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn words(values: &[&str]) -> Vec<OsString> {
    values.iter().map(OsString::from).collect()
}

#[cfg(windows)]
fn cargo_executable() -> &'static str {
    "cargo.exe"
}

#[cfg(not(windows))]
fn cargo_executable() -> &'static str {
    "cargo"
}

#[cfg(windows)]
fn node_executable() -> &'static str {
    "node.exe"
}

#[cfg(not(windows))]
fn node_executable() -> &'static str {
    "node"
}

#[cfg(windows)]
fn npm_executable() -> &'static str {
    "npm.cmd"
}

#[cfg(not(windows))]
fn npm_executable() -> &'static str {
    "npm"
}

#[cfg(windows)]
fn executable(name: &str) -> String {
    format!("{name}.exe")
}

#[cfg(not(windows))]
fn executable(name: &str) -> String {
    name.to_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn native_bundle_plist_has_stable_identity() {
        let plist = desktop_info_plist("Castle & Notes", "app.castle.desktop", "1.2.3");
        assert!(plist.contains("app.castle.desktop"));
        assert!(plist.contains("Castle &amp; Notes"));
        assert!(plist.contains("castle-desktop"));
        assert!(plist.contains("1.2.3"));
        assert!(validate_bundle_name("Castle").is_ok());
        assert!(validate_bundle_name("../Castle").is_err());
    }

    #[test]
    fn build_and_run_default_to_the_native_desktop() {
        let build = Cli::try_parse_from(["cargo xtask", "build"]).expect("build command");
        assert!(matches!(
            build.task,
            Task::Build(BuildArgs {
                target: BuildTarget::Desktop,
                release: false
            })
        ));

        let run = Cli::try_parse_from(["cargo xtask", "run"]).expect("run command");
        assert!(matches!(
            run.task,
            Task::Run(RunArgs {
                target: RunTarget::Desktop,
                release: false,
                args
            }) if args.is_empty()
        ));
    }

    #[test]
    fn application_arguments_are_kept_after_the_separator() {
        let cli = Cli::try_parse_from([
            "cargo xtask",
            "run",
            "desktop",
            "--",
            "--library",
            "/tmp/example library",
        ])
        .expect("desktop arguments");
        assert!(matches!(
            cli.task,
            Task::Run(RunArgs { args, .. })
                if args == ["--library", "/tmp/example library"]
        ));
    }

    #[test]
    fn repository_root_contains_the_project_configuration() {
        assert!(
            repository_root()
                .unwrap()
                .join("CONFIGURATION.md")
                .is_file()
        );
    }
}
