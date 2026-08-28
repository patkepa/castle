use std::collections::HashSet;

use anyhow::{Result, bail};
use castle_contracts::{
    CalendarEvent, CalendarEventKind, CalendarEventPerson, CalendarEventRecurrence,
};
use chrono::{Duration, NaiveDate};
use serde_json::Value;

use crate::{
    model::SourceNote,
    normalization::{clean_inline_markdown, first_string},
    references::{build_reference_lookup, project_reference, resolve_many, resolve_one},
    tasks::{assert_date, assert_time, required, time_minutes},
};

pub(crate) fn build_calendar_events(
    event_notes: &[&SourceNote],
    person_notes: &[&SourceNote],
    project_notes: &[&SourceNote],
) -> Result<Vec<CalendarEvent>> {
    let people_lookup = build_reference_lookup(person_notes);
    let projects_lookup = build_reference_lookup(project_notes);
    let mut ids = HashSet::new();
    let mut events = Vec::new();
    for note in event_notes {
        let context = &note.source_file;
        let frontmatter = &note.frontmatter;
        let declared_type = first_string(frontmatter.get("type"));
        if !declared_type.is_empty() && declared_type != "calendar_event" {
            bail!("{context}: type must be \"calendar_event\"");
        }
        if frontmatter.get("schema_version").is_some()
            && frontmatter.get("schema_version").and_then(Value::as_i64) != Some(1)
        {
            bail!("{context}: schema_version must be 1");
        }
        let id = first_string(frontmatter.get("id"));
        let id = if id.is_empty() {
            note.source_file.trim_end_matches(".md").to_owned()
        } else {
            id
        };
        if !ids.insert(id.clone()) {
            bail!("{context}: duplicate calendar event id \"{id}\"");
        }
        let title = [
            first_string(frontmatter.get("title")),
            note.title.clone(),
            first_markdown_heading(&note.content),
        ]
        .into_iter()
        .find(|value| !value.is_empty())
        .ok_or_else(|| anyhow::anyhow!("{context}: add a title or a level-one Markdown heading"))?;
        let date = required(frontmatter.get("date"), "date", context)?;
        assert_date(&date, context)?;
        let start_time = required(frontmatter.get("start"), "start", context)?;
        assert_time(&start_time, "start", context)?;
        let end_time = first_string(frontmatter.get("end"));
        let mut end_date = first_string(frontmatter.get("end_date"));
        if !end_date.is_empty() {
            assert_date(&end_date, &format!("{context}: end_date"))?;
            if end_time.is_empty() {
                bail!("{context}: end_date requires end");
            }
            if end_date < date {
                bail!("{context}: end_date must not be before date");
            }
        }
        if !end_time.is_empty() {
            assert_time(&end_time, "end", context)?;
            if end_date == date && time_minutes(&end_time) <= time_minutes(&start_time) {
                bail!("{context}: end must be later than start when end_date is the same day");
            }
            if end_date.is_empty() && time_minutes(&end_time) == time_minutes(&start_time) {
                bail!("{context}: end must differ from start");
            }
            if end_date.is_empty() && time_minutes(&end_time) < time_minutes(&start_time) {
                end_date = (NaiveDate::parse_from_str(&date, "%Y-%m-%d")? + Duration::days(1))
                    .format("%Y-%m-%d")
                    .to_string();
            }
        }
        if end_date == date {
            end_date.clear();
        }
        let recurrence = match first_string(frontmatter.get("recurrence")).as_str() {
            "" => None,
            "weekly" => Some(CalendarEventRecurrence::Weekly),
            _ => bail!("{context}: recurrence must be weekly"),
        };
        let repeat_until = first_string(frontmatter.get("repeat_until"));
        if !repeat_until.is_empty() {
            if recurrence.is_none() {
                bail!("{context}: repeat_until requires recurrence");
            }
            assert_date(&repeat_until, &format!("{context}: repeat_until"))?;
            if repeat_until < date {
                bail!("{context}: repeat_until must not be before date");
            }
        }
        let kind = match required(frontmatter.get("kind"), "kind", context)?.as_str() {
            "work" => CalendarEventKind::Work,
            "social" => CalendarEventKind::Social,
            _ => bail!("{context}: kind must be one of work, social"),
        };
        let people = resolve_many(
            frontmatter.get("people"),
            person_notes,
            &people_lookup,
            context,
            "people",
        )?;
        let project = resolve_one(
            frontmatter.get("project"),
            project_notes,
            &projects_lookup,
            context,
            "project",
        )?;
        let description = first_string(frontmatter.get("description"));
        let description = if description.is_empty() {
            markdown_description(&note.content)
        } else {
            description
        };
        events.push(CalendarEvent {
            id,
            note_id: note.id.clone(),
            route: note.route.clone(),
            date,
            start_time,
            end_time: (!end_time.is_empty()).then_some(end_time),
            end_date: (!end_date.is_empty()).then_some(end_date),
            recurrence,
            repeat_until: (!repeat_until.is_empty()).then_some(repeat_until),
            title,
            description,
            kind,
            people: people
                .into_iter()
                .map(|person| CalendarEventPerson {
                    note_id: person.id.clone(),
                    name: person.title.clone(),
                    route: person.route.clone(),
                })
                .collect(),
            project: project_reference(project),
        });
    }
    events.sort_by(|left, right| {
        left.date
            .cmp(&right.date)
            .then_with(|| left.start_time.cmp(&right.start_time))
            .then_with(|| left.title.cmp(&right.title))
    });
    Ok(events)
}

fn first_markdown_heading(content: &str) -> String {
    content
        .split('\n')
        .map(|line| line.trim_end_matches('\r'))
        .find_map(|line| line.strip_prefix("# ").map(clean_inline_markdown))
        .unwrap_or_default()
}
fn markdown_description(content: &str) -> String {
    let mut lines = content
        .trim()
        .split('\n')
        .map(|line| line.trim_end_matches('\r'))
        .collect::<Vec<_>>();
    if let Some(index) = lines.iter().position(|line| !line.trim().is_empty())
        && lines[index].trim().starts_with("# ")
    {
        lines.remove(index);
    }
    lines.join("\n").trim().to_owned()
}
