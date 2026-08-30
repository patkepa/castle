use std::collections::HashSet;

use castle_runtime::{
    CreateTaskInput, DeleteTaskInput, DeleteTaskResult, MutateTaskInput, RestoreTaskInput, Task,
    TaskCommand, TaskFields, TaskStatus,
};
use gpui::{AnyElement, Context, Focusable, FontWeight, SharedString, div, prelude::*, px, rgb};

use super::CastleApp;
use crate::{route::Route, theme::*};

#[derive(Default)]
pub(super) struct TasksState {
    filter: Option<TaskStatus>,
    create_open: bool,
    notice: Option<String>,
    pending_delete: Option<String>,
    last_deleted: Option<DeleteTaskResult>,
    busy: HashSet<String>,
}

impl CastleApp {
    pub(super) fn render_tasks_toolbar(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let mut filters = div().flex().items_center().gap_1();
        for (label, status) in [
            ("ALL", None),
            ("TO DO", Some(TaskStatus::Todo)),
            ("IN PROGRESS", Some(TaskStatus::InProgress)),
            ("BLOCKED", Some(TaskStatus::Blocked)),
            ("DONE", Some(TaskStatus::Done)),
        ] {
            filters = filters.child(self.task_filter_button(label, status, cx));
        }
        div()
            .h(px(44.0))
            .w_full()
            .flex_none()
            .flex()
            .items_center()
            .gap_3()
            .px_3()
            .border_b_1()
            .border_color(rgb(LINE))
            .bg(rgb(NAV))
            .child(filters)
            .child(div().flex_1())
            .child(self.task_search_input.clone())
            .child(
                div()
                    .id("new-task")
                    .h(px(28.0))
                    .flex()
                    .items_center()
                    .px_3()
                    .bg(rgb(ACCENT))
                    .cursor_pointer()
                    .text_size(px(9.0))
                    .font_weight(FontWeight::BOLD)
                    .text_color(rgb(TEXT))
                    .hover(|style| style.bg(rgb(ACCENT_HOVER)))
                    .on_click(cx.listener(|this, _, window, cx| {
                        this.tasks.create_open = true;
                        window.focus(&this.new_task_input.focus_handle(cx));
                        cx.notify();
                    }))
                    .child("+ NEW TASK"),
            )
    }

    fn task_filter_button(
        &self,
        label: &'static str,
        status: Option<TaskStatus>,
        cx: &mut Context<Self>,
    ) -> impl IntoElement {
        let selected = self.tasks.filter == status;
        div()
            .id(SharedString::from(format!("task-filter-{label}")))
            .h(px(26.0))
            .flex()
            .items_center()
            .px_2()
            .border_b_2()
            .border_color(rgb(if selected { ACCENT } else { NAV }))
            .cursor_pointer()
            .text_size(px(9.0))
            .font_weight(FontWeight::BOLD)
            .text_color(rgb(if selected { TEXT } else { MUTED }))
            .hover(|style| style.text_color(rgb(TEXT)).bg(rgb(HOVER)))
            .on_click(cx.listener(move |this, _, _, cx| {
                this.tasks.filter = status;
                cx.notify();
            }))
            .child(label)
    }

    pub(super) fn render_tasks(&self, cx: &mut Context<Self>) -> AnyElement {
        let Some(library) = self.library_state.snapshot() else {
            return div().p_8().child("Tasks are loading…").into_any_element();
        };
        let query = self.task_search_input.read(cx).text().trim().to_lowercase();
        let visible_statuses = self
            .tasks
            .filter
            .map_or_else(|| TASK_STATUSES.to_vec(), |status| vec![status]);
        let mut board = div()
            .id("task-board")
            .min_h_0()
            .flex_1()
            .flex()
            .gap_3()
            .overflow_x_scroll();
        for status in visible_statuses {
            let tasks = library
                .tasks
                .iter()
                .filter(|task| task.status == status)
                .filter(|task| query.is_empty() || task_search_text(task).contains(&query))
                .cloned()
                .collect::<Vec<_>>();
            board = board.child(self.task_column(status, tasks, cx));
        }

        div()
            .id("tasks-page")
            .min_h_0()
            .flex_1()
            .flex()
            .flex_col()
            .bg(rgb(CANVAS))
            .p_6()
            .when_some(self.tasks.notice.clone(), |page, notice| {
                page.child(
                    div()
                        .flex_none()
                        .mb_4()
                        .p_3()
                        .border_1()
                        .border_color(rgb(LINE))
                        .bg(rgb(PANEL))
                        .text_xs()
                        .text_color(rgb(TEXT_SECONDARY))
                        .child(notice)
                        .when(self.tasks.last_deleted.is_some(), |notice| {
                            notice.child(
                                div()
                                    .id("undo-delete-task")
                                    .mt_2()
                                    .cursor_pointer()
                                    .font_weight(FontWeight::BOLD)
                                    .text_color(rgb(ACCENT_HOVER))
                                    .on_click(
                                        cx.listener(|this, _, _, cx| this.restore_last_task(cx)),
                                    )
                                    .child("UNDO DELETE"),
                            )
                        }),
                )
            })
            .when(self.tasks.create_open, |page| {
                page.child(
                    div()
                        .flex_none()
                        .mb_4()
                        .flex()
                        .items_center()
                        .gap_2()
                        .p_4()
                        .border_1()
                        .border_color(rgb(LINE))
                        .bg(rgb(PANEL))
                        .child(self.new_task_input.clone())
                        .child(self.task_action_button(
                            "create-task-confirm",
                            "CREATE",
                            true,
                            |this, cx| this.create_task(cx),
                            cx,
                        ))
                        .child(self.task_action_button(
                            "create-task-cancel",
                            "CANCEL",
                            true,
                            |this, cx| this.close_task_overlays(cx),
                            cx,
                        )),
                )
            })
            .child(board)
            .into_any_element()
    }

    fn task_column(
        &self,
        status: TaskStatus,
        tasks: Vec<Task>,
        cx: &mut Context<Self>,
    ) -> impl IntoElement {
        let count = tasks.len();
        let mut list = div()
            .id(SharedString::from(format!(
                "task-column-{}",
                status.as_str()
            )))
            .min_h_0()
            .flex_1()
            .overflow_y_scroll()
            .p_2();
        for task in tasks {
            list = list.child(self.task_card(task, cx));
        }
        div()
            .min_w(px(260.0))
            .flex_1()
            .min_h_0()
            .flex()
            .flex_col()
            .border_1()
            .border_color(rgb(LINE))
            .bg(rgb(NAV))
            .child(
                div()
                    .h(px(38.0))
                    .flex_none()
                    .flex()
                    .items_center()
                    .px_3()
                    .border_b_1()
                    .border_color(rgb(LINE))
                    .text_size(px(9.0))
                    .font_weight(FontWeight::BOLD)
                    .text_color(rgb(status_color(status)))
                    .child(status_label(status))
                    .child(div().flex_1())
                    .child(div().text_color(rgb(MUTED)).child(count.to_string())),
            )
            .child(list)
    }

    fn task_card(&self, task: Task, cx: &mut Context<Self>) -> impl IntoElement {
        let busy = self.tasks.busy.contains(&task.id);
        let task_id = task.id.clone();
        let note_id = task.note_id.clone();
        let previous = previous_status(task.status);
        let next = next_status(task.status);
        let mut subtasks = div().mt_3().flex().flex_col().gap_1();
        for subtask in task.subtasks.clone() {
            let task_id = task.id.clone();
            let subtask_id = subtask.id.clone();
            subtasks = subtasks.child(
                div()
                    .id(SharedString::from(format!("subtask-{}", subtask.id)))
                    .flex()
                    .items_start()
                    .gap_2()
                    .cursor_pointer()
                    .text_xs()
                    .text_color(rgb(if subtask.completed {
                        MUTED
                    } else {
                        TEXT_SECONDARY
                    }))
                    .on_click(cx.listener(move |this, _, _, cx| {
                        this.toggle_subtask(task_id.clone(), subtask_id.clone(), cx)
                    }))
                    .child(if subtask.completed { "☑" } else { "☐" })
                    .child(subtask.title),
            );
        }

        div()
            .id(SharedString::from(format!("task-card-{}", task.id)))
            .mb_2()
            .p_4()
            .border_1()
            .border_color(rgb(if busy { ACCENT } else { LINE }))
            .bg(rgb(PANEL))
            .child(
                div()
                    .id(SharedString::from(format!("open-task-{}", task.id)))
                    .cursor_pointer()
                    .text_sm()
                    .font_weight(FontWeight::SEMIBOLD)
                    .text_color(rgb(TEXT))
                    .hover(|style| style.text_color(rgb(ACCENT_HOVER)))
                    .on_click(cx.listener(move |this, _, _, cx| {
                        this.navigate(Route::Note(note_id.clone()), cx)
                    }))
                    .child(task.title),
            )
            .when(!task.description.is_empty(), |card| {
                card.child(
                    div()
                        .mt_2()
                        .line_clamp(3)
                        .text_xs()
                        .line_height(px(18.0))
                        .text_color(rgb(MUTED))
                        .child(task.description),
                )
            })
            .when(!task.target_date.is_empty(), |card| {
                card.child(
                    div()
                        .mt_3()
                        .text_size(px(9.0))
                        .font_weight(FontWeight::BOLD)
                        .text_color(rgb(ACCENT_HOVER))
                        .child(format!("DUE {} {}", task.target_date, task.target_time)),
                )
            })
            .when(!task.subtasks.is_empty(), |card| card.child(subtasks))
            .child(
                div()
                    .mt_4()
                    .pt_3()
                    .border_t_1()
                    .border_color(rgb(LINE_SOFT))
                    .flex()
                    .items_center()
                    .gap_2()
                    .when_some(previous, |actions, status| {
                        let action_id = format!("task-move-back-{task_id}");
                        let task_id = task_id.clone();
                        actions.child(self.task_action_button(
                            action_id,
                            "←",
                            !busy,
                            move |this, cx| this.change_task_status(task_id.clone(), status, cx),
                            cx,
                        ))
                    })
                    .when_some(next, |actions, status| {
                        let action_id = format!("task-move-forward-{task_id}");
                        let task_id = task_id.clone();
                        actions.child(self.task_action_button(
                            action_id,
                            "→",
                            !busy,
                            move |this, cx| this.change_task_status(task_id.clone(), status, cx),
                            cx,
                        ))
                    })
                    .child(div().flex_1())
                    .child(self.task_action_button(
                        format!("delete-task-{task_id}"),
                        if self.tasks.pending_delete.as_deref() == Some(&task_id) {
                            "CONFIRM DELETE"
                        } else {
                            "DELETE"
                        },
                        !busy,
                        move |this, cx| this.request_delete_task(task_id.clone(), cx),
                        cx,
                    )),
            )
    }

    fn task_action_button(
        &self,
        id: impl Into<SharedString>,
        label: &'static str,
        enabled: bool,
        handler: impl Fn(&mut Self, &mut Context<Self>) + 'static,
        cx: &mut Context<Self>,
    ) -> impl IntoElement {
        div()
            .id(id.into())
            .h(px(24.0))
            .flex()
            .items_center()
            .px_2()
            .border_1()
            .border_color(rgb(LINE))
            .text_size(px(8.0))
            .font_weight(FontWeight::BOLD)
            .text_color(rgb(if enabled { TEXT_SECONDARY } else { MUTED }))
            .when(enabled, |button| {
                button
                    .cursor_pointer()
                    .hover(|style| style.bg(rgb(HOVER)).text_color(rgb(TEXT)))
                    .on_click(cx.listener(move |this, _, _, cx| handler(this, cx)))
            })
            .child(label)
    }

    fn create_task(&mut self, cx: &mut Context<Self>) {
        let title = self.new_task_input.read(cx).text().trim().to_owned();
        if title.is_empty() {
            self.tasks.notice = Some("Enter a title before creating the task.".into());
            cx.notify();
            return;
        }
        let Some(client) = self.client.clone() else {
            return;
        };
        let status = self
            .tasks
            .filter
            .filter(|status| *status != TaskStatus::Done)
            .unwrap_or(TaskStatus::Todo);
        self.tasks.busy.insert("new-task".into());
        let input = CreateTaskInput {
            fields: TaskFields {
                title,
                description: String::new(),
                status,
                target_date: String::new(),
                target_time: String::new(),
                estimate_minutes: 0,
                project_id: String::new(),
                people_ids: Vec::new(),
                tags: Vec::new(),
            },
        };
        let epoch = client.epoch();
        let background = cx.background_executor().clone();
        cx.spawn(async move |this, cx| {
            let result = background
                .spawn(async move { client.create_task(input) })
                .await;
            let _ = this.update(&mut *cx, |this, cx| {
                if this.library_state.active_epoch() != Some(epoch) {
                    return;
                }
                this.tasks.busy.remove("new-task");
                match result {
                    Ok(result) => {
                        this.tasks.create_open = false;
                        this.tasks.notice = Some(format!("Created ‘{}’.", result.task.title));
                        this.new_task_input.update(cx, |input, cx| input.clear(cx));
                    }
                    Err(reason) => {
                        this.tasks.notice = Some(format!("Could not create task: {reason:#}"))
                    }
                }
                cx.notify();
            });
        })
        .detach();
        cx.notify();
    }

    fn change_task_status(&mut self, task_id: String, status: TaskStatus, cx: &mut Context<Self>) {
        self.mutate_task(task_id, TaskCommand::ChangeStatus { status }, cx);
    }

    fn toggle_subtask(&mut self, task_id: String, subtask_id: String, cx: &mut Context<Self>) {
        self.mutate_task(task_id, TaskCommand::ToggleSubtask { subtask_id }, cx);
    }

    fn mutate_task(&mut self, task_id: String, command: TaskCommand, cx: &mut Context<Self>) {
        let Some(client) = self.client.clone() else {
            return;
        };
        if !self.tasks.busy.insert(task_id.clone()) {
            return;
        }
        let input = MutateTaskInput {
            task_id: task_id.clone(),
            command,
        };
        let epoch = client.epoch();
        let background = cx.background_executor().clone();
        cx.spawn(async move |this, cx| {
            let result = background
                .spawn(async move { client.mutate_task(input) })
                .await;
            let _ = this.update(&mut *cx, |this, cx| {
                if this.library_state.active_epoch() != Some(epoch) {
                    return;
                }
                this.tasks.busy.remove(&task_id);
                this.tasks.notice = result
                    .err()
                    .map(|reason| format!("Task update failed: {reason:#}"));
                cx.notify();
            });
        })
        .detach();
        cx.notify();
    }

    fn request_delete_task(&mut self, task_id: String, cx: &mut Context<Self>) {
        if self.tasks.pending_delete.as_deref() == Some(&task_id) {
            self.delete_task(task_id, cx);
        } else {
            self.tasks.pending_delete = Some(task_id);
            self.tasks.notice =
                Some("Choose CONFIRM DELETE to move this task to Castle's trash.".into());
            cx.notify();
        }
    }

    fn delete_task(&mut self, task_id: String, cx: &mut Context<Self>) {
        let Some(client) = self.client.clone() else {
            return;
        };
        if !self.tasks.busy.insert(task_id.clone()) {
            return;
        }
        self.tasks.pending_delete = None;
        let epoch = client.epoch();
        let background = cx.background_executor().clone();
        let deleting_task_id = task_id.clone();
        cx.spawn(async move |this, cx| {
            let result = background
                .spawn(async move {
                    client.delete_task(DeleteTaskInput {
                        task_id: deleting_task_id,
                    })
                })
                .await;
            let _ = this.update(&mut *cx, |this, cx| {
                if this.library_state.active_epoch() != Some(epoch) {
                    return;
                }
                this.tasks.busy.remove(&task_id);
                match result {
                    Ok(deleted) => {
                        this.tasks.notice = Some(format!(
                            "Deleted ‘{}’. The source can be restored.",
                            deleted.task.title
                        ));
                        this.tasks.last_deleted = Some(deleted);
                    }
                    Err(reason) => {
                        this.tasks.notice = Some(format!("Could not delete task: {reason:#}"))
                    }
                }
                cx.notify();
            });
        })
        .detach();
        cx.notify();
    }

    fn restore_last_task(&mut self, cx: &mut Context<Self>) {
        let Some(deleted) = self.tasks.last_deleted.take() else {
            return;
        };
        let Some(client) = self.client.clone() else {
            self.tasks.last_deleted = Some(deleted);
            return;
        };
        let input = RestoreTaskInput {
            task_id: deleted.task.id.clone(),
            note_id: deleted.source.note_id.clone(),
            source_file: deleted.source.source_file.clone(),
            trash_id: deleted.source.trash_id.clone(),
        };
        let retry = deleted.clone();
        let epoch = client.epoch();
        let background = cx.background_executor().clone();
        cx.spawn(async move |this, cx| {
            let result = background
                .spawn(async move { client.restore_task(input) })
                .await;
            let _ = this.update(&mut *cx, |this, cx| {
                if this.library_state.active_epoch() != Some(epoch) {
                    return;
                }
                match result {
                    Ok(restored) => {
                        this.tasks.notice = Some(format!("Restored ‘{}’.", restored.task.title))
                    }
                    Err(reason) => {
                        this.tasks.last_deleted = Some(retry);
                        this.tasks.notice = Some(format!("Could not restore task: {reason:#}"));
                    }
                }
                cx.notify();
            });
        })
        .detach();
    }

    pub(super) fn close_task_overlays(&mut self, cx: &mut Context<Self>) {
        self.tasks.create_open = false;
        self.tasks.pending_delete = None;
        self.new_task_input.update(cx, |input, cx| input.clear(cx));
        cx.notify();
    }
}

const TASK_STATUSES: [TaskStatus; 4] = [
    TaskStatus::Todo,
    TaskStatus::InProgress,
    TaskStatus::Blocked,
    TaskStatus::Done,
];

fn status_label(status: TaskStatus) -> &'static str {
    match status {
        TaskStatus::Todo => "TO DO",
        TaskStatus::InProgress => "IN PROGRESS",
        TaskStatus::Blocked => "BLOCKED",
        TaskStatus::Done => "DONE",
    }
}

fn status_color(status: TaskStatus) -> u32 {
    match status {
        TaskStatus::Todo => TEXT_SECONDARY,
        TaskStatus::InProgress => ACCENT_HOVER,
        TaskStatus::Blocked => 0xd28c55,
        TaskStatus::Done => 0x6faa87,
    }
}

fn previous_status(status: TaskStatus) -> Option<TaskStatus> {
    match status {
        TaskStatus::Todo => None,
        TaskStatus::InProgress => Some(TaskStatus::Todo),
        TaskStatus::Blocked => Some(TaskStatus::InProgress),
        TaskStatus::Done => Some(TaskStatus::Blocked),
    }
}

fn next_status(status: TaskStatus) -> Option<TaskStatus> {
    match status {
        TaskStatus::Todo => Some(TaskStatus::InProgress),
        TaskStatus::InProgress => Some(TaskStatus::Blocked),
        TaskStatus::Blocked => Some(TaskStatus::Done),
        TaskStatus::Done => None,
    }
}

fn task_search_text(task: &Task) -> String {
    format!(
        "{} {} {} {}",
        task.title,
        task.description,
        task.tags.join(" "),
        task.project
            .as_ref()
            .map(|project| project.title.as_str())
            .unwrap_or("")
    )
    .to_lowercase()
}

#[cfg(test)]
mod tests {
    use super::{next_status, previous_status};
    use castle_runtime::TaskStatus;

    #[test]
    fn task_workflow_has_stable_neighbors() {
        assert_eq!(previous_status(TaskStatus::Todo), None);
        assert_eq!(next_status(TaskStatus::Todo), Some(TaskStatus::InProgress));
        assert_eq!(next_status(TaskStatus::Blocked), Some(TaskStatus::Done));
        assert_eq!(next_status(TaskStatus::Done), None);
    }
}
