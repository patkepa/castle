import { useState } from "react";
import type { ShortcutCollection } from "../types";
import { ShortcutsPanel } from "./ShortcutsPanel";
import { TopbarTabs } from "./TopbarTabs";

export function ShortcutsPage({
  collections,
}: {
  collections: readonly ShortcutCollection[];
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedCollection =
    collections.find((collection) => collection.id === selectedId) ??
    collections[0];

  if (!selectedCollection) {
    return (
      <main className="shortcuts-page">
        <section className="shortcuts-empty">
          <h1>No shortcuts configured</h1>
          <p>
            Add a shortcut collection Markdown file under <code>library/shortcuts/</code>.
          </p>
        </section>
      </main>
    );
  }

  return (
    <main className="shortcuts-page">
      <TopbarTabs
        ariaLabel="Shortcut collections"
        onSelect={(id) => setSelectedId(id)}
        selectedId={selectedCollection.id}
        tabs={collections.map(({ id, label }) => ({ id, label }))}
      />
      <div className="shortcuts-page-content">
        <ShortcutsPanel shortcuts={selectedCollection.shortcuts} />
      </div>
    </main>
  );
}
