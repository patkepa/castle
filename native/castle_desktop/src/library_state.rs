use std::sync::Arc;

use castle_runtime::{AppSnapshot, RuntimeEvent, ServiceStatusKind, SessionEpoch};

pub(crate) struct LibraryState {
    active_epoch: Option<SessionEpoch>,
    snapshot: Option<Arc<AppSnapshot>>,
    error: Option<String>,
    status: String,
}

impl LibraryState {
    pub(crate) fn new(active_epoch: Option<SessionEpoch>, error: Option<String>) -> Self {
        Self {
            active_epoch,
            snapshot: None,
            error,
            status: "Opening the Castle…".into(),
        }
    }

    pub(crate) fn apply(&mut self, event: RuntimeEvent) -> bool {
        if Some(event.epoch()) != self.active_epoch {
            return false;
        }
        match event {
            RuntimeEvent::LibraryReady { snapshot, .. }
            | RuntimeEvent::ContentChanged { snapshot, .. } => {
                self.snapshot = Some(snapshot);
                self.error = None;
            }
            RuntimeEvent::ServiceStatus { status, .. } => {
                self.status = status.message.clone();
                match status.kind {
                    ServiceStatusKind::Unavailable => self.error = Some(status.message),
                    ServiceStatusKind::Ready | ServiceStatusKind::Opening => self.error = None,
                    ServiceStatusKind::Stale | ServiceStatusKind::Stopped => {}
                }
            }
        }
        true
    }

    pub(crate) fn begin_switch(&mut self, library: &str) {
        self.active_epoch = None;
        self.snapshot = None;
        self.error = None;
        self.status = format!("Opening {library}…");
    }

    pub(crate) fn activate(&mut self, epoch: SessionEpoch) {
        self.active_epoch = Some(epoch);
        self.snapshot = None;
        self.error = None;
    }

    pub(crate) fn fail_switch(&mut self, reason: String) {
        self.active_epoch = None;
        self.snapshot = None;
        self.status = reason.clone();
        self.error = Some(reason);
    }

    pub(crate) fn report_error(&mut self, reason: String) {
        self.status = reason.clone();
        if self.snapshot.is_none() {
            self.error = Some(reason);
        }
    }

    pub(crate) fn snapshot(&self) -> Option<&Arc<AppSnapshot>> {
        self.snapshot.as_ref()
    }

    pub(crate) fn error(&self) -> Option<&str> {
        self.error.as_deref()
    }

    pub(crate) fn status(&self) -> &str {
        &self.status
    }
}

#[cfg(test)]
mod tests {
    use castle_runtime::{RuntimeServiceStatus, ServiceStatusKind};

    use super::*;

    fn status_event(epoch: SessionEpoch, message: &str) -> RuntimeEvent {
        RuntimeEvent::ServiceStatus {
            epoch,
            status: RuntimeServiceStatus {
                kind: ServiceStatusKind::Ready,
                message: message.into(),
                generated_at: String::new(),
            },
        }
    }

    #[test]
    fn ignores_events_from_a_retired_session_epoch() {
        let retired = SessionEpoch::next();
        let mut state = LibraryState::new(Some(retired), None);
        state.begin_switch("another library");

        assert!(!state.apply(status_event(retired, "retired")));
        assert_eq!(state.status(), "Opening another library…");
        assert!(state.snapshot().is_none());
    }

    #[test]
    fn accepts_events_from_the_active_session_epoch() {
        let retired = SessionEpoch::next();
        let active = SessionEpoch::next();
        let mut state = LibraryState::new(Some(retired), Some("startup failure".into()));
        state.begin_switch("another library");
        state.activate(active);

        assert!(!state.apply(status_event(retired, "retired")));
        assert!(state.apply(status_event(active, "ready")));
        assert_eq!(state.status(), "ready");
        assert!(state.error().is_none());
    }

    #[test]
    fn picker_errors_do_not_retire_the_active_epoch() {
        let active = SessionEpoch::next();
        let mut state = LibraryState::new(Some(active), None);

        state.report_error("picker failed".into());

        assert!(state.apply(status_event(active, "still active")));
        assert_eq!(state.status(), "still active");
        assert!(state.error().is_none());
    }
}
