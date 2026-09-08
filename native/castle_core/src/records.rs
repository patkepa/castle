use std::{collections::HashMap, path::Path, sync::LazyLock};

use anyhow::{Result, bail};
use regex::Regex;
use serde_json::Value;

use crate::{model::SourceNote, normalization::first_string};

static STABLE_ID: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^[\p{L}\p{N}]+(?:_[\p{L}\p{N}]+)*$").unwrap());
static WIKI_LINK: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]$").unwrap());

const SCHEMAS: [(&str, &str, &str); 4] = [
    (
        "person",
        "person_",
        include_str!("../schemas/person.schema.json"),
    ),
    (
        "project",
        "project_",
        include_str!("../schemas/project.schema.json"),
    ),
    ("task", "task_", include_str!("../schemas/task.schema.json")),
    (
        "calendar_event",
        "event_",
        include_str!("../schemas/calendar_event.schema.json"),
    ),
];

static RECORD_VALIDATORS: LazyLock<HashMap<&'static str, (&'static str, jsonschema::Validator)>> =
    LazyLock::new(|| {
        SCHEMAS
            .iter()
            .map(|(record_type, prefix, source)| {
                let schema = serde_json::from_str::<Value>(source)
                    .expect("embedded Castle Record schema must be valid JSON");
                let validator = jsonschema::validator_for(&schema)
                    .expect("embedded Castle Record schema must compile");
                (*record_type, (*prefix, validator))
            })
            .collect()
    });

pub(crate) fn validate_records(
    notes: &[SourceNote],
    library_root: &Path,
) -> Result<(usize, Vec<String>)> {
    let notes_by_source = notes
        .iter()
        .map(|note| (without_extension(&note.source_file), note))
        .collect::<HashMap<_, _>>();
    validate_required_locations(&notes_by_source)?;
    let mut ids = HashMap::<String, String>::new();
    let mut warnings = Vec::new();
    for note in notes {
        let record_type = first_string(note.frontmatter.get("type"));
        if record_type.is_empty() {
            continue;
        }
        let Some((prefix, validator)) = RECORD_VALIDATORS.get(record_type.as_str()) else {
            bail!(
                "{}: unsupported Castle Record type \"{}\"",
                note.source_file,
                record_type
            );
        };
        validate_record_location(&record_type, &note.source_file)?;
        if let Err(error) = validator.validate(&note.frontmatter) {
            bail!(
                "{}: invalid {} record: {}",
                note.source_file,
                record_type,
                error
            );
        }
        if record_type == "person" {
            validate_person_coordinates(&note.frontmatter, &note.source_file)?;
        }
        if !STABLE_ID.is_match(&note.id) {
            bail!(
                "{}: id must be a human-readable snake_case identifier",
                note.source_file
            );
        }
        if !note.id.starts_with(prefix) {
            bail!(
                "{}: {} id must start with \"{}\"",
                note.source_file,
                record_type,
                prefix
            );
        }
        if let Some(previous) = ids.insert(note.id.clone(), note.source_file.clone()) {
            bail!(
                "{}: duplicate record id \"{}\" already used by {}",
                note.source_file,
                note.id,
                previous
            );
        }
        validate_links(
            &note.frontmatter,
            &note.source_file,
            &notes_by_source,
            library_root,
            "frontmatter",
        )?;
        collect_empty_warnings(&note.frontmatter, &note.source_file, "", &mut warnings);
    }
    Ok((ids.len(), warnings))
}

pub(crate) fn validate_record_frontmatter(
    frontmatter: &Value,
    source_file: &str,
    expected_note_id: &str,
    library_root: &Path,
) -> Result<()> {
    let record_type = first_string(frontmatter.get("type"));
    let required_type = required_record_type(source_file);
    if record_type.is_empty() {
        if let Some(required_type) = required_type {
            bail!("{source_file}: type must be \"{required_type}\"");
        }
        return Ok(());
    }
    if let Some(required_type) = required_type.filter(|required| *required != record_type) {
        bail!("{source_file}: type must be \"{required_type}\"");
    }
    let Some((prefix, validator)) = RECORD_VALIDATORS.get(record_type.as_str()) else {
        bail!(
            "{source_file}: unsupported Castle Record type \"{}\"",
            record_type
        );
    };
    validate_record_location(&record_type, source_file)?;
    if let Err(error) = validator.validate(frontmatter) {
        bail!("{source_file}: invalid {record_type} record: {error}");
    }
    let id = first_string(frontmatter.get("id"));
    if id != expected_note_id {
        bail!("{source_file}: record id \"{id}\" does not match note id \"{expected_note_id}\"");
    }
    if !STABLE_ID.is_match(&id) {
        bail!("{source_file}: id must be a human-readable snake_case identifier");
    }
    if !id.starts_with(prefix) {
        bail!("{source_file}: {record_type} id must start with \"{prefix}\"");
    }
    if record_type == "person" {
        validate_person_coordinates(frontmatter, source_file)?;
    }
    validate_links(
        frontmatter,
        source_file,
        &HashMap::new(),
        library_root,
        "frontmatter",
    )?;
    Ok(())
}

fn required_record_type(source_file: &str) -> Option<&'static str> {
    let source = without_extension(source_file);
    let segments = source.split('/').collect::<Vec<_>>();
    match segments.as_slice() {
        ["people", _] => Some("person"),
        ["tasks", _] => Some("task"),
        ["events", _, _] => Some("calendar_event"),
        ["projects", project, rest @ ..]
            if rest.first().is_some_and(|candidate| *candidate == *project) =>
        {
            Some("project")
        }
        _ => None,
    }
}

fn validate_record_location(record_type: &str, source_file: &str) -> Result<()> {
    if required_record_type(source_file) == Some(record_type) {
        return Ok(());
    }
    let required_root = match record_type {
        "person" => "people/",
        "project" => "projects/<project>/<project>.md",
        "task" => "tasks/",
        "calendar_event" => "events/<year>/",
        _ => "its required Castle path",
    };
    bail!("{source_file}: {record_type} records must be stored under {required_root}")
}

fn validate_required_locations(notes: &HashMap<String, &SourceNote>) -> Result<()> {
    let mut required = HashMap::<String, &'static str>::new();
    for source in notes.keys() {
        let segments = source.split('/').collect::<Vec<_>>();
        match segments.as_slice() {
            ["people", _] => {
                required.insert(source.clone(), "person");
            }
            ["tasks", _] => {
                required.insert(source.clone(), "task");
            }
            ["events", _, _] => {
                required.insert(source.clone(), "calendar_event");
            }
            ["projects", project, ..] => {
                required.insert(format!("projects/{project}/{project}"), "project");
            }
            _ => {}
        }
    }
    for (source, expected) in required {
        let Some(note) = notes.get(&source) else {
            bail!("{source}.md: required {expected} record is missing");
        };
        if first_string(note.frontmatter.get("type")) != expected {
            bail!("{}: type must be \"{}\"", note.source_file, expected);
        }
    }
    Ok(())
}

fn validate_person_coordinates(frontmatter: &Value, source: &str) -> Result<()> {
    if let Some(locations) = frontmatter.get("locations").and_then(Value::as_array) {
        for (index, location) in locations.iter().enumerate() {
            validate_location(
                location.get("address"),
                location.get("coordinates"),
                &format!("{source}: locations[{index}]"),
            )?;
        }
    } else {
        validate_location(
            frontmatter.get("location"),
            frontmatter.get("coordinates"),
            source,
        )?;
    }
    Ok(())
}

fn validate_location(
    location: Option<&Value>,
    coordinates: Option<&Value>,
    source: &str,
) -> Result<()> {
    let location = first_string(location);
    let known = !location.eq_ignore_ascii_case("unknown");
    if known && coordinates.is_none() {
        bail!("{source}: known location is missing generated coordinates");
    }
    if !known && coordinates.is_some() {
        bail!("{source}: omit coordinates when location is unknown");
    }
    if known
        && coordinates
            .and_then(|value| value.get("resolved_from"))
            .map(|value| first_string(Some(value)))
            .unwrap_or_default()
            != location
    {
        bail!("{source}: coordinates are stale; resolved_from must match location");
    }
    Ok(())
}

fn validate_links(
    value: &Value,
    source: &str,
    notes: &HashMap<String, &SourceNote>,
    library_root: &Path,
    field: &str,
) -> Result<()> {
    match value {
        Value::String(value) if value.starts_with("[[") => {
            let Some(capture) = WIKI_LINK.captures(value) else {
                bail!("{source}: {field} has an invalid Obsidian link");
            };
            let target = capture[1]
                .replace('\\', "/")
                .trim_start_matches('/')
                .trim_end_matches(".md")
                .to_owned();
            if !notes.contains_key(&target)
                && !library_root.join(&target).exists()
                && !library_root.join(format!("{target}.md")).exists()
            {
                bail!("{source}: {field} references missing library file \"{target}\"");
            }
        }
        Value::Array(values) => {
            for (index, value) in values.iter().enumerate() {
                validate_links(
                    value,
                    source,
                    notes,
                    library_root,
                    &format!("{field}[{index}]"),
                )?;
            }
        }
        Value::Object(values) => {
            for (key, value) in values {
                validate_links(
                    value,
                    source,
                    notes,
                    library_root,
                    &format!("{field}.{key}"),
                )?;
            }
        }
        _ => {}
    }
    Ok(())
}

fn collect_empty_warnings(value: &Value, source: &str, field: &str, warnings: &mut Vec<String>) {
    match value {
        Value::String(value) if value.trim().is_empty() && !field.is_empty() => warnings.push(
            format!("{source}: omit empty optional property \"{field}\""),
        ),
        Value::Array(values) => {
            for (index, value) in values.iter().enumerate() {
                collect_empty_warnings(value, source, &format!("{field}[{index}]"), warnings);
            }
        }
        Value::Object(values) => {
            for (key, value) in values {
                let child = if field.is_empty() {
                    key.clone()
                } else {
                    format!("{field}.{key}")
                };
                collect_empty_warnings(value, source, &child, warnings);
            }
        }
        _ => {}
    }
}

fn without_extension(value: &str) -> String {
    value
        .strip_suffix(".mdx")
        .or_else(|| value.strip_suffix(".md"))
        .unwrap_or(value)
        .to_owned()
}
