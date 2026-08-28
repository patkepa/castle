import { Icon, PopoverNext } from "@patkepa/kantzen-ui/primitives";
import type { IconName } from "@patkepa/kantzen-ui/icons";
import {
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  addDays,
  addMonths,
  formatLocalDateKey,
  parseLocalDateKey,
  startOfWeek,
} from "../../lib/calendarDate";
import type { Note } from "../../types";
import { TaskPersonAvatar } from "./TaskStatus";
import { formatDuration, formatFullTaskDate } from "./taskPresentation";

export interface TaskControlOption {
  description?: string;
  icon?: IconName;
  label: string;
  value: string;
}

interface TaskControlPopoverProps {
  children: ReactNode;
  content: React.JSX.Element;
  disabled?: boolean;
  isOpen: boolean;
  onInteraction: (nextOpenState: boolean) => void;
  placement?: "bottom-start" | "bottom-end";
  popoverClassName?: string;
}

const monthFormatter = new Intl.DateTimeFormat("en-GB", {
  month: "long",
  year: "numeric",
});
const dayLabelFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "long",
  year: "numeric",
});
const weekDayLabels = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const estimatePresets = [0, 15, 30, 45, 60, 90, 120, 180, 240];
const standardMinuteOptions = Array.from({ length: 12 }, (_, index) => index * 5);

function TaskControlPopover({
  children,
  content,
  disabled = false,
  isOpen,
  onInteraction,
  placement = "bottom-start",
  popoverClassName = "",
}: TaskControlPopoverProps) {
  return (
    <PopoverNext
      arrow={false}
      captureDismiss
      className="task-control-popover-target"
      content={content}
      disabled={disabled}
      inheritDarkTheme
      isOpen={isOpen}
      placement={placement}
      popoverClassName={`task-control-popover ${popoverClassName}`.trim()}
      portalClassName="task-control-popover-portal"
      transitionDuration={0}
      onInteraction={onInteraction}
    >
      {children}
    </PopoverNext>
  );
}

export function TaskSingleSelectControl({
  ariaLabel,
  disabled,
  options,
  placeholder,
  renderLeading,
  searchPlaceholder = "Search options",
  value,
  onChange,
}: {
  ariaLabel: string;
  disabled: boolean;
  options: TaskControlOption[];
  placeholder: string;
  renderLeading?: (option: TaskControlOption) => ReactNode;
  searchPlaceholder?: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selectedOption = options.find((option) => option.value === value);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filteredOptions = useMemo(
    () => options.filter((option) =>
      !normalizedQuery ||
      `${option.label} ${option.description ?? ""}`
        .toLocaleLowerCase()
        .includes(normalizedQuery),
    ),
    [normalizedQuery, options],
  );
  const searchable = options.length > 7;

  const setPopoverOpen = (nextOpenState: boolean) => {
    setOpen(nextOpenState);
    if (!nextOpenState) setQuery("");
  };

  return (
    <TaskControlPopover
      content={
        <div className="task-control-panel" aria-label={ariaLabel}>
          <header className="task-control-panel-header">
            <span>{ariaLabel}</span>
            <small>{options.length} options</small>
          </header>
          {searchable ? (
            <label className="task-control-search">
              <Icon icon="search" size={13} aria-hidden="true" />
              <input
                autoFocus
                aria-label={searchPlaceholder}
                placeholder={searchPlaceholder}
                value={query}
                onChange={(event) => setQuery(event.currentTarget.value)}
              />
            </label>
          ) : null}
          <div className="task-control-options" role="listbox" aria-label={ariaLabel}>
            {filteredOptions.length > 0 ? filteredOptions.map((option) => (
              <button
                aria-selected={option.value === value}
                className={option.value === value ? "is-selected" : undefined}
                key={option.value}
                role="option"
                type="button"
                onClick={() => {
                  if (option.value !== value) onChange(option.value);
                  setPopoverOpen(false);
                }}
              >
                <span className="task-control-option-leading">
                  {renderLeading?.(option) ?? (
                    option.icon ? <Icon icon={option.icon} size={14} aria-hidden="true" /> : null
                  )}
                </span>
                <span className="task-control-option-copy">
                  <strong>{option.label}</strong>
                  {option.description ? <small>{option.description}</small> : null}
                </span>
                {option.value === value ? (
                  <Icon icon="tick" size={13} aria-hidden="true" />
                ) : null}
              </button>
            )) : (
              <span className="task-control-options-empty">No matching options</span>
            )}
          </div>
        </div>
      }
      disabled={disabled}
      isOpen={open}
      onInteraction={setPopoverOpen}
    >
      <button
        aria-label={ariaLabel}
        className="task-control-trigger"
        disabled={disabled}
        type="button"
      >
        <span>
          {selectedOption ? renderLeading?.(selectedOption) : null}
          <span>{selectedOption?.label ?? placeholder}</span>
        </span>
        <Icon icon="chevron-down" size={12} aria-hidden="true" />
      </button>
    </TaskControlPopover>
  );
}

export function TaskDateControl({
  ariaLabel,
  disabled,
  placeholder,
  value,
  onChange,
}: {
  ariaLabel: string;
  disabled: boolean;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const initialDate = parseLocalDateKey(value) ?? new Date();
  const [open, setOpen] = useState(false);
  const [visibleMonth, setVisibleMonth] = useState(
    () => new Date(initialDate.getFullYear(), initialDate.getMonth(), 1),
  );
  const selectedDate = parseLocalDateKey(value);
  const today = new Date();
  const todayKey = formatLocalDateKey(today);
  const calendarDays = useMemo(() => {
    const monthStart = new Date(
      visibleMonth.getFullYear(),
      visibleMonth.getMonth(),
      1,
    );
    const gridStart = startOfWeek(monthStart);
    return Array.from({ length: 42 }, (_, index) => addDays(gridStart, index));
  }, [visibleMonth]);

  const setPopoverOpen = (nextOpenState: boolean) => {
    if (nextOpenState) {
      const focusDate = parseLocalDateKey(value) ?? new Date();
      setVisibleMonth(new Date(focusDate.getFullYear(), focusDate.getMonth(), 1));
    }
    setOpen(nextOpenState);
  };

  const chooseDate = (nextValue: string) => {
    if (nextValue !== value) onChange(nextValue);
    setOpen(false);
  };

  return (
    <TaskControlPopover
      content={
        <div className="task-date-picker" aria-label={ariaLabel}>
          <header>
            <button
              aria-label="Previous month"
              type="button"
              onClick={() => setVisibleMonth((month) => addMonths(month, -1))}
            >
              <Icon icon="chevron-left" size={14} aria-hidden="true" />
            </button>
            <strong>{monthFormatter.format(visibleMonth)}</strong>
            <button
              aria-label="Next month"
              type="button"
              onClick={() => setVisibleMonth((month) => addMonths(month, 1))}
            >
              <Icon icon="chevron-right" size={14} aria-hidden="true" />
            </button>
          </header>
          <div className="task-date-picker-weekdays" aria-hidden="true">
            {weekDayLabels.map((day) => <span key={day}>{day}</span>)}
          </div>
          <div className="task-date-picker-grid">
            {calendarDays.map((date) => {
              const dateKey = formatLocalDateKey(date);
              const isSelected = selectedDate ? dateKey === value : false;
              const isCurrentMonth = date.getMonth() === visibleMonth.getMonth();
              return (
                <button
                  aria-label={dayLabelFormatter.format(date)}
                  aria-pressed={isSelected}
                  className={[
                    isCurrentMonth ? "" : "is-outside-month",
                    dateKey === todayKey ? "is-today" : "",
                    isSelected ? "is-selected" : "",
                  ].filter(Boolean).join(" ") || undefined}
                  key={dateKey}
                  type="button"
                  onClick={() => chooseDate(dateKey)}
                >
                  {date.getDate()}
                </button>
              );
            })}
          </div>
          <footer>
            <button type="button" onClick={() => chooseDate("")}>Clear</button>
            <div>
              <button
                type="button"
                onClick={() => chooseDate(formatLocalDateKey(addDays(today, 1)))}
              >
                Tomorrow
              </button>
              <button
                className="is-primary"
                type="button"
                onClick={() => chooseDate(todayKey)}
              >
                Today
              </button>
            </div>
          </footer>
        </div>
      }
      disabled={disabled}
      isOpen={open}
      popoverClassName="task-control-popover--calendar"
      onInteraction={setPopoverOpen}
    >
      <button
        aria-label={ariaLabel}
        className="task-control-trigger"
        disabled={disabled}
        type="button"
      >
        <span>
          <Icon icon="calendar" size={13} aria-hidden="true" />
          <span>{selectedDate ? formatFullTaskDate(value) : placeholder}</span>
        </span>
        <Icon icon="chevron-down" size={12} aria-hidden="true" />
      </button>
    </TaskControlPopover>
  );
}

function parseTimeParts(value: string) {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (match) {
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (hours < 24 && minutes < 60) return { hours, minutes };
  }
  const now = new Date();
  return {
    hours: now.getHours(),
    minutes: Math.floor(now.getMinutes() / 5) * 5,
  };
}

function formatTime(hours: number, minutes: number) {
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

export function TaskTimeControl({
  ariaLabel,
  disabled,
  value,
  onChange,
}: {
  ariaLabel: string;
  disabled: boolean;
  value: string;
  onChange: (value: string) => void;
}) {
  const initialParts = parseTimeParts(value);
  const [open, setOpen] = useState(false);
  const [hours, setHours] = useState(initialParts.hours);
  const [minutes, setMinutes] = useState(initialParts.minutes);
  const minuteOptions = useMemo(
    () => [...new Set([...standardMinuteOptions, minutes])].sort((left, right) => left - right),
    [minutes],
  );

  const setPopoverOpen = (nextOpenState: boolean) => {
    if (nextOpenState) {
      const parts = parseTimeParts(value);
      setHours(parts.hours);
      setMinutes(parts.minutes);
    }
    setOpen(nextOpenState);
  };

  const commit = () => {
    const nextValue = formatTime(hours, minutes);
    if (nextValue !== value) onChange(nextValue);
    setOpen(false);
  };

  return (
    <TaskControlPopover
      content={
        <div className="task-time-picker" aria-label={ariaLabel}>
          <header className="task-control-panel-header">
            <span>Choose time</span>
            <strong>{formatTime(hours, minutes)}</strong>
          </header>
          <section>
            <span>Hour</span>
            <div className="task-time-picker-grid task-time-picker-grid--hours">
              {Array.from({ length: 24 }, (_, hour) => (
                <button
                  aria-pressed={hours === hour}
                  className={hours === hour ? "is-selected" : undefined}
                  key={hour}
                  type="button"
                  onClick={() => setHours(hour)}
                >
                  {String(hour).padStart(2, "0")}
                </button>
              ))}
            </div>
          </section>
          <section>
            <span>Minute</span>
            <div className="task-time-picker-grid task-time-picker-grid--minutes">
              {minuteOptions.map((minute) => (
                <button
                  aria-pressed={minutes === minute}
                  className={minutes === minute ? "is-selected" : undefined}
                  key={minute}
                  type="button"
                  onClick={() => setMinutes(minute)}
                >
                  {String(minute).padStart(2, "0")}
                </button>
              ))}
            </div>
          </section>
          <footer className="task-control-footer">
            <button
              type="button"
              onClick={() => {
                if (value) onChange("");
                setOpen(false);
              }}
            >
              Clear
            </button>
            <button className="is-primary" type="button" onClick={commit}>Apply</button>
          </footer>
        </div>
      }
      disabled={disabled}
      isOpen={open}
      popoverClassName="task-control-popover--time"
      onInteraction={setPopoverOpen}
    >
      <button
        aria-label={ariaLabel}
        className="task-control-trigger"
        disabled={disabled}
        type="button"
      >
        <span>
          <Icon icon="time" size={13} aria-hidden="true" />
          <span>{value || "No time"}</span>
        </span>
        <Icon icon="chevron-down" size={12} aria-hidden="true" />
      </button>
    </TaskControlPopover>
  );
}

export function TaskEstimateControl({
  disabled,
  value,
  onChange,
}: {
  disabled: boolean;
  value: number;
  onChange: (value: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value ? String(value) : "");
  const presets = useMemo(
    () => [...new Set([...estimatePresets, value])].sort((left, right) => left - right),
    [value],
  );

  const setPopoverOpen = (nextOpenState: boolean) => {
    if (nextOpenState) setDraft(value ? String(value) : "");
    setOpen(nextOpenState);
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextValue = Math.max(0, Number.parseInt(draft, 10) || 0);
    if (nextValue !== value) onChange(nextValue);
    setOpen(false);
  };

  return (
    <TaskControlPopover
      content={
        <form className="task-estimate-picker" onSubmit={submit}>
          <header className="task-control-panel-header">
            <span>Estimate</span>
            <small>Focused work time</small>
          </header>
          <div className="task-estimate-presets">
            {presets.map((minutes) => (
              <button
                aria-pressed={minutes === value}
                className={minutes === value ? "is-selected" : undefined}
                key={minutes}
                type="button"
                onClick={() => {
                  if (minutes !== value) onChange(minutes);
                  setOpen(false);
                }}
              >
                {minutes === 0 ? "None" : formatDuration(minutes)}
              </button>
            ))}
          </div>
          <label className="task-estimate-custom">
            <span>Custom</span>
            <span>
              <input
                aria-label="Custom estimate in minutes"
                inputMode="numeric"
                pattern="[0-9]*"
                placeholder="0"
                value={draft}
                onChange={(event) => setDraft(event.currentTarget.value.replace(/\D/g, ""))}
              />
              <small>min</small>
            </span>
          </label>
          <footer className="task-control-footer">
            <button type="button" onClick={() => setOpen(false)}>Cancel</button>
            <button className="is-primary" type="submit">Apply</button>
          </footer>
        </form>
      }
      disabled={disabled}
      isOpen={open}
      popoverClassName="task-control-popover--estimate"
      onInteraction={setPopoverOpen}
    >
      <button
        aria-label="Task estimate"
        className="task-control-trigger"
        disabled={disabled}
        type="button"
      >
        <span>
          <Icon icon="stopwatch" size={13} aria-hidden="true" />
          <span>{value > 0 ? formatDuration(value) : "Not estimated"}</span>
        </span>
        <Icon icon="chevron-down" size={12} aria-hidden="true" />
      </button>
    </TaskControlPopover>
  );
}

function parseTags(value: string) {
  return [...new Set(value.split(",").map((tag) => tag.trim()).filter(Boolean))];
}

export function TaskTagsControl({
  disabled,
  tags,
  onChange,
}: {
  disabled: boolean;
  tags: string[];
  onChange: (tags: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(tags.join(", "));
  const draftTags = parseTags(draft);

  const setPopoverOpen = (nextOpenState: boolean) => {
    if (nextOpenState) setDraft(tags.join(", "));
    setOpen(nextOpenState);
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextTags = parseTags(draft);
    if (nextTags.join("\u0000") !== tags.join("\u0000")) onChange(nextTags);
    setOpen(false);
  };

  return (
    <TaskControlPopover
      content={
        <form className="task-tags-picker" onSubmit={submit}>
          <header className="task-control-panel-header">
            <span>Tags</span>
            <small>Comma separated</small>
          </header>
          <label className="task-tags-input">
            <Icon icon="tag" size={13} aria-hidden="true" />
            <input
              autoFocus
              aria-label="Task tags"
              placeholder="important, errands"
              value={draft}
              onChange={(event) => setDraft(event.currentTarget.value)}
            />
          </label>
          <div className="task-tags-preview">
            {draftTags.length > 0 ? draftTags.map((tag) => (
              <span key={tag}>{tag}</span>
            )) : <small>No tags</small>}
          </div>
          <footer className="task-control-footer">
            <button
              type="button"
              onClick={() => {
                if (tags.length > 0) onChange([]);
                setOpen(false);
              }}
            >
              Clear
            </button>
            <button className="is-primary" type="submit">Apply</button>
          </footer>
        </form>
      }
      disabled={disabled}
      isOpen={open}
      popoverClassName="task-control-popover--tags"
      onInteraction={setPopoverOpen}
    >
      <button
        aria-label="Task tags"
        className="task-control-trigger"
        disabled={disabled}
        type="button"
      >
        <span>
          <Icon icon="tag" size={13} aria-hidden="true" />
          <span className="task-control-trigger-overflow">
            {tags.length > 0 ? tags.join(", ") : "No tags"}
          </span>
        </span>
        <Icon icon="chevron-down" size={12} aria-hidden="true" />
      </button>
    </TaskControlPopover>
  );
}

export function TaskPeopleControl({
  ariaLabel,
  disabled,
  emptyLabel,
  excludedIds = [],
  people,
  selectedIds,
  onChange,
}: {
  ariaLabel: string;
  disabled: boolean;
  emptyLabel: string;
  excludedIds?: string[];
  people: Note[];
  selectedIds: string[];
  onChange: (peopleIds: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const excludedIdSet = useMemo(() => new Set(excludedIds), [excludedIds]);
  const peopleById = useMemo(
    () => new Map(people.map((person) => [person.id, person])),
    [people],
  );
  const selectedPeople = selectedIds.flatMap((id) => {
    const person = peopleById.get(id);
    return person ? [person] : [];
  });
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const availablePeople = useMemo(
    () => people.filter((person) =>
      !excludedIdSet.has(person.id) &&
      (!normalizedQuery || person.title.toLocaleLowerCase().includes(normalizedQuery)),
    ),
    [excludedIdSet, normalizedQuery, people],
  );

  const setPopoverOpen = (nextOpenState: boolean) => {
    setOpen(nextOpenState);
    if (!nextOpenState) setQuery("");
  };

  return (
    <TaskControlPopover
      content={
        <div className="task-people-picker" aria-label={ariaLabel}>
          <header className="task-control-panel-header">
            <span>{ariaLabel}</span>
            <small>{selectedIds.length} selected</small>
          </header>
          {people.length > 7 ? (
            <label className="task-control-search">
              <Icon icon="search" size={13} aria-hidden="true" />
              <input
                autoFocus
                aria-label="Search people"
                placeholder="Search people"
                value={query}
                onChange={(event) => setQuery(event.currentTarget.value)}
              />
            </label>
          ) : null}
          <div className="task-people-picker-options">
            {availablePeople.length > 0 ? availablePeople.map((person) => {
              const selected = selectedIdSet.has(person.id);
              return (
                <button
                  aria-pressed={selected}
                  className={selected ? "is-selected" : undefined}
                  disabled={disabled}
                  key={person.id}
                  type="button"
                  onClick={() => {
                    const nextIds = selected
                      ? selectedIds.filter((id) => id !== person.id)
                      : [...selectedIds, person.id];
                    onChange(nextIds);
                  }}
                >
                  <TaskPersonAvatar
                    person={{
                      avatarUrl: person.avatarUrl,
                      name: person.title,
                      noteId: person.id,
                      route: person.route,
                    }}
                  />
                  <span>{person.title}</span>
                  <span className="task-people-picker-check" aria-hidden="true">
                    {selected ? <Icon icon="tick" size={11} /> : null}
                  </span>
                </button>
              );
            }) : (
              <span className="task-control-options-empty">No matching people</span>
            )}
          </div>
          <footer className="task-control-footer task-control-footer--end">
            <button className="is-primary" type="button" onClick={() => setOpen(false)}>
              Done
            </button>
          </footer>
        </div>
      }
      isOpen={open}
      popoverClassName="task-control-popover--people"
      onInteraction={setPopoverOpen}
    >
      <button
        aria-label={ariaLabel}
        className="task-control-trigger"
        disabled={disabled}
        type="button"
      >
        <span>
          {selectedPeople.length > 0 ? (
            <span className="task-control-avatar-stack">
              {selectedPeople.slice(0, 3).map((person) => (
                <TaskPersonAvatar
                  key={person.id}
                  person={{
                    avatarUrl: person.avatarUrl,
                    name: person.title,
                    noteId: person.id,
                    route: person.route,
                  }}
                />
              ))}
            </span>
          ) : <Icon icon="person" size={13} aria-hidden="true" />}
          <span className="task-control-trigger-overflow">
            {selectedPeople.length === 0
              ? emptyLabel
              : selectedPeople.length === 1
                ? selectedPeople[0].title
                : `${selectedPeople.length} people`}
          </span>
        </span>
        <Icon icon="chevron-down" size={12} aria-hidden="true" />
      </button>
    </TaskControlPopover>
  );
}
