import assert from "node:assert/strict";
import test from "node:test";
import {
  reorderProjectIds,
} from "../apps/desktop/src/features/tasks/TasksPage.tsx";
import { createProjectSeed } from "../apps/desktop/src/lib/projectCreation.ts";

test("creates a snake_case project record in the project root convention", () => {
  const project = createProjectSeed("Mój Nowy Projekt", []);

  assert.equal(project.id, "project_mój_nowy_projekt");
  assert.equal(project.source.noteId, project.id);
  assert.equal(
    project.source.sourceFile,
    "projects/mój_nowy_projekt/mój_nowy_projekt.md",
  );
  assert.match(project.source.markdown, /type: project/);
  assert.match(project.source.markdown, /title: "Mój Nowy Projekt"/);
});

test("adds a stable suffix when a project id already exists", () => {
  const project = createProjectSeed("Castle", [
    { id: "project_castle" },
    { id: "project_castle_2" },
  ]);

  assert.equal(project.id, "project_castle_3");
});

test("reorders projects at the edge selected by the completed drop", () => {
  assert.deepEqual(
    reorderProjectIds(["first", "second", "third"], "first", "third", "after"),
    ["second", "third", "first"],
  );
  assert.deepEqual(
    reorderProjectIds(["first", "second", "third"], "third", "first", "before"),
    ["third", "first", "second"],
  );
});
