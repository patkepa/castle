use anyhow::{Context, Result};
use chrono::{NaiveDate, SecondsFormat, TimeZone, Utc};
use regex::Regex;
use serde_json::{Map, Number, Value};

pub(crate) struct ParsedMarkdown {
    pub frontmatter: Value,
    pub content: String,
}

pub(crate) fn parse_markdown(source: &str) -> Result<ParsedMarkdown> {
    let source = source.strip_prefix('\u{feff}').unwrap_or(source);
    let Some((yaml, content)) = split_frontmatter(source) else {
        return Ok(ParsedMarkdown {
            frontmatter: Value::Object(Map::new()),
            content: source.to_owned(),
        });
    };
    let yaml_value: serde_yaml::Value =
        serde_yaml::from_str(yaml).with_context(|| "could not parse YAML frontmatter")?;
    let mut frontmatter = yaml_to_json(yaml_value)?;
    normalize_top_level_yaml_dates(yaml, &mut frontmatter);
    Ok(ParsedMarkdown {
        frontmatter,
        content: content.to_owned(),
    })
}

fn normalize_top_level_yaml_dates(yaml: &str, frontmatter: &mut Value) {
    let pattern =
        Regex::new(r"(?m)^([A-Za-z0-9_-]+):[ \t]+(\d{4}-\d{2}-\d{2})[ \t]*(?:#.*)?$").unwrap();
    let Some(object) = frontmatter.as_object_mut() else {
        return;
    };
    for captures in pattern.captures_iter(yaml) {
        let Ok(date) = NaiveDate::parse_from_str(&captures[2], "%Y-%m-%d") else {
            continue;
        };
        let timestamp = Utc
            .from_utc_datetime(&date.and_hms_opt(0, 0, 0).unwrap())
            .to_rfc3339_opts(SecondsFormat::Millis, true);
        object.insert(captures[1].to_owned(), Value::String(timestamp));
    }
}

fn split_frontmatter(source: &str) -> Option<(&str, &str)> {
    let normalized_start = source
        .strip_prefix("---\r\n")
        .map(|rest| (5, rest))
        .or_else(|| source.strip_prefix("---\n").map(|rest| (4, rest)))?;
    let (offset, rest) = normalized_start;
    let mut cursor = 0;
    for line in rest.split_inclusive('\n') {
        let trimmed = line.trim_end_matches(['\r', '\n']);
        if trimmed == "---" || trimmed == "..." {
            let yaml_end = offset + cursor;
            let content_start = yaml_end + line.len();
            return Some((&source[offset..yaml_end], &source[content_start..]));
        }
        cursor += line.len();
    }
    None
}

fn yaml_to_json(value: serde_yaml::Value) -> Result<Value> {
    Ok(match value {
        serde_yaml::Value::Null => Value::Null,
        serde_yaml::Value::Bool(value) => Value::Bool(value),
        serde_yaml::Value::Number(value) => {
            if let Some(value) = value.as_i64() {
                Value::Number(Number::from(value))
            } else if let Some(value) = value.as_u64() {
                Value::Number(Number::from(value))
            } else {
                Value::Number(
                    Number::from_f64(value.as_f64().unwrap_or_default())
                        .context("frontmatter contains a non-finite number")?,
                )
            }
        }
        serde_yaml::Value::String(value) => Value::String(value),
        serde_yaml::Value::Sequence(values) => Value::Array(
            values
                .into_iter()
                .map(yaml_to_json)
                .collect::<Result<_>>()?,
        ),
        serde_yaml::Value::Mapping(values) => {
            let mut object = Map::new();
            for (key, value) in values {
                let key = match key {
                    serde_yaml::Value::String(key) => key,
                    other => serde_yaml::to_string(&other)?.trim().to_owned(),
                };
                object.insert(key, yaml_to_json(value)?);
            }
            Value::Object(object)
        }
        serde_yaml::Value::Tagged(tagged) => yaml_to_json(tagged.value)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_frontmatter_and_preserves_markdown_body() {
        let parsed =
            parse_markdown("---\r\ntitle: Castle\r\ntags: [one, two]\r\n---\r\n# Body\r\n")
                .unwrap();
        assert_eq!(parsed.frontmatter["title"], "Castle");
        assert_eq!(parsed.frontmatter["tags"][1], "two");
        assert_eq!(parsed.content, "# Body\r\n");
    }
}
