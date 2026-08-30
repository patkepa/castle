use std::path::PathBuf;

use anyhow::{Context, Result, bail};

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct StartupOptions {
    pub library: Option<PathBuf>,
    pub cache: Option<PathBuf>,
}

pub fn parse_startup_options(
    arguments: impl IntoIterator<Item = String>,
) -> Result<StartupOptions> {
    let mut arguments = arguments.into_iter();
    let mut options = StartupOptions::default();
    while let Some(argument) = arguments.next() {
        match argument.as_str() {
            "--library" => {
                options.library = Some(PathBuf::from(
                    arguments.next().context("--library requires a path")?,
                ));
            }
            "--cache" => {
                options.cache = Some(PathBuf::from(
                    arguments.next().context("--cache requires a path")?,
                ));
            }
            "--help" | "-h" => {}
            unknown if unknown.starts_with('-') => bail!("unknown option {unknown}"),
            _ => {}
        }
    }
    Ok(options)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_native_startup_paths() {
        assert_eq!(
            parse_startup_options([
                "--library".into(),
                "/tmp/vault".into(),
                "--cache".into(),
                "/tmp/cache".into(),
            ])
            .unwrap(),
            StartupOptions {
                library: Some(PathBuf::from("/tmp/vault")),
                cache: Some(PathBuf::from("/tmp/cache")),
            }
        );
    }

    #[test]
    fn rejects_missing_and_unknown_options() {
        assert!(parse_startup_options(["--library".into()]).is_err());
        assert!(parse_startup_options(["--unknown".into()]).is_err());
    }
}
