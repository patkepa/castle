import { useState } from "react";
import { focusResetChecklist } from "./checklists/focus_reset";
import { quickResetChecklist } from "./checklists/quick_reset";

const checklists = [quickResetChecklist, focusResetChecklist] as const;
type ChecklistId = (typeof checklists)[number]["id"];

export function ChecklistsTool() {
  const [selectedChecklistId, setSelectedChecklistId] =
    useState<ChecklistId>("quick-reset");
  const [checkedItemIds, setCheckedItemIds] = useState<Set<string>>(
    () => new Set(),
  );
  const selectedChecklist =
    checklists.find((checklist) => checklist.id === selectedChecklistId) ??
    checklists[0];
  const checkedCount = selectedChecklist.items.reduce(
    (count, item) =>
      count + (checkedItemIds.has(itemKey(selectedChecklist.id, item.id)) ? 1 : 0),
    0,
  );

  const toggleItem = (checklistId: ChecklistId, itemId: string) => {
    const key = itemKey(checklistId, itemId);

    setCheckedItemIds((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <section aria-label="Checklists" className="checklists-tool">
      <aside className="checklists-browser" aria-label="Available checklists">
        <header className="checklists-browser-header">
          <span>Checklists</span>
          <small>{checklists.length}</small>
        </header>
        <div className="checklists-browser-list">
          {checklists.map((checklist) => {
            const isSelected = checklist.id === selectedChecklist.id;

            return (
              <button
                aria-pressed={isSelected}
                className="checklists-browser-item"
                key={checklist.id}
                onClick={() => setSelectedChecklistId(checklist.id)}
                type="button"
              >
                <span>{checklist.label}</span>
                <small>{checklist.items.length} items</small>
              </button>
            );
          })}
        </div>
      </aside>

      <article className="checklist-detail">
        <header className="checklist-detail-header">
          <div>
            <p>Checklist</p>
            <h1>{selectedChecklist.label}</h1>
            <span>{selectedChecklist.description}</span>
          </div>
          <strong aria-live="polite">
            {checkedCount} / {selectedChecklist.items.length}
          </strong>
        </header>

        <div className="checklist-progress" aria-hidden="true">
          <span
            style={{
              width: `${(checkedCount / selectedChecklist.items.length) * 100}%`,
            }}
          />
        </div>

        <div className="checklist-items">
          {selectedChecklist.items.map((item) => {
            const key = itemKey(selectedChecklist.id, item.id);
            const isChecked = checkedItemIds.has(key);

            return (
              <label className="checklist-item" key={item.id}>
                <input
                  checked={isChecked}
                  onChange={() => toggleItem(selectedChecklist.id, item.id)}
                  type="checkbox"
                />
                <span className="checklist-item-box" aria-hidden="true">
                  <svg viewBox="0 0 16 16">
                    <path d="m3.5 8.25 2.8 2.8 6.2-6.2" />
                  </svg>
                </span>
                <span className="checklist-item-label">{item.label}</span>
              </label>
            );
          })}
        </div>

        <footer className="checklist-detail-footer">
          Progress is temporary and resets when you leave this tool.
        </footer>
      </article>
    </section>
  );
}

function itemKey(checklistId: ChecklistId, itemId: string) {
  return `${checklistId}:${itemId}`;
}
