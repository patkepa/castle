import type { TaskPerson, TaskStatus } from "../../types";
import { personInitials, statusLabels } from "./taskPresentation";

export function TaskStatusLabel({ status }: { status: TaskStatus }) {
  return (
    <span className={`task-status task-status--${status}`}>
      <i aria-hidden="true" />
      {statusLabels[status]}
    </span>
  );
}

export function TaskPersonAvatar({ person }: { person: TaskPerson }) {
  return person.avatarUrl ? (
    <img
      className="task-person-avatar"
      src={person.avatarUrl}
      alt=""
      loading="lazy"
    />
  ) : (
    <span className="task-person-avatar task-person-avatar--initials" aria-hidden="true">
      {personInitials(person.name)}
    </span>
  );
}
