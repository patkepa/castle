import type { Note } from "../types";

export function latestModifiedAt(notes: readonly Note[]) {
  return notes.reduce(
    (latest, note) =>
      Date.parse(note.modifiedAt) > Date.parse(latest)
        ? note.modifiedAt
        : latest,
    notes[0]?.modifiedAt ?? "",
  );
}
