use std::{
    cmp::Ordering,
    collections::{HashMap, HashSet},
    sync::LazyLock,
};

use anyhow::{Result, bail};
use regex::Regex;
use serde_json::{Value, json};

use crate::{
    model::SourceNote,
    normalization::{
        clean_inline_markdown, first_string, github_slug, humanize, locale_compare, normalize_list,
        normalize_lookup,
    },
    sidebar::maps_url,
};

const PALETTE: [&str; 11] = [
    "#5b9cf6", "#a78bfa", "#fb7185", "#f97316", "#2dd4bf", "#facc15", "#38bdf8", "#c084fc",
    "#4ade80", "#f472b6", "#94a3b8",
];
const RELATIONS: [(&str, &str, &str); 5] = [
    ("positive", "Positive", "#22c55e"),
    ("neutral", "Neutral", "#38bdf8"),
    ("flirty", "Flirty", "#f472b6"),
    ("mixed", "Mixed", "#f59e0b"),
    ("negative", "Negative", "#ef4444"),
];
static WIKI_TARGET: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\[\[([^\]|#]+)").unwrap());
static MARKDOWN_TARGET: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\[[^\]]+\]\(([^)#]+)(?:#[^)]+)?\)").unwrap());

#[derive(Debug, Clone)]
struct Person {
    id: String,
    note_id: String,
    source_file: String,
    label: String,
    relation: String,
    relation_label: String,
    relation_color: String,
    alignments: Vec<String>,
    alignment_label: String,
    known_from: Vec<String>,
    known_from_label: String,
    company: String,
    departments: Vec<String>,
    department_label: String,
    location: String,
    locations: Vec<Value>,
    maps_url: String,
    latitude: Option<f64>,
    longitude: Option<f64>,
    relation_to: Vec<PersonRelationLink>,
    status: String,
    tags: Vec<String>,
    href: String,
    avatar_url: String,
    content: String,
    memberships: Vec<Membership>,
    category_ids: Vec<String>,
    category_id: String,
    category_label: String,
}
#[derive(Debug, Clone)]
struct Membership {
    path: String,
    path_label: String,
    category_id: String,
    category_path: String,
    category_label: String,
    subgroup_id: String,
    subgroup_label: String,
    department_id: String,
    department_label: String,
}
#[derive(Debug, Clone)]
struct Category {
    id: String,
    label: String,
    path: String,
    people_ids: HashSet<String>,
    color: String,
    companies: Vec<Company>,
    direct_people: Vec<usize>,
}
#[derive(Debug, Clone)]
struct Company {
    id: String,
    label: String,
    people_ids: HashSet<String>,
    people: Vec<usize>,
    direct_people: Vec<usize>,
    departments: Vec<Department>,
}
#[derive(Debug, Clone)]
struct Department {
    id: String,
    label: String,
    people_ids: HashSet<String>,
    people: Vec<usize>,
}
#[derive(Debug, Clone)]
struct ExplicitRelation {
    source: String,
    target: String,
    relation: String,
    label: String,
    color: String,
    relationship: String,
}

#[derive(Debug, Clone)]
struct PersonRelationLink {
    person: String,
    relation: String,
    relationship: String,
}

pub(crate) fn build_relationship_graph(
    relationship_notes: &[&SourceNote],
    owner: Option<&SourceNote>,
    owner_display_name: &str,
    owner_avatar_url: &str,
) -> Result<Value> {
    let mut people = relationship_notes
        .iter()
        .map(|note| person(note))
        .collect::<Result<Vec<_>>>()?;
    let aliases = aliases(&people);
    let explicit = explicit_relations(&people, &aliases)?;
    let relation_view = build_view(
        &mut people.clone(),
        owner,
        owner_display_name,
        owner_avatar_url,
        "relation",
        &explicit,
    )?;
    let known_view = build_view(
        &mut people,
        owner,
        owner_display_name,
        owner_avatar_url,
        "known_from",
        &explicit,
    )?;
    let mut alignment_ids = Vec::new();
    for person in &people {
        for alignment in &person.alignments {
            if !alignment_ids.contains(alignment) {
                alignment_ids.push(alignment.clone());
            }
        }
    }
    alignment_ids.sort_by(|left, right| locale_compare(&humanize(left), &humanize(right)));
    let alignments = alignment_ids.into_iter().map(|alignment| { let count = people.iter().filter(|person| person.alignments.contains(&alignment)).count(); json!({ "id": alignment, "label": humanize(&alignment), "count": count, "color": alignment_color(&alignment) }) }).collect::<Vec<_>>();
    let relations = RELATIONS.iter().map(|(id, label, color)| json!({ "id": id, "label": label, "color": color, "count": people.iter().filter(|person| person.relation == *id).count() })).collect::<Vec<_>>();
    let mut root = known_view.as_object().cloned().unwrap_or_default();
    root.insert("peopleCount".to_owned(), json!(people.len()));
    root.insert("personRelationCount".to_owned(), json!(explicit.len()));
    root.insert("relations".to_owned(), Value::Array(relations));
    root.insert("alignments".to_owned(), Value::Array(alignments));
    root.insert(
        "views".to_owned(),
        json!({ "relation": relation_view, "known_from": known_view }),
    );
    Ok(Value::Object(root))
}

fn person(note: &SourceNote) -> Result<Person> {
    let f = &note.frontmatter;
    let relation = normalize_relation(f.get("relation"), f.get("tags"));
    let definition = relation_definition(&relation);
    let alignments = unique_list(f.get("alignment"), &["unknown"]);
    let known_from = unique_list(f.get("known_from"), &["unknown"])
        .into_iter()
        .map(|value| {
            value
                .split('/')
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .collect::<Vec<_>>()
                .join("/")
        })
        .collect::<Vec<_>>();
    let company = first_string(f.get("company"));
    let departments = unique_list(f.get("department"), &[]);
    let locations = person_locations(f, &note.id);
    let primary = locations
        .iter()
        .find(|value| value["primary"] == true)
        .or_else(|| locations.first());
    let legacy = clean_inline_markdown(&first_string(f.get("location")));
    let location = primary
        .and_then(|value| value["address"].as_str())
        .unwrap_or(&legacy)
        .to_owned();
    let map = primary
        .and_then(|value| value["mapsUrl"].as_str())
        .map(str::to_owned)
        .unwrap_or_else(|| maps_url(&location));
    let (latitude, longitude) = primary
        .and_then(coordinates)
        .or_else(|| coordinates(f.get("coordinates")?))
        .unwrap_or((f64::NAN, f64::NAN));
    Ok(Person {
        id: format!("person:{}", note.id),
        note_id: note.id.clone(),
        source_file: note.source_file.clone(),
        label: note.title.clone(),
        relation: relation.clone(),
        relation_label: definition.1.to_owned(),
        relation_color: definition.2.to_owned(),
        alignments: alignments.clone(),
        alignment_label: alignments
            .iter()
            .map(|value| humanize(value))
            .collect::<Vec<_>>()
            .join(", "),
        known_from: known_from.clone(),
        known_from_label: known_from
            .iter()
            .map(|value| humanize_path(value))
            .collect::<Vec<_>>()
            .join(", "),
        company,
        departments: departments.clone(),
        department_label: departments
            .iter()
            .map(|value| humanize_path(value))
            .collect::<Vec<_>>()
            .join(", "),
        location: if map.is_empty() {
            humanize(if location.is_empty() {
                "unknown"
            } else {
                &location
            })
        } else {
            location
        },
        locations,
        maps_url: map,
        latitude: latitude.is_finite().then_some(latitude),
        longitude: longitude.is_finite().then_some(longitude),
        relation_to: relation_to(f.get("relation_to"))?,
        status: note.status.clone(),
        tags: normalize_tags(f.get("tags")),
        href: note.route.clone(),
        avatar_url: note.avatar_url.clone(),
        content: note.content.clone(),
        memberships: Vec::new(),
        category_ids: Vec::new(),
        category_id: String::new(),
        category_label: String::new(),
    })
}

fn person_locations(frontmatter: &Value, note_id: &str) -> Vec<Value> {
    frontmatter
        .get("locations")
        .and_then(Value::as_array)
        .map(|values| {
            values
                .iter()
                .enumerate()
                .filter_map(|(index, value)| {
                    let address = clean_inline_markdown(&first_string(value.get("address")));
                    let map = maps_url(&address);
                    if map.is_empty() {
                        return None;
                    }
                    let coords = value.get("coordinates").and_then(coordinates);
                    let label = clean_inline_markdown(&first_string(value.get("label")));
                    let label = if label.is_empty() {
                        "Location".to_owned()
                    } else {
                        label
                    };
                    let mut location = json!({
                        "id": format!("{note_id}:location:{index}"),
                        "label": label,
                        "address": address,
                        "primary": value.get("primary").and_then(Value::as_bool).unwrap_or(false),
                        "mapsUrl": map,
                    });
                    if let Some((lat, lng)) = coords {
                        location["latitude"] = json!(lat);
                        location["longitude"] = json!(lng);
                    }
                    Some(location)
                })
                .collect()
        })
        .unwrap_or_default()
}
fn coordinates(value: &Value) -> Option<(f64, f64)> {
    let lat = value.get("latitude")?.as_f64()?;
    let lng = value.get("longitude")?.as_f64()?;
    ((-90.0..=90.0).contains(&lat) && (-180.0..=180.0).contains(&lng)).then_some((lat, lng))
}

fn build_view(
    people: &mut [Person],
    owner: Option<&SourceNote>,
    owner_display_name: &str,
    owner_avatar_url: &str,
    mode: &str,
    explicit: &[ExplicitRelation],
) -> Result<Value> {
    for person in people.iter_mut() {
        let paths = if mode == "relation" {
            vec![person.relation.clone()]
        } else {
            known_paths(person)
        };
        person.memberships = memberships(&paths);
        person.category_ids = person
            .memberships
            .iter()
            .map(|value| value.category_id.clone())
            .collect();
        person.category_id = person.category_ids.first().cloned().unwrap_or_default();
        person.category_label = person
            .memberships
            .iter()
            .map(|value| value.path_label.clone())
            .collect::<Vec<_>>()
            .join(", ");
    }
    let mut categories = Vec::<Category>::new();
    for (person_index, person) in people.iter().enumerate() {
        for (membership_index, membership) in person.memberships.iter().enumerate() {
            let category_index = match categories
                .iter()
                .position(|value| value.id == membership.category_id)
            {
                Some(index) => index,
                None => {
                    let color = if mode == "relation" {
                        relation_definition(&membership.category_id).2.to_owned()
                    } else {
                        PALETTE[categories.len() % PALETTE.len()].to_owned()
                    };
                    categories.push(Category {
                        id: membership.category_id.clone(),
                        label: membership.category_label.clone(),
                        path: membership.category_path.clone(),
                        people_ids: HashSet::new(),
                        color,
                        companies: Vec::new(),
                        direct_people: Vec::new(),
                    });
                    categories.len() - 1
                }
            };
            let category = &mut categories[category_index];
            category.people_ids.insert(person.id.clone());
            if membership.subgroup_id.is_empty() {
                if membership_index == 0 {
                    category.direct_people.push(person_index);
                }
                continue;
            }
            let company_index = match category
                .companies
                .iter()
                .position(|value| value.id == membership.subgroup_id)
            {
                Some(index) => index,
                None => {
                    category.companies.push(Company {
                        id: membership.subgroup_id.clone(),
                        label: membership.subgroup_label.clone(),
                        people_ids: HashSet::new(),
                        people: Vec::new(),
                        direct_people: Vec::new(),
                        departments: Vec::new(),
                    });
                    category.companies.len() - 1
                }
            };
            let company = &mut category.companies[company_index];
            company.people_ids.insert(person.id.clone());
            if !membership.department_id.is_empty() {
                let department_index = match company
                    .departments
                    .iter()
                    .position(|value| value.id == membership.department_id)
                {
                    Some(index) => index,
                    None => {
                        company.departments.push(Department {
                            id: membership.department_id.clone(),
                            label: membership.department_label.clone(),
                            people_ids: HashSet::new(),
                            people: Vec::new(),
                        });
                        company.departments.len() - 1
                    }
                };
                let department = &mut company.departments[department_index];
                department.people_ids.insert(person.id.clone());
                if membership_index == 0 {
                    company.people.push(person_index);
                    department.people.push(person_index);
                }
            } else if membership_index == 0 {
                company.people.push(person_index);
                company.direct_people.push(person_index);
            }
        }
    }
    for category in &mut categories {
        category
            .companies
            .sort_by(|left, right| locale_compare(&left.label, &right.label));
        for company in &mut category.companies {
            company
                .departments
                .sort_by(|left, right| locale_compare(&left.label, &right.label));
        }
    }
    categories.sort_by(|left, right| category_cmp(mode, left, right));
    let dimensions = (1600.0, 1000.0, 800.0, 500.0);
    let nodes = layout_nodes(
        &categories,
        people,
        owner,
        owner_display_name,
        owner_avatar_url,
        dimensions,
    );
    let mut edges = Vec::<Value>::new();
    let mut seen = HashSet::new();
    for category in &categories {
        add_edge(
            &mut edges,
            &mut seen,
            json!({ "id": format!("edge:root:{}", category.id), "type": "category", "source": "root:owner", "target": format!("category:{}", category.id) }),
        );
        for company in &category.companies {
            add_edge(
                &mut edges,
                &mut seen,
                json!({ "id": format!("edge:category:{}", company.id), "type":"company", "source":format!("category:{}",category.id), "target":format!("company:{}",company.id) }),
            );
            for department in &company.departments {
                add_edge(
                    &mut edges,
                    &mut seen,
                    json!({ "id":format!("edge:company:{}",department.id), "type":"department", "source":format!("company:{}",company.id), "target":format!("department:{}",department.id) }),
                );
            }
        }
    }
    for person in people.iter() {
        for member in &person.memberships {
            let source = if !member.department_id.is_empty() {
                format!("department:{}", member.department_id)
            } else if !member.subgroup_id.is_empty() {
                format!("company:{}", member.subgroup_id)
            } else {
                format!("category:{}", member.category_id)
            };
            add_edge(
                &mut edges,
                &mut seen,
                json!({ "id":format!("edge:group:{}:{}",member.path,person.id), "type":"person", "source":source, "target":person.id }),
            );
        }
    }
    for relation in explicit {
        add_edge(
            &mut edges,
            &mut seen,
            json!({ "id":format!("edge:person-relation:{}:{}",relation.source,relation.target), "type":"person-relation", "source":relation.source, "target":relation.target, "relation":relation.relation, "relationLabel":relation.label, "relationship":relation.relationship, "color":relation.color }),
        );
    }
    let connected = explicit
        .iter()
        .map(|value| pair(&value.source, &value.target))
        .collect::<HashSet<_>>();
    inferred_links(people, &mut edges, &mut seen, &connected);
    add_paths(&mut edges, &nodes, dimensions);
    let categories_json = categories.iter().map(|category| json!({ "id":category.id, "label":category.label, "path":category.path, "count":category.people_ids.len(), "color":category.color })).collect::<Vec<_>>();
    let note_links = edges
        .iter()
        .filter(|edge| edge["type"] == "note-link")
        .count();
    Ok(
        json!({ "width": dimensions.0 as i64, "height":dimensions.1 as i64, "centerX":dimensions.2 as i64, "centerY":dimensions.3 as i64, "mode":mode, "noteLinkCount":note_links, "categories":categories_json, "nodes":nodes, "edges":edges }),
    )
}

fn memberships(values: &[String]) -> Vec<Membership> {
    let fallback = ["unknown".to_owned()];
    let values = if values.is_empty() {
        &fallback[..]
    } else {
        values
    };
    let mut result = Vec::new();
    let mut seen = HashSet::new();
    for value in values {
        let mut segments = value
            .split('/')
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .collect::<Vec<_>>();
        if segments.is_empty() {
            segments.push("unknown");
        }
        let category_path = segments[0];
        let category_id = {
            let value = github_slug(category_path);
            if value.is_empty() {
                "unknown".to_owned()
            } else {
                value
            }
        };
        let subgroup = segments.get(1).copied().unwrap_or("");
        let subgroup_id = if subgroup.is_empty() {
            String::new()
        } else {
            format!("{}:{}", category_id, github_slug(subgroup))
        };
        let department_path = segments
            .iter()
            .skip(2)
            .copied()
            .collect::<Vec<_>>()
            .join(" / ");
        let department_id = if department_path.is_empty() {
            String::new()
        } else {
            format!("{}:{}", subgroup_id, github_slug(&department_path))
        };
        let key = format!("{category_id}:{subgroup_id}:{department_id}");
        if !seen.insert(key) {
            continue;
        }
        result.push(Membership {
            path: segments.join("/"),
            path_label: segments
                .iter()
                .map(|value| humanize(value))
                .collect::<Vec<_>>()
                .join(" / "),
            category_id,
            category_path: category_path.to_owned(),
            category_label: humanize(category_path),
            subgroup_id,
            subgroup_label: humanize(subgroup),
            department_id,
            department_label: segments
                .iter()
                .skip(2)
                .map(|value| humanize(value))
                .collect::<Vec<_>>()
                .join(" / "),
        });
    }
    result
}
fn known_paths(person: &Person) -> Vec<String> {
    if person.departments.is_empty() {
        return person.known_from.clone();
    }
    let company_id = github_slug(&person.company);
    let grouped = person
        .known_from
        .iter()
        .filter(|value| value.split('/').filter(|value| !value.is_empty()).count() > 1)
        .collect::<Vec<_>>();
    person
        .known_from
        .iter()
        .flat_map(|value| {
            let segments = value.split('/').map(str::trim).collect::<Vec<_>>();
            let belongs = if !company_id.is_empty() {
                github_slug(segments.get(1).copied().unwrap_or("")) == company_id
            } else {
                grouped.len() == 1 && grouped[0] == value
            };
            if belongs {
                person
                    .departments
                    .iter()
                    .map(|department| format!("{value}/{department}"))
                    .collect()
            } else {
                vec![value.clone()]
            }
        })
        .collect()
}
fn category_cmp(mode: &str, left: &Category, right: &Category) -> Ordering {
    if mode == "relation" {
        let li = RELATIONS
            .iter()
            .position(|value| value.0 == left.id)
            .unwrap_or(99);
        let ri = RELATIONS
            .iter()
            .position(|value| value.0 == right.id)
            .unwrap_or(99);
        if li != ri {
            return li.cmp(&ri);
        }
    }
    if left.id == "unknown" {
        return Ordering::Greater;
    }
    if right.id == "unknown" {
        return Ordering::Less;
    }
    locale_compare(&left.label, &right.label)
}

fn layout_nodes(
    categories: &[Category],
    people: &[Person],
    owner: Option<&SourceNote>,
    owner_display_name: &str,
    owner_avatar_url: &str,
    d: (f64, f64, f64, f64),
) -> Vec<Value> {
    let mut nodes = vec![generic_node(
        "root:owner",
        "root",
        owner
            .map(|value| value.title.as_str())
            .unwrap_or(owner_display_name),
        "",
        "",
        "#5b9cf6",
        24.0,
        d.2,
        d.3,
        0.0,
        56.0,
        "middle",
        owner.map(|value| value.route.as_str()).unwrap_or(""),
        owner
            .map(|value| value.avatar_url.as_str())
            .filter(|value| !value.is_empty())
            .unwrap_or(owner_avatar_url),
    )];
    let total: usize = categories
        .iter()
        .map(|value| value.people_ids.len() + value.companies.len() + 1)
        .sum();
    let mut cursor = -std::f64::consts::PI / 2.0;
    for category in categories {
        let segment = ((category.people_ids.len() + category.companies.len() + 1) as f64
            / total as f64)
            * std::f64::consts::PI
            * 2.0;
        let midpoint = cursor + segment / 2.0;
        nodes.push(generic_node(
            &format!("category:{}", category.id),
            "category",
            &category.label,
            &category.id,
            &category.label,
            &category.color,
            22.0,
            round(d.2 + midpoint.cos() * 250.0),
            round(d.3 + midpoint.sin() * 250.0),
            0.0,
            42.0,
            "middle",
            "",
            "",
        ));
        enum Branch<'a> {
            Company(&'a Company),
            Person(usize),
        }
        let branches = category
            .companies
            .iter()
            .map(Branch::Company)
            .chain(category.direct_people.iter().copied().map(Branch::Person))
            .collect::<Vec<_>>();
        let weight: usize = branches
            .iter()
            .map(|branch| match branch {
                Branch::Company(value) => usize::max(1, value.people.len()),
                Branch::Person(_) => 1,
            })
            .sum();
        let spread = f64::max(0.14, segment - 0.16);
        let mut branch_cursor = midpoint - spread / 2.0;
        for branch in branches {
            let branch_weight = match branch {
                Branch::Company(value) => usize::max(1, value.people.len()),
                Branch::Person(_) => 1,
            };
            let branch_segment = branch_weight as f64 / weight as f64 * spread;
            let angle = branch_cursor + branch_segment / 2.0;
            match branch {
                Branch::Person(index) => {
                    nodes.push(person_node(&people[index], &category.color, angle, 0, d))
                }
                Branch::Company(company) => {
                    nodes.push(generic_node(
                        &format!("company:{}", company.id),
                        "company",
                        &company.label,
                        &category.id,
                        &category.label,
                        &category.color,
                        16.0,
                        round(d.2 + angle.cos() * 455.0),
                        round(d.3 + angle.sin() * 455.0 * 0.76),
                        0.0,
                        34.0,
                        "middle",
                        "",
                        "",
                    ));
                    if company.departments.is_empty() {
                        let person_spread = f64::min(branch_segment, 1.16);
                        let start = angle - person_spread / 2.0;
                        for (index, person) in company.people.iter().enumerate() {
                            let a = if company.people.len() == 1 {
                                angle
                            } else {
                                start
                                    + person_spread
                                        * (index as f64 / (company.people.len() - 1) as f64)
                            };
                            nodes.push(person_node(&people[*person], &category.color, a, index, d));
                        }
                    } else {
                        enum Child<'a> {
                            Department(&'a Department),
                            Person(usize),
                        }
                        let children = company
                            .departments
                            .iter()
                            .map(Child::Department)
                            .chain(company.direct_people.iter().copied().map(Child::Person))
                            .collect::<Vec<_>>();
                        let child_weight: usize = children
                            .iter()
                            .map(|child| match child {
                                Child::Department(value) => usize::max(1, value.people.len()),
                                Child::Person(_) => 1,
                            })
                            .sum();
                        let child_spread = f64::min(branch_segment, 1.16);
                        let mut child_cursor = angle - child_spread / 2.0;
                        for child in children {
                            let w = match child {
                                Child::Department(value) => usize::max(1, value.people.len()),
                                Child::Person(_) => 1,
                            };
                            let child_segment = w as f64 / child_weight as f64 * child_spread;
                            let child_angle = child_cursor + child_segment / 2.0;
                            match child {
                                Child::Person(index) => nodes.push(person_node(
                                    &people[index],
                                    &category.color,
                                    child_angle,
                                    0,
                                    d,
                                )),
                                Child::Department(department) => {
                                    nodes.push(generic_node(
                                        &format!("department:{}", department.id),
                                        "department",
                                        &department.label,
                                        &category.id,
                                        &category.label,
                                        &category.color,
                                        13.0,
                                        round(d.2 + child_angle.cos() * 570.0),
                                        round(d.3 + child_angle.sin() * 570.0 * 0.76),
                                        0.0,
                                        30.0,
                                        "middle",
                                        "",
                                        "",
                                    ));
                                    let ps = f64::min(child_segment, 0.52);
                                    let start = child_angle - ps / 2.0;
                                    for (index, person) in department.people.iter().enumerate() {
                                        let a = if department.people.len() == 1 {
                                            child_angle
                                        } else {
                                            start
                                                + ps * (index as f64
                                                    / (department.people.len() - 1) as f64)
                                        };
                                        nodes.push(person_node(
                                            &people[*person],
                                            &category.color,
                                            a,
                                            index + 1,
                                            d,
                                        ));
                                    }
                                }
                            }
                            child_cursor += child_segment;
                        }
                    }
                }
            }
            branch_cursor += branch_segment;
        }
        cursor += segment;
    }
    nodes
}

#[allow(clippy::too_many_arguments)]
fn generic_node(
    id: &str,
    node_type: &str,
    label: &str,
    category_id: &str,
    category_label: &str,
    color: &str,
    radius: f64,
    x: f64,
    y: f64,
    label_x: f64,
    label_y: f64,
    anchor: &str,
    href: &str,
    avatar: &str,
) -> Value {
    json!({"id":id,"type":node_type,"label":label,"categoryId":category_id,"categoryIds":if category_id.is_empty(){Vec::<String>::new()}else{vec![category_id.to_owned()]},"categoryLabel":category_label,"relation":"","relationLabel":"","relationColor":"","alignments":[],"alignmentLabel":"","knownFrom":[],"knownFromLabel":"","status":"","tags":[],"href":href,"avatarUrl":avatar,"color":color,"radius":radius,"x":x,"y":y,"labelX":label_x,"labelY":label_y,"textAnchor":anchor})
}
fn person_node(
    person: &Person,
    color: &str,
    angle: f64,
    index: usize,
    d: (f64, f64, f64, f64),
) -> Value {
    let ring = [620.0, 700.0, 780.0][index % 3];
    let x = round(d.2 + angle.cos() * ring);
    let y = round(d.3 + angle.sin() * ring * 0.76);
    let right = angle.cos() >= 0.0;
    let mut value = json!({"id":person.id,"noteId":person.note_id,"sourceFile":person.source_file,"label":person.label,"relation":person.relation,"relationLabel":person.relation_label,"relationColor":person.relation_color,"alignments":person.alignments,"alignmentLabel":person.alignment_label,"knownFrom":person.known_from,"knownFromLabel":person.known_from_label,"company":person.company,"departments":person.departments,"departmentLabel":person.department_label,"location":person.location,"locations":person.locations,"mapsUrl":person.maps_url,"status":person.status,"tags":person.tags,"href":person.href,"avatarUrl":person.avatar_url,"content":person.content,"categoryId":person.category_id,"categoryIds":person.category_ids,"categoryLabel":person.category_label,"type":"person","color":color,"radius":10,"x":x,"y":y,"labelX":if right{18}else{-18},"labelY":4,"textAnchor":if right{"start"}else{"end"}});
    if let Some(lat) = person.latitude {
        value["latitude"] = json!(lat);
    }
    if let Some(lng) = person.longitude {
        value["longitude"] = json!(lng);
    }
    value
}

fn explicit_relations(
    people: &[Person],
    aliases: &HashMap<String, String>,
) -> Result<Vec<ExplicitRelation>> {
    let mut result = Vec::new();
    let mut seen = HashMap::new();
    for source in people {
        for link in &source.relation_to {
            let Some(target_id) = resolve_alias(&link.person, aliases) else {
                bail!(
                    "{}: unresolved relation_to person \"{}\"",
                    source.source_file,
                    link.person
                )
            };
            if target_id == source.id {
                bail!(
                    "{}: relation_to cannot reference the same person",
                    source.source_file
                );
            }
            let key = pair(&source.id, &target_id);
            let relation = defined_relation(&link.relation);
            if relation.is_empty() {
                bail!(
                    "{}: relation_to relation \"{}\" must be positive, neutral, flirty, mixed, or negative",
                    source.source_file,
                    link.relation
                );
            }
            if let Some(existing) = seen.get(&key) {
                if existing != &relation {
                    bail!(
                        "{}: relation_to conflicts with the existing {} relation for \"{}\"",
                        source.source_file,
                        existing,
                        link.person
                    );
                }
                continue;
            }
            seen.insert(key, relation.clone());
            let def = relation_definition(&relation);
            result.push(ExplicitRelation {
                source: source.id.clone(),
                target: target_id,
                relation: def.0.to_owned(),
                label: def.1.to_owned(),
                color: def.2.to_owned(),
                relationship: link.relationship.clone(),
            });
        }
    }
    Ok(result)
}
fn inferred_links(
    people: &[Person],
    edges: &mut Vec<Value>,
    seen: &mut HashSet<String>,
    connected: &HashSet<String>,
) {
    let alias = aliases(people);
    for source in people {
        let mut linked = HashSet::new();
        for capture in WIKI_TARGET
            .captures_iter(&source.content)
            .chain(MARKDOWN_TARGET.captures_iter(&source.content))
        {
            if let Some(target) =
                resolve_alias(&capture[1], &alias).filter(|target| target != &source.id)
            {
                linked.insert(target);
            }
        }
        for target in people {
            if target.id != source.id
                && target.label.chars().count() > 3
                && contains_word_case_insensitive(&source.content, &target.label)
            {
                linked.insert(target.id.clone());
            }
        }
        for target in linked {
            if !connected.contains(&pair(&source.id, &target)) {
                add_edge(
                    edges,
                    seen,
                    json!({"id":format!("edge:link:{}:{}",source.id,target),"type":"note-link","source":source.id,"target":target}),
                );
            }
        }
    }
}

fn contains_word_case_insensitive(haystack: &str, needle: &str) -> bool {
    let haystack = haystack.to_lowercase();
    let needle = needle.to_lowercase();
    let mut offset = 0;
    while let Some(index) = haystack[offset..].find(&needle) {
        let start = offset + index;
        let end = start + needle.len();
        let before_is_word = haystack[..start]
            .chars()
            .next_back()
            .is_some_and(|character| character.is_alphanumeric() || character == '_');
        let after_is_word = haystack[end..]
            .chars()
            .next()
            .is_some_and(|character| character.is_alphanumeric() || character == '_');
        if !before_is_word && !after_is_word {
            return true;
        }
        offset = end;
    }
    false
}
fn add_edge(edges: &mut Vec<Value>, seen: &mut HashSet<String>, mut edge: Value) {
    let key = if edge["type"] == "note-link" || edge["type"] == "person-relation" {
        format!(
            "{}:{}",
            edge["type"].as_str().unwrap_or(""),
            pair(
                edge["source"].as_str().unwrap_or(""),
                edge["target"].as_str().unwrap_or("")
            )
        )
    } else {
        format!(
            "{}::{}",
            edge["source"].as_str().unwrap_or(""),
            edge["target"].as_str().unwrap_or("")
        )
    };
    if seen.insert(key) {
        edge["path"] = json!("");
        edges.push(edge);
    }
}
fn add_paths(edges: &mut [Value], nodes: &[Value], d: (f64, f64, f64, f64)) {
    let by_id = nodes
        .iter()
        .filter_map(|node| node["id"].as_str().map(|id| (id, node)))
        .collect::<HashMap<_, _>>();
    for edge in edges {
        let Some(source) = by_id.get(edge["source"].as_str().unwrap_or("")) else {
            continue;
        };
        let Some(target) = by_id.get(edge["target"].as_str().unwrap_or("")) else {
            continue;
        };
        let sx = source["x"].as_f64().unwrap_or(0.0);
        let sy = source["y"].as_f64().unwrap_or(0.0);
        let tx = target["x"].as_f64().unwrap_or(0.0);
        let ty = target["y"].as_f64().unwrap_or(0.0);
        edge["path"] = json!(
            if edge["type"] == "note-link" || edge["type"] == "person-relation" {
                format!(
                    "M {} {} Q {} {} {} {}",
                    number(sx),
                    number(sy),
                    number(round((sx + tx + d.2) / 3.0)),
                    number(round((sy + ty + d.3) / 3.0)),
                    number(tx),
                    number(ty)
                )
            } else {
                format!(
                    "M {} {} L {} {}",
                    number(sx),
                    number(sy),
                    number(tx),
                    number(ty)
                )
            }
        );
    }
}

fn aliases(people: &[Person]) -> HashMap<String, String> {
    let mut result = HashMap::new();
    for person in people {
        let basename = person
            .note_id
            .strip_prefix("people/")
            .unwrap_or(&person.note_id)
            .rsplit('/')
            .next()
            .unwrap_or("");
        for value in [
            &person.label,
            &person.note_id,
            &person.source_file,
            &person.href,
            basename,
        ] {
            let key = normalize_lookup(value);
            if !key.is_empty() {
                result.insert(key, person.id.clone());
            }
        }
    }
    result
}
fn resolve_alias(target: &str, aliases: &HashMap<String, String>) -> Option<String> {
    let mut target = target.trim();
    if let Some(inner) = target
        .strip_prefix("[[")
        .and_then(|value| value.strip_suffix("]]"))
    {
        target = inner.split('|').next().unwrap_or(inner);
    }
    target = target
        .strip_prefix("/note/")
        .or_else(|| target.strip_prefix("note/"))
        .or_else(|| target.strip_prefix("/vault/"))
        .or_else(|| target.strip_prefix("vault/"))
        .unwrap_or(target);
    target = target
        .strip_suffix(".mdx")
        .or_else(|| target.strip_suffix(".md"))
        .unwrap_or(target)
        .trim_end_matches('/');
    let normalized = normalize_lookup(target);
    aliases
        .get(&normalized)
        .or_else(|| {
            aliases.get(&normalize_lookup(
                normalized.rsplit('/').next().unwrap_or(&normalized),
            ))
        })
        .cloned()
}
fn relation_to(value: Option<&Value>) -> Result<Vec<PersonRelationLink>> {
    let values = match value {
        None | Some(Value::Null) => Vec::new(),
        Some(Value::Array(values)) => values.iter().collect(),
        Some(value) => vec![value],
    };
    values
        .into_iter()
        .map(|value| match value {
            Value::String(person) => Ok(PersonRelationLink {
                person: person.trim().to_owned(),
                relation: "neutral".to_owned(),
                relationship: String::new(),
            }),
            Value::Object(object) => {
                let person = first_string(object.get("person"));
                if person.is_empty() {
                    bail!("relation_to entries require a person");
                }
                let relation = first_string(object.get("relation"));
                Ok(PersonRelationLink {
                    person,
                    relation: if relation.is_empty() {
                        "neutral".to_owned()
                    } else {
                        relation
                    },
                    relationship: first_string(object.get("relationship")),
                })
            }
            _ => bail!("relation_to entries must be strings or objects"),
        })
        .collect()
}
fn normalize_relation(value: Option<&Value>, tags: Option<&Value>) -> String {
    let direct = defined_relation(&first_string(value));
    if !direct.is_empty() {
        return direct;
    }
    for tag in normalize_tags(tags) {
        let lower = tag.to_lowercase();
        for relation in RELATIONS {
            if lower == relation.0 || lower == format!("relation/{}", relation.0) {
                return relation.0.to_owned();
            }
        }
    }
    "neutral".to_owned()
}
fn defined_relation(value: &str) -> String {
    let lower = value.to_lowercase();
    let normalized = match lower.as_str() {
        "good" | "friendly" => "positive",
        "bad" => "negative",
        "unknown" | "coworker" => "neutral",
        other => other,
    };
    RELATIONS
        .iter()
        .find(|value| value.0 == normalized)
        .map(|value| value.0.to_owned())
        .unwrap_or_default()
}
fn relation_definition(value: &str) -> (&'static str, &'static str, &'static str) {
    let normalized = {
        let value = defined_relation(value);
        if value.is_empty() {
            "neutral".to_owned()
        } else {
            value
        }
    };
    RELATIONS
        .iter()
        .copied()
        .find(|value| value.0 == normalized)
        .unwrap_or(RELATIONS[1])
}
fn unique_list(value: Option<&Value>, fallback: &[&str]) -> Vec<String> {
    let mut values = normalize_list(value);
    let mut unique = Vec::new();
    values.retain(|value| {
        if unique.contains(value) {
            false
        } else {
            unique.push(value.clone());
            true
        }
    });
    if values.is_empty() {
        fallback.iter().map(|value| (*value).to_owned()).collect()
    } else {
        values
    }
}
fn normalize_tags(value: Option<&Value>) -> Vec<String> {
    normalize_list(value)
}
fn humanize_path(value: &str) -> String {
    value
        .split('/')
        .map(humanize)
        .collect::<Vec<_>>()
        .join(" / ")
}
fn alignment_color(value: &str) -> &'static str {
    match value {
        "friend" => "#22c55e",
        "close_friend" => "#16a34a",
        "coworker" => "#38bdf8",
        "family" => "#a78bfa",
        "partner" => "#f472b6",
        "crush" => "#fb7185",
        "former_friend" => "#f59e0b",
        "classmate" => "#2dd4bf",
        "acquaintance" => "#94a3b8",
        "unknown" => "#64748b",
        _ => "#94a3b8",
    }
}
fn pair(left: &str, right: &str) -> String {
    if left <= right {
        format!("{left}::{right}")
    } else {
        format!("{right}::{left}")
    }
}
fn round(value: f64) -> f64 {
    (value * 10.0).round() / 10.0
}
fn number(value: f64) -> String {
    if value.fract() == 0.0 {
        format!("{}", value as i64)
    } else {
        format!("{value}")
    }
}
