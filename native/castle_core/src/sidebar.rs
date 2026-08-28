use std::sync::LazyLock;

use castle_contracts::{NoteSidebarFact, PersonContact, PersonContactKind, PersonNoteSidebar};
use regex::Regex;
use serde_json::Value;

use crate::{
    model::SourceNote,
    normalization::{clean_inline_markdown, first_string, humanize},
};

static HEADING: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^(#{1,2})\s+(.+?)\s*$").unwrap());
static GROUP: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^-\s+([^:]+):\s*(.*)$").unwrap());
static ITEM: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^\s+-\s+(.+?)\s*$").unwrap());
static MARKDOWN_LINK: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^\[([^\]]+)\]\(([^)]+)\)$").unwrap());
static DETAIL_SEPARATOR: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\s+[—–]\s+").unwrap());

const FACTS: [(&str, &str, bool); 12] = [
    ("nickname", "Also known as", true),
    ("birthday", "Born", true),
    ("location", "Location", true),
    ("alignment", "Relationship", false),
    ("relation", "Sentiment", false),
    ("known_from", "Known from", false),
    ("company", "Company", true),
    ("department", "Department", false),
    ("nationality", "Nationality", true),
    ("birthplace", "Birthplace", true),
    ("met_through", "Met through", true),
    ("status", "Status", false),
];

pub(crate) fn build_sidebar(note: &SourceNote) -> Option<PersonNoteSidebar> {
    if note.section != "people" {
        return None;
    }
    let mut facts = Vec::new();
    for (key, label, preserve) in FACTS {
        if key == "location" {
            facts.extend(location_facts(&note.frontmatter));
            continue;
        }
        let value = if key == "status" {
            if note.status.is_empty() {
                String::new()
            } else {
                humanize(&note.status)
            }
        } else {
            format_fact(note.frontmatter.get(key), preserve)
        };
        if !value.is_empty() {
            facts.push(NoteSidebarFact {
                label: label.to_owned(),
                value,
                href: None,
            });
        }
    }
    Some(PersonNoteSidebar {
        kind: "person".to_owned(),
        title: note.title.clone(),
        avatar_url: note.avatar_url.clone(),
        facts,
        contacts: contacts(&note.content),
    })
}

fn location_facts(frontmatter: &Value) -> Vec<NoteSidebarFact> {
    if let Some(locations) = frontmatter.get("locations").and_then(Value::as_array) {
        return locations
            .iter()
            .filter_map(|location| {
                let label = clean_inline_markdown(&first_string(location.get("label")));
                let address = clean_inline_markdown(&first_string(location.get("address")));
                if label.is_empty() || address.is_empty() {
                    return None;
                }
                let href = maps_url(&address);
                Some(NoteSidebarFact {
                    label,
                    value: if href.is_empty() {
                        humanize(&address)
                    } else {
                        address
                    },
                    href: (!href.is_empty()).then_some(href),
                })
            })
            .collect();
    }
    let value = clean_inline_markdown(&first_string(frontmatter.get("location")));
    if value.is_empty() {
        return Vec::new();
    }
    let href = maps_url(&value);
    vec![NoteSidebarFact {
        label: "Location".to_owned(),
        value: if href.is_empty() {
            humanize(&value)
        } else {
            value
        },
        href: (!href.is_empty()).then_some(href),
    }]
}

fn format_fact(value: Option<&Value>, preserve: bool) -> String {
    let values = match value {
        Some(Value::Array(values)) => values.iter().collect(),
        Some(value) => vec![value],
        None => Vec::new(),
    };
    values
        .into_iter()
        .filter_map(|value| {
            let value = first_string(Some(value));
            if value.is_empty() {
                return None;
            }
            if preserve {
                Some(clean_inline_markdown(&value))
            } else {
                Some(clean_inline_markdown(&humanize(
                    value.rsplit('/').next().unwrap_or(&value),
                )))
            }
        })
        .collect::<Vec<_>>()
        .join(", ")
}

fn contacts(content: &str) -> Vec<PersonContact> {
    let mut contacts = Vec::new();
    let mut inside = false;
    let mut group = String::new();
    for line in content.split('\n').map(|line| line.trim_end_matches('\r')) {
        if let Some(capture) = HEADING.captures(line) {
            if inside {
                break;
            }
            inside = &capture[1] == "##" && capture[2].trim() == "Contact";
            continue;
        }
        if !inside {
            continue;
        }
        if let Some(capture) = GROUP.captures(line) {
            group = clean_inline_markdown(&capture[1]);
            if !capture[2].trim().is_empty() {
                contacts.push(contact(&group, &capture[2]));
            }
            continue;
        }
        if !group.is_empty()
            && let Some(capture) = ITEM.captures(line)
        {
            contacts.push(contact(&group, &capture[1]));
        }
    }
    contacts
        .into_iter()
        .filter(|value| !value.value.is_empty())
        .collect()
}

fn contact(label: &str, raw: &str) -> PersonContact {
    let mut parts = DETAIL_SEPARATOR.splitn(raw, 2);
    let value_part = parts.next().unwrap_or("");
    let detail = clean_inline_markdown(parts.next().unwrap_or(""));
    let markdown = MARKDOWN_LINK.captures(value_part);
    let value = clean_inline_markdown(
        markdown
            .as_ref()
            .map(|value| &value[1])
            .unwrap_or(value_part),
    );
    let explicit = markdown.as_ref().map(|value| value[2].to_owned());
    let kind = contact_kind(label);
    PersonContact {
        kind,
        label: humanize(label),
        href: contact_href(kind, &value, explicit.as_deref()),
        value,
        detail,
    }
}

fn contact_kind(label: &str) -> PersonContactKind {
    match label.trim().to_lowercase().as_str() {
        "phone" => PersonContactKind::Phone,
        "email" => PersonContactKind::Email,
        "address" | "city" => PersonContactKind::Address,
        "website" => PersonContactKind::Website,
        "social" => PersonContactKind::Social,
        _ => PersonContactKind::Other,
    }
}
fn contact_href(kind: PersonContactKind, value: &str, explicit: Option<&str>) -> String {
    if let Some(value) = explicit {
        return value.to_owned();
    }
    match kind {
        PersonContactKind::Phone => {
            let mut phone = String::new();
            for (index, character) in value.chars().enumerate() {
                if character.is_ascii_digit() || (index == 0 && character == '+') {
                    phone.push(character);
                }
            }
            if phone.is_empty() {
                phone
            } else {
                format!("tel:{phone}")
            }
        }
        PersonContactKind::Email => format!("mailto:{value}"),
        PersonContactKind::Address => maps_url(value),
        PersonContactKind::Website | PersonContactKind::Social
            if value.starts_with("http://") || value.starts_with("https://") =>
        {
            value.to_owned()
        }
        _ => String::new(),
    }
}

pub(crate) fn maps_url(value: &str) -> String {
    let value = clean_inline_markdown(value);
    if value.is_empty() || value.eq_ignore_ascii_case("unknown") {
        return String::new();
    }
    format!(
        "https://www.google.com/maps/search/?api=1&query={}",
        encode_component(&value)
    )
}
fn encode_component(value: &str) -> String {
    let mut result = String::new();
    for byte in value.bytes() {
        if byte.is_ascii_alphanumeric() || b"-_.!~*'()".contains(&byte) {
            result.push(byte as char);
        } else {
            result.push_str(&format!("%{byte:02X}"));
        }
    }
    result
}
