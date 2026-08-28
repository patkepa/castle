use std::{
    cmp::Ordering,
    collections::{HashMap, HashSet},
    sync::LazyLock,
};

use anyhow::{Result, bail};
use castle_contracts::{Task, TaskPerson, TaskStatus, TaskSubtask};
use chrono::{DateTime, NaiveDate};
use regex::Regex;
use serde_json::Value;

use crate::{
    model::SourceNote,
    normalization::{clean_inline_markdown, first_string},
    references::{build_reference_lookup, project_reference, resolve_many, resolve_one},
};

static CHECKLIST: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?m)^\s*[-*+]\s+\[([ xX])\]\s+(.+?)\s*$").unwrap());

pub(crate) fn build_tasks(
    task_notes: &[&SourceNote],
    person_notes: &[&SourceNote],
    project_notes: &[&SourceNote],
) -> Result<Vec<Task>> {
    let people_lookup = build_reference_lookup(person_notes);
    let projects_lookup = build_reference_lookup(project_notes);
    let people_by_id = person_notes
        .iter()
        .map(|note| (note.id.as_str(), *note))
        .collect::<HashMap<_, _>>();
    let mut ids = HashSet::new();
    let mut tasks = Vec::new();
    for note in task_notes {
        let context = &note.source_file;
        let frontmatter = &note.frontmatter;
        if first_string(frontmatter.get("type")) != "task" {
            bail!("{context}: type must be \"task\"");
        }
        if frontmatter.get("schema_version").and_then(Value::as_i64) != Some(1) {
            bail!("{context}: schema_version must be 1");
        }
        if !ids.insert(note.id.clone()) {
            bail!("{context}: duplicate task id \"{}\"", note.id);
        }
        let status = task_status(
            &required(frontmatter.get("status"), "status", context)?,
            context,
        )?;
        let target_date = first_string(frontmatter.get("due_date"));
        if !target_date.is_empty() {
            assert_date(&target_date, context)?;
        }
        let target_time = first_string(frontmatter.get("due_time"));
        if !target_time.is_empty() {
            assert_time(&target_time, "time", context)?;
            if target_date.is_empty() {
                bail!("{context}: time requires a date");
            }
        }
        let estimate_minutes = optional_positive_integer(
            frontmatter.get("estimate_minutes"),
            "estimate_minutes",
            context,
        )?;
        let created_at = optional_datetime(frontmatter.get("created"), "created", context)?;
        let completed_at =
            optional_datetime(frontmatter.get("completed_at"), "completed_at", context)?;
        if !completed_at.is_empty() && status != TaskStatus::Done {
            bail!("{context}: completed_at requires status \"done\"");
        }
        let sort_order =
            optional_nonnegative(frontmatter.get("sort_order"), "sort_order", context)?;
        let mut people = resolve_many(
            frontmatter.get("people"),
            person_notes,
            &people_lookup,
            context,
            "people",
        )?;
        let mut resolved_ids = people
            .iter()
            .map(|note| note.id.clone())
            .collect::<HashSet<_>>();
        for outgoing in &note.outgoing_note_ids {
            if let Some(person) = people_by_id
                .get(outgoing.as_str())
                .filter(|person| resolved_ids.insert(person.id.clone()))
            {
                people.push(person);
            }
        }
        let project = resolve_one(
            frontmatter.get("project"),
            project_notes,
            &projects_lookup,
            context,
            "project",
        )?;
        tasks.push(Task {
            id: note.id.clone(),
            note_id: note.id.clone(),
            route: note.route.clone(),
            title: note.title.clone(),
            description: nonempty(frontmatter.get("description"))
                .unwrap_or_else(|| note.excerpt.clone()),
            status,
            target_date,
            target_time,
            estimate_minutes,
            created_at,
            completed_at,
            sort_order,
            modified_at: note.modified_at.clone(),
            tags: note.tags.clone(),
            people: people.into_iter().map(task_person).collect(),
            project: project_reference(project),
            subtasks: parse_checklist(&note.content, &note.id),
        });
    }
    tasks.sort_by(compare_tasks);
    Ok(tasks)
}

fn task_person(person: &SourceNote) -> TaskPerson {
    TaskPerson {
        note_id: person.id.clone(),
        name: person.title.clone(),
        route: person.route.clone(),
        avatar_url: person.avatar_url.clone(),
    }
}

fn parse_checklist(content: &str, task_id: &str) -> Vec<TaskSubtask> {
    CHECKLIST
        .captures_iter(content)
        .enumerate()
        .map(|(index, capture)| TaskSubtask {
            id: format!("{task_id}:subtask-{}", index + 1),
            title: clean_inline_markdown(&capture[2]),
            completed: capture[1].eq_ignore_ascii_case("x"),
        })
        .collect()
}

fn compare_tasks(left: &Task, right: &Task) -> Ordering {
    let left_order = left.sort_order;
    let right_order = right.sort_order;
    match (left_order > 0.0, right_order > 0.0) {
        (true, true) => left_order
            .partial_cmp(&right_order)
            .unwrap_or(Ordering::Equal),
        (true, false) => Ordering::Less,
        (false, true) => Ordering::Greater,
        _ => Ordering::Equal,
    }
    .then_with(|| (left.status == TaskStatus::Done).cmp(&(right.status == TaskStatus::Done)))
    .then_with(|| optional_cmp(&left.target_date, &right.target_date))
    .then_with(|| optional_cmp(&left.target_time, &right.target_time))
    .then_with(|| left.title.cmp(&right.title))
}

fn task_status(value: &str, context: &str) -> Result<TaskStatus> {
    match value {
        "todo" => Ok(TaskStatus::Todo),
        "in_progress" => Ok(TaskStatus::InProgress),
        "blocked" => Ok(TaskStatus::Blocked),
        "done" => Ok(TaskStatus::Done),
        _ => bail!("{context}: invalid task status"),
    }
}

fn optional_cmp(left: &str, right: &str) -> Ordering {
    match (left.is_empty(), right.is_empty()) {
        (false, false) => left.cmp(right),
        (false, true) => Ordering::Less,
        (true, false) => Ordering::Greater,
        _ => Ordering::Equal,
    }
}
pub(crate) fn required(value: Option<&Value>, field: &str, context: &str) -> Result<String> {
    nonempty(value).ok_or_else(|| anyhow::anyhow!("{context}: {field} is required"))
}
pub(crate) fn nonempty(value: Option<&Value>) -> Option<String> {
    value
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
}
pub(crate) fn assert_date(value: &str, context: &str) -> Result<()> {
    NaiveDate::parse_from_str(value, "%Y-%m-%d")
        .map(|_| ())
        .map_err(|_| anyhow::anyhow!("{context}: date must be a valid YYYY-MM-DD calendar date"))
}
pub(crate) fn assert_time(value: &str, field: &str, context: &str) -> Result<()> {
    if Regex::new(r"^(?:[01]\d|2[0-3]):[0-5]\d$")
        .unwrap()
        .is_match(value)
    {
        Ok(())
    } else {
        bail!("{context}: {field} must use 24-hour HH:MM")
    }
}
pub(crate) fn time_minutes(value: &str) -> i32 {
    value[..2].parse::<i32>().unwrap_or(0) * 60 + value[3..].parse::<i32>().unwrap_or(0)
}
fn optional_datetime(value: Option<&Value>, field: &str, context: &str) -> Result<String> {
    let value = first_string(value);
    if value.is_empty() {
        return Ok(value);
    }
    if NaiveDate::parse_from_str(&value, "%Y-%m-%d").is_ok()
        || DateTime::parse_from_rfc3339(&value).is_ok()
    {
        Ok(value)
    } else {
        bail!("{context}: {field} must be a valid ISO date or date-time")
    }
}
fn optional_positive_integer(value: Option<&Value>, field: &str, context: &str) -> Result<i64> {
    match value {
        None | Some(Value::Null) => Ok(0),
        Some(Value::String(value)) if value.is_empty() => Ok(0),
        Some(value) => value
            .as_i64()
            .filter(|value| *value > 0)
            .ok_or_else(|| anyhow::anyhow!("{context}: {field} must be a positive integer")),
    }
}
fn optional_nonnegative(value: Option<&Value>, field: &str, context: &str) -> Result<f64> {
    match value {
        None | Some(Value::Null) => Ok(0.0),
        Some(Value::String(value)) if value.is_empty() => Ok(0.0),
        Some(value) => value
            .as_f64()
            .filter(|value| *value >= 0.0)
            .ok_or_else(|| anyhow::anyhow!("{context}: {field} must be a non-negative number")),
    }
}
