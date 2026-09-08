import { useCallback, useRef, useState } from "react";
import { useCastlePlatform } from "../../platform/castle_platform_provider";
import type { CalendarEvent, Note, Project } from "../../types";
import {
  buildCalendarEventMarkdown,
  createCalendarEventIdentity,
  destinationSourceFileForEvent,
  type CalendarEventFormValues,
} from "./calendarEventMarkdown";

interface DeletedCalendarEvent {
  event: CalendarEvent;
  sourceFile: string;
  trashId: string;
}

export function useCalendarEventMutations({
  events,
  projects,
  people,
}: {
  events: CalendarEvent[];
  projects: Project[];
  people: Note[];
}) {
  const platform = useCastlePlatform();
  const mutations = platform.contentMutations;
  const busyRef = useRef(false);
  const [busyEventId, setBusyEventId] = useState<string | null>(null);
  const [mutationLabel, setMutationLabel] = useState("");
  const [error, setError] = useState("");
  const [deletedEvent, setDeletedEvent] = useState<DeletedCalendarEvent | null>(null);
  const canEdit = Boolean(platform.capabilities.editContent && mutations);
  const canCreate = Boolean(platform.capabilities.createContent && mutations);
  const canDelete = Boolean(platform.capabilities.deleteContent && mutations);

  const createEvent = useCallback(async (values: CalendarEventFormValues) => {
    if (!mutations || !platform.capabilities.createContent || busyRef.current) {
      return false;
    }
    const identity = createCalendarEventIdentity(values, events);
    busyRef.current = true;
    setBusyEventId("new-event");
    setMutationLabel("Creating event…");
    setError("");
    try {
      await mutations.createSource({
        noteId: identity.noteId,
        sourceFile: identity.sourceFile,
        markdown: buildCalendarEventMarkdown({
          id: identity.id,
          values,
          projects,
          people,
        }),
      });
      return true;
    } catch (reason) {
      setError(calendarMutationError(reason));
      return false;
    } finally {
      busyRef.current = false;
      setBusyEventId(null);
      setMutationLabel("");
    }
  }, [events, mutations, people, platform.capabilities.createContent, projects]);

  const saveEvent = useCallback(async (
    event: CalendarEvent,
    values: CalendarEventFormValues,
  ) => {
    if (!mutations || !platform.capabilities.editContent || busyRef.current) {
      return false;
    }
    busyRef.current = true;
    setBusyEventId(event.id);
    setMutationLabel("Saving event…");
    setError("");
    try {
      const source = await mutations.readSource(event.noteId);
      const result = await mutations.saveSource({
        noteId: source.noteId,
        sourceFile: source.sourceFile,
        markdown: buildCalendarEventMarkdown({
          id: event.id,
          values,
          projects,
          people,
          originalMarkdown: source.markdown,
        }),
        expectedRevision: source.revision,
      });
      const destination = destinationSourceFileForEvent(source.sourceFile, values);
      if (
        destination !== source.sourceFile &&
        platform.capabilities.moveContent
      ) {
        await mutations.moveSource({
          noteId: source.noteId,
          sourceFile: source.sourceFile,
          destinationSourceFile: destination,
          expectedRevision: result.revision,
        });
      }
      return true;
    } catch (reason) {
      setError(calendarMutationError(reason));
      return false;
    } finally {
      busyRef.current = false;
      setBusyEventId(null);
      setMutationLabel("");
    }
  }, [mutations, people, platform.capabilities.editContent, platform.capabilities.moveContent, projects]);

  const deleteEvent = useCallback(async (event: CalendarEvent) => {
    if (!mutations || !platform.capabilities.deleteContent || busyRef.current) {
      return false;
    }
    busyRef.current = true;
    setBusyEventId(event.id);
    setMutationLabel("Deleting event…");
    setError("");
    try {
      const source = await mutations.readSource(event.noteId);
      const result = await mutations.deleteSource({
        noteId: source.noteId,
        sourceFile: source.sourceFile,
        expectedRevision: source.revision,
      });
      setDeletedEvent({
        event,
        sourceFile: result.sourceFile,
        trashId: result.trashId,
      });
      return true;
    } catch (reason) {
      setError(calendarMutationError(reason));
      return false;
    } finally {
      busyRef.current = false;
      setBusyEventId(null);
      setMutationLabel("");
    }
  }, [mutations, platform.capabilities.deleteContent]);

  const restoreDeletedEvent = useCallback(async () => {
    if (!deletedEvent || !mutations || busyRef.current) return false;
    busyRef.current = true;
    setBusyEventId(deletedEvent.event.id);
    setMutationLabel("Restoring event…");
    setError("");
    try {
      await mutations.restoreSource({
        noteId: deletedEvent.event.noteId,
        sourceFile: deletedEvent.sourceFile,
        trashId: deletedEvent.trashId,
      });
      setDeletedEvent(null);
      return true;
    } catch (reason) {
      setError(calendarMutationError(reason));
      return false;
    } finally {
      busyRef.current = false;
      setBusyEventId(null);
      setMutationLabel("");
    }
  }, [deletedEvent, mutations]);

  return {
    busyEventId,
    mutationLabel,
    error,
    deletedEvent,
    canEdit,
    canCreate,
    canDelete,
    createEvent,
    saveEvent,
    deleteEvent,
    restoreDeletedEvent,
    clearError: () => setError(""),
    dismissDeletedEvent: () => setDeletedEvent(null),
  };
}

function calendarMutationError(reason: unknown) {
  return reason instanceof Error && reason.message
    ? reason.message
    : "Castle could not update that calendar event.";
}
