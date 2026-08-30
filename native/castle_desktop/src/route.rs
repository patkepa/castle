#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum Route {
    Library {
        section: Option<String>,
        directory: Vec<String>,
    },
    Note(usize),
    Placeholder(&'static str),
}

impl Route {
    pub(crate) fn nav_key(&self) -> &'static str {
        match self {
            Self::Library { .. } | Self::Note(_) => "library",
            Self::Placeholder("Home") => "home",
            Self::Placeholder("People") => "people",
            Self::Placeholder("Tasks") => "tasks",
            Self::Placeholder("Calendar") => "calendar",
            Self::Placeholder("Canvas") => "canvas",
            Self::Placeholder("Stash") => "stash",
            Self::Placeholder(_) => "",
        }
    }

    pub(crate) fn is_library(&self) -> bool {
        matches!(self, Self::Library { .. })
    }

    pub(crate) fn is_note(&self) -> bool {
        matches!(self, Self::Note(_))
    }
}
