import { useMemo, useState } from "react";
import type { Note } from "../types";
import { groupStashNotes } from "../features/stash/stashPresentation";
import { StashNoteTile } from "./StashNoteTile";

const stashPageSize = 24;

export function StashList({ notes }: { notes: readonly Note[] }) {
  const [visibleCount, setVisibleCount] = useState(stashPageSize);
  const groups = useMemo(() => groupStashNotes(notes), [notes]);
  const visibleGroups = useMemo(() => {
    let remaining = visibleCount;

    return groups.flatMap((group) => {
      if (remaining <= 0) return [];
      const visibleNotes = group.notes.slice(0, remaining);
      remaining -= visibleNotes.length;
      return [{ ...group, notes: visibleNotes, totalCount: group.notes.length }];
    });
  }, [groups, visibleCount]);
  const shownCount = Math.min(visibleCount, notes.length);
  const remainingCount = notes.length - shownCount;

  return (
    <>
      {visibleGroups.map((group) => (
        <section className="stash-day-group" key={group.id}>
          <header className="stash-day-heading">
            <h2>
              <time dateTime={group.id}>{group.label}</time>
            </h2>
            <span>
              {group.totalCount}{" "}
              {group.totalCount === 1 ? "item" : "items"}
            </span>
          </header>
          <div className="stash-day-items">
            {group.notes.map((note) => (
              <StashNoteTile key={note.id} note={note} />
            ))}
          </div>
        </section>
      ))}
      {remainingCount > 0 ? (
        <div className="stash-load-more">
          <button
            type="button"
            onClick={() =>
              setVisibleCount((current) =>
                Math.min(current + stashPageSize, notes.length),
              )
            }
          >
            <span>Load {Math.min(stashPageSize, remainingCount)} more</span>
            <small>{remainingCount} remaining</small>
          </button>
        </div>
      ) : null}
    </>
  );
}
