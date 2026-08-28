use std::sync::LazyLock;

use icu_collator::CollatorBorrowed;
use icu_locale::locale;
use regex::Regex;
use serde_json::Value;
use unicode_normalization::{UnicodeNormalization, char::is_combining_mark};

static IMAGE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"!\[([^\]]*)\]\([^)]*\)").unwrap());
static LINK: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\[([^\]]+)\]\([^)]*\)").unwrap());
static FORMATTING: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"[`*_~]").unwrap());
static FENCES: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?s)```.*?```").unwrap());
static INLINE_CODE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"`([^`]+)`").unwrap());
static MARKS: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"[#>*_|~\-]").unwrap());
static SPACES: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\s+").unwrap());
static OBSIDIAN_INLINE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\[\[([^\]|]+)(?:\|([^\]]+))?\]\]").unwrap());
static WORD_SEPARATORS: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"[-_]+").unwrap());
static COLLATOR: LazyLock<CollatorBorrowed<'static>> = LazyLock::new(|| {
    CollatorBorrowed::try_new(locale!("en-US").into(), Default::default())
        .expect("the compiled en-US collation data must be available")
});

pub(crate) fn first_string(value: Option<&Value>) -> String {
    match value {
        Some(Value::String(value)) => value.trim().to_owned(),
        Some(Value::Array(values)) => values
            .iter()
            .find_map(|value| match value {
                Value::String(value) if !value.trim().is_empty() => Some(value.trim().to_owned()),
                _ => None,
            })
            .unwrap_or_default(),
        _ => String::new(),
    }
}

pub(crate) fn normalize_list(value: Option<&Value>) -> Vec<String> {
    match value {
        Some(Value::Array(values)) => values
            .iter()
            .map(|value| first_string(Some(value)))
            .filter(|value| !value.is_empty())
            .collect(),
        Some(Value::String(value)) => value
            .trim_matches(['[', ']'])
            .split([',', ' '])
            .map(|value| value.trim().trim_start_matches('#').to_owned())
            .filter(|value| !value.is_empty())
            .collect(),
        _ => Vec::new(),
    }
}

pub(crate) fn clean_inline_markdown(value: &str) -> String {
    let value = OBSIDIAN_INLINE.replace_all(value, |captures: &regex::Captures<'_>| {
        captures
            .get(2)
            .map(|value| value.as_str())
            .unwrap_or_else(|| captures[1].rsplit('/').next().unwrap_or(&captures[1]))
            .to_owned()
    });
    let value = IMAGE.replace_all(&value, "$1");
    let value = LINK.replace_all(&value, "$1");
    FORMATTING.replace_all(&value, "").trim().to_owned()
}

pub(crate) fn humanize(value: &str) -> String {
    let value = WORD_SEPARATORS.replace_all(value, " ");
    let mut result = String::new();
    let mut previous_ascii_word = false;
    for character in value.chars() {
        let ascii_word = character.is_ascii_alphanumeric() || character == '_';
        if character.is_alphabetic() && ascii_word != previous_ascii_word {
            result.extend(character.to_uppercase());
        } else {
            result.push(character);
        }
        previous_ascii_word = ascii_word;
    }
    result
}

pub(crate) fn normalize_lookup(value: &str) -> String {
    let decomposed = value
        .nfkd()
        .filter(|character| !is_combining_mark(*character))
        .collect::<String>();
    let normalized = decomposed.replace('\\', "/");
    let normalized = normalized
        .strip_suffix(".mdx")
        .or_else(|| normalized.strip_suffix(".md"))
        .unwrap_or(&normalized);
    let normalized = normalized
        .strip_prefix("./")
        .or_else(|| normalized.strip_prefix('/'))
        .unwrap_or(normalized);
    normalized
        .strip_suffix("/index")
        .unwrap_or(normalized)
        .trim()
        .to_lowercase()
}

pub(crate) fn normalize_search_text(value: &str) -> String {
    value
        .nfkd()
        .filter(|character| !is_combining_mark(*character))
        .flat_map(|character| {
            let replacement = match character.to_lowercase().next().unwrap_or(character) {
                'ł' => "l",
                'ø' => "o",
                'đ' | 'ð' => "d",
                'þ' => "th",
                'æ' => "ae",
                'œ' => "oe",
                'ß' => "ss",
                lowered => return lowered.to_string().chars().collect::<Vec<_>>(),
            };
            replacement.chars().collect::<Vec<_>>()
        })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

pub(crate) fn github_slug(value: &str) -> String {
    let mut slug = String::new();
    for character in value.trim().to_lowercase().chars() {
        if character.is_alphanumeric()
            || is_combining_mark(character)
            || character == '_'
            || character == '-'
            || character == ' '
        {
            slug.push(character);
        }
    }
    slug.replace(' ', "-")
}

pub(crate) fn strip_markdown(content: &str) -> String {
    let text = FENCES.replace_all(content, " ");
    let text = INLINE_CODE.replace_all(&text, "$1");
    let text = IMAGE.replace_all(&text, "$1");
    let text = LINK.replace_all(&text, "$1");
    let text = MARKS.replace_all(&text, " ");
    SPACES.replace_all(&text, " ").trim().to_owned()
}

pub(crate) fn normalize_reference(value: &str) -> String {
    let trimmed = value.trim();
    let target = trimmed
        .strip_prefix("[[")
        .and_then(|value| value.strip_suffix("]]"))
        .map(|value| value.split('|').next().unwrap_or(value))
        .unwrap_or(trimmed);
    let target = target.replace('\\', "/");
    let target = target
        .trim_start_matches('/')
        .strip_prefix("note/")
        .unwrap_or(target.trim_start_matches('/'));
    let target = target
        .strip_suffix(".mdx")
        .or_else(|| target.strip_suffix(".md"))
        .unwrap_or(target);
    target.nfkc().collect::<String>().to_lowercase()
}

pub(crate) fn locale_compare(left: &str, right: &str) -> std::cmp::Ordering {
    COLLATOR.compare(left, right)
}
