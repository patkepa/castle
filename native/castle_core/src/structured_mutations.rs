use std::sync::LazyLock;

use anyhow::{Result, anyhow, bail};
use castle_contracts::{PersonFields, TaskFields, TaskStatus};
use regex::{Captures, Regex};

static FRONTMATTER: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?s)^(\u{FEFF}?---[\t ]*\r?\n)(.*?)(\r?\n---[\t ]*(?:\r?\n|$))")
        .expect("frontmatter regex")
});
static CHECKLIST: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?m)^(\s*[-*+]\s+\[)([ xX])(\]\s+.+?)\s*$").expect("checklist regex")
});
static CHECKLIST_LINE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?m)^\s*[-*+]\s+\[[ xX]\]\s+.+?(?:\r?\n|$)").expect("checklist-line regex")
});
static TASK_SLUG_SEPARATOR: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"[^\p{L}\p{N}]+").expect("task slug regex"));
static FRONTMATTER_NESTED_LINE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^[\t ]+\S").expect("frontmatter nested-line regex"));

pub(crate) struct ResolvedTaskFields<'a> {
    pub fields: &'a TaskFields,
    pub sort_order: f64,
    pub project_link: String,
    pub people_links: Vec<String>,
}

pub(crate) fn update_task_markdown(
    markdown: &str,
    resolved: ResolvedTaskFields<'_>,
    completed_date: &str,
) -> Result<String> {
    let source = split_source(markdown, "task")?;
    let fields = resolved.fields;
    let title = fields.title.trim();
    if title.is_empty() {
        bail!("A task must have a title.");
    }
    let mut frontmatter = source.frontmatter.to_owned();
    let completed_at = read_scalar(&frontmatter, "completed_at");
    frontmatter = set_scalar(&frontmatter, "title", quoted(title));
    frontmatter = set_scalar(
        &frontmatter,
        "description",
        optional_quoted(&fields.description),
    );
    frontmatter = set_scalar(
        &frontmatter,
        "status",
        Some(fields.status.as_str().to_owned()),
    );
    frontmatter = set_scalar(
        &frontmatter,
        "due_date",
        optional_quoted(&fields.target_date),
    );
    frontmatter = set_scalar(
        &frontmatter,
        "due_time",
        if fields.target_date.trim().is_empty() {
            None
        } else {
            optional_quoted(&fields.target_time)
        },
    );
    frontmatter = set_scalar(
        &frontmatter,
        "estimate_minutes",
        (fields.estimate_minutes > 0).then(|| fields.estimate_minutes.to_string()),
    );
    frontmatter = set_scalar(
        &frontmatter,
        "sort_order",
        Some(format_sort_order(resolved.sort_order)),
    );
    frontmatter = set_scalar(
        &frontmatter,
        "project",
        optional_quoted(&resolved.project_link),
    );
    frontmatter = set_scalar(
        &frontmatter,
        "people",
        nonempty_json_array(&resolved.people_links)?,
    );
    frontmatter = set_scalar(&frontmatter, "tags", nonempty_json_array(&fields.tags)?);
    frontmatter = set_scalar(
        &frontmatter,
        "completed_at",
        (fields.status == TaskStatus::Done)
            .then(|| {
                quoted(if completed_at.is_empty() {
                    completed_date
                } else {
                    &completed_at
                })
            })
            .flatten(),
    );
    Ok(join_source(
        &source,
        &frontmatter,
        &replace_first_heading(source.body, title),
    ))
}

pub(crate) fn update_task_status_markdown(
    markdown: &str,
    status: TaskStatus,
    completed_date: &str,
) -> Result<String> {
    let source = split_source(markdown, "task")?;
    let mut frontmatter = set_scalar(
        source.frontmatter,
        "status",
        Some(status.as_str().to_owned()),
    );
    let completed_at = read_scalar(&frontmatter, "completed_at");
    frontmatter = set_scalar(
        &frontmatter,
        "completed_at",
        (status == TaskStatus::Done)
            .then(|| {
                quoted(if completed_at.is_empty() {
                    completed_date
                } else {
                    &completed_at
                })
            })
            .flatten(),
    );
    Ok(join_source(&source, &frontmatter, source.body))
}

pub(crate) fn update_task_placement_markdown(
    markdown: &str,
    status: TaskStatus,
    sort_order: f64,
    completed_date: &str,
) -> Result<String> {
    let with_status = update_task_status_markdown(markdown, status, completed_date)?;
    let source = split_source(&with_status, "task")?;
    let frontmatter = set_scalar(
        source.frontmatter,
        "sort_order",
        Some(format_sort_order(sort_order)),
    );
    Ok(join_source(&source, &frontmatter, source.body))
}

pub(crate) fn create_task_markdown(
    id: &str,
    fields: &TaskFields,
    sort_order: f64,
    project_link: &str,
    people_links: &[String],
    created: &str,
) -> Result<String> {
    let title = fields.title.trim();
    if title.is_empty() {
        bail!("A task must have a title.");
    }
    let mut rows = vec![
        "type: task".to_owned(),
        "schema_version: 1".to_owned(),
        format!("id: {id}"),
        format!("title: {}", quoted(title).expect("quoted task title")),
        format!("status: {}", fields.status.as_str()),
        format!("sort_order: {}", format_sort_order(sort_order)),
        format!("created: {}", quoted(created).expect("quoted created date")),
    ];
    push_optional(&mut rows, "description", &fields.description);
    push_optional(&mut rows, "due_date", &fields.target_date);
    if !fields.target_date.trim().is_empty() {
        push_optional(&mut rows, "due_time", &fields.target_time);
    }
    if fields.estimate_minutes > 0 {
        rows.push(format!("estimate_minutes: {}", fields.estimate_minutes));
    }
    push_optional(&mut rows, "project", project_link);
    if !people_links.is_empty() {
        rows.push(format!("people: {}", serde_json::to_string(people_links)?));
    }
    if !fields.tags.is_empty() {
        rows.push(format!("tags: {}", serde_json::to_string(&fields.tags)?));
    }
    if fields.status == TaskStatus::Done {
        rows.push(format!(
            "completed_at: {}",
            quoted(created).expect("quoted completed date")
        ));
    }
    Ok(format!("---\n{}\n---\n\n# {title}\n", rows.join("\n")))
}

pub(crate) fn toggle_task_checklist(markdown: &str, index: usize) -> String {
    let mut current = 0usize;
    CHECKLIST
        .replace_all(markdown, |captures: &Captures<'_>| {
            let line = captures
                .get(0)
                .map(|value| value.as_str())
                .unwrap_or_default();
            let selected = current == index;
            current += 1;
            if !selected {
                return line.to_owned();
            }
            let mark = captures.get(2).map(|value| value.as_str()).unwrap_or(" ");
            format!(
                "{}{}{}",
                captures
                    .get(1)
                    .map(|value| value.as_str())
                    .unwrap_or_default(),
                if mark.eq_ignore_ascii_case("x") {
                    " "
                } else {
                    "x"
                },
                captures
                    .get(3)
                    .map(|value| value.as_str())
                    .unwrap_or_default(),
            )
        })
        .into_owned()
}

pub(crate) fn remove_task_checklist(markdown: &str, index: usize) -> String {
    let mut current = 0usize;
    let removed = CHECKLIST_LINE
        .replace_all(markdown, |captures: &Captures<'_>| {
            let selected = current == index;
            current += 1;
            if selected {
                String::new()
            } else {
                captures
                    .get(0)
                    .map(|value| value.as_str())
                    .unwrap_or_default()
                    .to_owned()
            }
        })
        .into_owned();
    Regex::new(r"\n{3,}")
        .expect("blank-line regex")
        .replace_all(&removed, "\n\n")
        .into_owned()
}

pub(crate) fn append_task_checklist(markdown: &str, title: &str) -> String {
    let normalized = title.split_whitespace().collect::<Vec<_>>().join(" ");
    if normalized.is_empty() {
        return markdown.to_owned();
    }
    let newline = if markdown.contains("\r\n") {
        "\r\n"
    } else {
        "\n"
    };
    let source = markdown.trim_end();
    let heading = Regex::new(r"(?im)^##\s+(?:Subtasks|Checklist)\s*$")
        .expect("checklist heading regex")
        .find(source);
    let Some(heading) = heading else {
        return format!(
            "{source}{newline}{newline}## Subtasks{newline}{newline}- [ ] {normalized}{newline}"
        );
    };
    let section_start = heading.end();
    let remaining = &source[section_start..];
    let next_section = Regex::new(r"(?m)^#{1,2}\s+.+$")
        .expect("section regex")
        .find(remaining);
    let insertion = next_section
        .map(|section| section_start + section.start())
        .unwrap_or(source.len());
    let before = source[..insertion].trim_end();
    let after = source[insertion..].trim_start();
    format!(
        "{before}{newline}{newline}- [ ] {normalized}{newline}{}",
        if after.is_empty() {
            String::new()
        } else {
            format!("{newline}{after}{newline}")
        }
    )
}

pub(crate) fn task_slug(value: &str) -> String {
    let slug = TASK_SLUG_SEPARATOR
        .replace_all(&value.to_lowercase(), "_")
        .trim_matches('_')
        .chars()
        .take(96)
        .collect::<String>();
    if slug.is_empty() {
        "new_task".to_owned()
    } else {
        slug
    }
}

pub(crate) fn update_person_markdown(markdown: &str, fields: &PersonFields) -> Result<String> {
    let source = split_source(markdown, "person")?;
    let name = fields.name.trim();
    if name.is_empty() {
        bail!("A person must have a name.");
    }
    let mut frontmatter = source.frontmatter.to_owned();
    let previous_location = read_primary_location(&frontmatter);
    frontmatter = set_scalar(&frontmatter, "name", quoted(name));
    for (key, value) in [
        ("nickname", fields.nickname.as_str()),
        ("birthday", fields.birthday.as_str()),
        ("birthplace", fields.birthplace.as_str()),
        ("nationality", fields.nationality.as_str()),
        ("company", fields.company.as_str()),
        ("avatar", fields.avatar.as_str()),
        ("met", fields.met.as_str()),
        ("met_through", fields.met_through.as_str()),
    ] {
        frontmatter = set_scalar(&frontmatter, key, optional_quoted(value));
    }
    frontmatter = set_scalar(
        &frontmatter,
        "status",
        (fields.status == castle_contracts::PersonStatus::Former).then(|| "former".to_owned()),
    );
    frontmatter = set_block_list(
        &frontmatter,
        "alignment",
        &normalized(&fields.alignments, "unknown"),
    );
    frontmatter = set_scalar(
        &frontmatter,
        "relation",
        Some(
            serde_json::to_value(fields.relation)?
                .as_str()
                .unwrap_or("neutral")
                .to_owned(),
        ),
    );
    frontmatter = set_block_list(
        &frontmatter,
        "known_from",
        &normalized(&fields.known_from, "unknown"),
    );
    frontmatter = set_block_list(
        &frontmatter,
        "department",
        &normalized(&fields.departments, ""),
    );
    frontmatter = set_block_list(&frontmatter, "tags", &normalized(&fields.tags, ""));
    let location = if fields.location.trim().is_empty() {
        "unknown"
    } else {
        fields.location.trim()
    };
    frontmatter = set_person_location(&frontmatter, location, previous_location != location)?;
    let newline = if markdown.contains("\r\n") {
        "\r\n"
    } else {
        "\n"
    };
    let body = replace_first_heading(source.body, name)
        .replace("\r\n", "\n")
        .replace('\n', newline);
    let body = format!("{}{}", body.trim_start_matches(['\r', '\n']), newline);
    Ok(format!(
        "{}{}{}{}{}",
        source.opening, frontmatter, source.closing, newline, body
    ))
}

struct SourceParts<'a> {
    opening: &'a str,
    frontmatter: &'a str,
    closing: &'a str,
    body: &'a str,
}

fn split_source<'a>(markdown: &'a str, kind: &str) -> Result<SourceParts<'a>> {
    let captures = FRONTMATTER
        .captures(markdown)
        .ok_or_else(|| anyhow!("This {kind} is missing YAML frontmatter."))?;
    let full = captures.get(0).expect("full frontmatter capture");
    Ok(SourceParts {
        opening: captures.get(1).expect("opening capture").as_str(),
        frontmatter: captures.get(2).expect("frontmatter capture").as_str(),
        closing: captures.get(3).expect("closing capture").as_str(),
        body: &markdown[full.end()..],
    })
}

fn join_source(source: &SourceParts<'_>, frontmatter: &str, body: &str) -> String {
    format!(
        "{}{}{}{}",
        source.opening, frontmatter, source.closing, body
    )
}

fn set_scalar(frontmatter: &str, key: &str, value: Option<String>) -> String {
    set_field(
        frontmatter,
        key,
        value.map(|value| vec![format!("{key}: {value}")]),
    )
}

fn set_block_list(frontmatter: &str, key: &str, values: &[String]) -> String {
    let replacement = (!values.is_empty()).then(|| {
        std::iter::once(format!("{key}:"))
            .chain(
                values
                    .iter()
                    .map(|value| format!("  - {}", quoted(value).expect("quoted list value"))),
            )
            .collect()
    });
    set_field(frontmatter, key, replacement)
}

fn set_field(frontmatter: &str, key: &str, replacement: Option<Vec<String>>) -> String {
    let mut lines = frontmatter.lines().map(str::to_owned).collect::<Vec<_>>();
    let key_pattern =
        Regex::new(&format!(r"^{}\s*:", regex::escape(key))).expect("frontmatter key regex");
    if let Some(start) = lines.iter().position(|line| key_pattern.is_match(line)) {
        let mut end = start + 1;
        while end < lines.len() && FRONTMATTER_NESTED_LINE.is_match(&lines[end]) {
            end += 1;
        }
        lines.splice(start..end, replacement.unwrap_or_default());
    } else if let Some(replacement) = replacement {
        lines.extend(replacement);
    }
    lines.join("\n")
}

fn read_scalar(frontmatter: &str, key: &str) -> String {
    let pattern =
        Regex::new(&format!(r"(?m)^{}\s*:\s*(.*?)\s*$", regex::escape(key))).expect("scalar regex");
    let value = pattern
        .captures(frontmatter)
        .and_then(|captures| captures.get(1))
        .map(|value| value.as_str())
        .unwrap_or_default();
    value
        .strip_prefix('"')
        .and_then(|value| value.strip_suffix('"'))
        .or_else(|| {
            value
                .strip_prefix('\'')
                .and_then(|value| value.strip_suffix('\''))
        })
        .unwrap_or(value)
        .to_owned()
}

fn read_primary_location(frontmatter: &str) -> String {
    let legacy = read_scalar(frontmatter, "location");
    if !legacy.is_empty() {
        return legacy;
    }
    let lines = frontmatter.lines().collect::<Vec<_>>();
    let Some((start, end)) = field_range(&lines, "locations") else {
        return String::new();
    };
    let items = list_item_ranges(&lines, start + 1, end);
    let selected = items
        .iter()
        .find(|(item_start, item_end)| {
            lines[*item_start..*item_end]
                .iter()
                .any(|line| line.trim() == "primary: true")
        })
        .or_else(|| items.first());
    selected
        .and_then(|(item_start, item_end)| {
            lines[*item_start..*item_end].iter().find_map(|line| {
                let trimmed = line.trim_start();
                trimmed
                    .strip_prefix("address:")
                    .map(|value| unquote(value.trim()).to_owned())
            })
        })
        .unwrap_or_default()
}

fn set_person_location(frontmatter: &str, location: &str, changed: bool) -> Result<String> {
    let mut lines = frontmatter.lines().map(str::to_owned).collect::<Vec<_>>();
    let borrowed = lines.iter().map(String::as_str).collect::<Vec<_>>();
    let Some((start, end)) = field_range(&borrowed, "locations") else {
        let mut updated = set_scalar(frontmatter, "location", quoted(location));
        if changed {
            updated = set_field(&updated, "coordinates", None);
        }
        return Ok(updated);
    };
    let items = list_item_ranges(&borrowed, start + 1, end);
    let selected = items
        .iter()
        .find(|(item_start, item_end)| {
            borrowed[*item_start..*item_end]
                .iter()
                .any(|line| line.trim() == "primary: true")
        })
        .or_else(|| items.first())
        .copied()
        .ok_or_else(|| anyhow!("This person has an invalid locations list."))?;
    let address_index = (selected.0..selected.1)
        .find(|index| lines[*index].trim_start().starts_with("address:"))
        .ok_or_else(|| anyhow!("The primary location is missing an address."))?;
    let indentation = leading_spaces(&lines[address_index]);
    lines[address_index] = format!(
        "{}address: {}",
        " ".repeat(indentation),
        quoted(location).expect("quoted location")
    );

    if changed {
        let coordinates_index = (selected.0..selected.1)
            .find(|index| lines[*index].trim_start().starts_with("coordinates:"));
        if let Some(coordinates_index) = coordinates_index {
            let coordinate_indent = leading_spaces(&lines[coordinates_index]);
            let mut coordinate_end = coordinates_index + 1;
            while coordinate_end < lines.len()
                && (lines[coordinate_end].trim().is_empty()
                    || leading_spaces(&lines[coordinate_end]) > coordinate_indent)
            {
                coordinate_end += 1;
            }
            lines.drain(coordinates_index..coordinate_end);
        }
    }
    Ok(lines.join("\n"))
}

fn field_range(lines: &[&str], key: &str) -> Option<(usize, usize)> {
    let prefix = format!("{key}:");
    let start = lines.iter().position(|line| line.starts_with(&prefix))?;
    let end = (start + 1..lines.len())
        .find(|index| {
            let line = lines[*index];
            !line.trim().is_empty() && leading_spaces(line) == 0 && line.contains(':')
        })
        .unwrap_or(lines.len());
    Some((start, end))
}

fn list_item_ranges(lines: &[&str], start: usize, end: usize) -> Vec<(usize, usize)> {
    let starts = (start..end)
        .filter(|index| lines[*index].trim_start().starts_with("- "))
        .collect::<Vec<_>>();
    starts
        .iter()
        .enumerate()
        .map(|(index, item_start)| (*item_start, starts.get(index + 1).copied().unwrap_or(end)))
        .collect()
}

fn leading_spaces(value: &str) -> usize {
    value
        .chars()
        .take_while(|character| *character == ' ')
        .count()
}

fn unquote(value: &str) -> &str {
    value
        .strip_prefix('"')
        .and_then(|value| value.strip_suffix('"'))
        .or_else(|| {
            value
                .strip_prefix('\'')
                .and_then(|value| value.strip_suffix('\''))
        })
        .unwrap_or(value)
}

fn replace_first_heading(body: &str, title: &str) -> String {
    let heading = Regex::new(r"(?m)^#\s+.+$").expect("heading regex");
    if heading.is_match(body) {
        return heading.replace(body, format!("# {title}")).into_owned();
    }
    let newline = if body.contains("\r\n") { "\r\n" } else { "\n" };
    format!("{newline}# {title}{newline}{}", body.trim_start())
}

fn quoted(value: &str) -> Option<String> {
    Some(serde_json::to_string(value).expect("string serialization"))
}

fn optional_quoted(value: &str) -> Option<String> {
    let value = value.trim();
    (!value.is_empty()).then(|| serde_json::to_string(value).expect("string serialization"))
}

fn nonempty_json_array(values: &[String]) -> Result<Option<String>> {
    if values.is_empty() {
        Ok(None)
    } else {
        Ok(Some(serde_json::to_string(values)?))
    }
}

fn push_optional(rows: &mut Vec<String>, key: &str, value: &str) {
    if let Some(value) = optional_quoted(value) {
        rows.push(format!("{key}: {value}"));
    }
}

fn normalized(values: &[String], fallback: &str) -> Vec<String> {
    let mut result = Vec::new();
    for value in values
        .iter()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
    {
        if !result.iter().any(|item| item == value) {
            result.push(value.to_owned());
        }
    }
    if result.is_empty() && !fallback.is_empty() {
        result.push(fallback.to_owned());
    }
    result
}

fn format_sort_order(value: f64) -> String {
    let rounded = (value.max(0.0) * 1_000_000.0).round() / 1_000_000.0;
    rounded.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use castle_contracts::{PersonRelation, PersonStatus};

    #[test]
    fn task_status_and_checklist_edits_preserve_source_shape() {
        let source = "---\ntype: task\nschema_version: 1\nid: task_one\nstatus: todo\n---\n\n# One\n\n- [ ] Check\n";
        let status = update_task_status_markdown(source, TaskStatus::Done, "2026-08-03").unwrap();
        assert!(status.contains("status: done"));
        assert!(status.contains("completed_at: \"2026-08-03\""));
        assert!(toggle_task_checklist(&status, 0).contains("- [x] Check"));
    }

    #[test]
    fn task_field_updates_and_creation_are_owned_by_the_native_engine() {
        let source = "---\ntype: task\nschema_version: 1\nid: task_one\nstatus: todo\n---\n\n# Old\n\nBody.\n";
        let fields = TaskFields {
            title: "New title".to_owned(),
            description: "Description".to_owned(),
            status: TaskStatus::InProgress,
            target_date: "2026-08-05".to_owned(),
            target_time: "09:30".to_owned(),
            estimate_minutes: 45,
            project_id: "project_castle".to_owned(),
            people_ids: vec!["person_alex".to_owned()],
            tags: vec!["important".to_owned()],
        };
        let updated = update_task_markdown(
            source,
            ResolvedTaskFields {
                fields: &fields,
                sort_order: 1500.5,
                project_link: "[[projects/castle/castle|Castle]]".to_owned(),
                people_links: vec!["[[people/alex_morgan|Alex Morgan]]".to_owned()],
            },
            "2026-08-03",
        )
        .unwrap();
        assert!(updated.contains("title: \"New title\""));
        assert!(updated.contains("status: in_progress"));
        assert!(updated.contains("sort_order: 1500.5"));
        assert!(updated.contains("# New title"));
        assert!(updated.contains("Body."));

        let created = create_task_markdown(
            "task_new_title",
            &fields,
            2000.0,
            "[[projects/castle/castle|Castle]]",
            &["[[people/alex_morgan|Alex Morgan]]".to_owned()],
            "2026-08-03",
        )
        .unwrap();
        assert!(created.contains("id: task_new_title"));
        assert!(created.contains("# New title"));
    }

    #[test]
    fn task_slugs_are_stable_snake_case() {
        assert_eq!(task_slug(" Żółta Castle task "), "żółta_castle_task");
    }

    #[test]
    fn person_edit_updates_only_the_primary_structured_location() {
        let source = "---\ntype: person\nschema_version: 1\nid: person_one\nname: \"One\"\nlocations:\n  - label: \"Home\"\n    address: \"Old\"\n    primary: true\n    coordinates:\n      latitude: 1\n      longitude: 2\n  - label: \"Work\"\n    address: \"Office\"\n---\n\n# One\n";
        let updated = update_person_markdown(
            source,
            &PersonFields {
                name: "New name".to_owned(),
                nickname: String::new(),
                birthday: String::new(),
                birthplace: String::new(),
                nationality: String::new(),
                status: PersonStatus::Active,
                alignments: vec!["friend".to_owned()],
                relation: PersonRelation::Positive,
                known_from: vec!["work".to_owned()],
                company: String::new(),
                departments: Vec::new(),
                location: "New home".to_owned(),
                avatar: String::new(),
                tags: Vec::new(),
                met: String::new(),
                met_through: String::new(),
                body: "# One\n".to_owned(),
            },
        )
        .unwrap();
        assert!(updated.contains("address: \"New home\""));
        assert!(updated.contains("address: \"Office\""));
        assert!(!updated.contains("latitude:"));
        assert!(!updated.contains("location: \"New home\""));
        assert!(updated.contains("# New name"));
    }
}
