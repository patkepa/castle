use std::collections::HashMap;

use anyhow::{Result, bail};
use castle_contracts::{CalendarEvent, Project, ProjectStatus, Task, TaskPerson};
use serde_json::Value;

use crate::{
    model::SourceNote,
    normalization::first_string,
    references::{build_reference_lookup, resolve_many},
    tasks::{assert_date, nonempty, required},
};

pub(crate) fn build_projects(
    project_notes: &[&SourceNote],
    person_notes: &[&SourceNote],
) -> Result<Vec<Project>> {
    let people_lookup = build_reference_lookup(person_notes);
    let mut projects = Vec::new();
    for note in project_notes {
        let context = &note.source_file;
        let frontmatter = &note.frontmatter;
        if first_string(frontmatter.get("type")) != "project" {
            bail!("{context}: type must be \"project\"");
        }
        if frontmatter.get("schema_version").and_then(Value::as_i64) != Some(1) {
            bail!("{context}: schema_version must be 1");
        }
        let id = required(frontmatter.get("id"), "id", context)?;
        let status = project_status(
            &required(frontmatter.get("status"), "status", context)?,
            context,
        )?;
        let started_at = first_string(frontmatter.get("started"));
        if !started_at.is_empty() {
            assert_date(&started_at, context)?;
        }
        let completed_at = first_string(frontmatter.get("completed_at"));
        if !completed_at.is_empty()
            && !matches!(status, ProjectStatus::Completed | ProjectStatus::Archived)
        {
            bail!("{context}: completed_at requires status \"completed\" or \"archived\"");
        }
        let people = resolve_many(
            frontmatter.get("people"),
            person_notes,
            &people_lookup,
            context,
            "people",
        )?;
        projects.push(Project {
            id,
            note_id: note.id.clone(),
            route: note.route.clone(),
            title: note.title.clone(),
            description: nonempty(frontmatter.get("description"))
                .unwrap_or_else(|| note.excerpt.clone()),
            status,
            started_at,
            completed_at,
            modified_at: note.modified_at.clone(),
            tags: note.tags.clone(),
            people: people
                .into_iter()
                .map(|person| TaskPerson {
                    note_id: person.id.clone(),
                    name: person.title.clone(),
                    route: person.route.clone(),
                    avatar_url: person.avatar_url.clone(),
                })
                .collect(),
            task_ids: Vec::new(),
            event_ids: Vec::new(),
        });
    }
    projects.sort_by(|left, right| {
        left.status
            .rank()
            .cmp(&right.status.rank())
            .then_with(|| left.title.cmp(&right.title))
    });
    Ok(projects)
}

pub(crate) fn connect_activity(
    mut projects: Vec<Project>,
    tasks: &[Task],
    events: &[CalendarEvent],
) -> Vec<Project> {
    let mut tasks_by_project = HashMap::<String, Vec<String>>::new();
    let mut events_by_project = HashMap::<String, Vec<String>>::new();
    for task in tasks {
        if let Some(project) = &task.project {
            tasks_by_project
                .entry(project.id.clone())
                .or_default()
                .push(task.id.clone());
        }
    }
    for event in events {
        if let Some(project) = &event.project {
            events_by_project
                .entry(project.id.clone())
                .or_default()
                .push(event.id.clone());
        }
    }
    for project in &mut projects {
        project.task_ids = tasks_by_project.remove(&project.id).unwrap_or_default();
        project.event_ids = events_by_project.remove(&project.id).unwrap_or_default();
    }
    projects
}

fn project_status(value: &str, context: &str) -> Result<ProjectStatus> {
    match value {
        "idea" => Ok(ProjectStatus::Idea),
        "planned" => Ok(ProjectStatus::Planned),
        "active" => Ok(ProjectStatus::Active),
        "paused" => Ok(ProjectStatus::Paused),
        "completed" => Ok(ProjectStatus::Completed),
        "archived" => Ok(ProjectStatus::Archived),
        _ => bail!("{context}: invalid project status"),
    }
}
