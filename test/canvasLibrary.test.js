import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createManagedCanvas,
  listManagedCanvases,
  readManagedCanvas,
  saveManagedCanvas,
} from "../apps/desktop/electron/canvas_library.ts";

test("creates, lists, reads, and atomically saves managed canvas files", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "castle-canvas-"));
  const libraryRoot = path.join(root, "library");
  await mkdir(libraryRoot);
  const initial = '{"nodes":[],"edges":[]}\n';
  const created = await createManagedCanvas(libraryRoot, "summer_plan.canvas", initial);
  assert.equal(created.name, "summer_plan.canvas");
  assert.deepEqual((await listManagedCanvases(libraryRoot)).map(({ relativePath }) => relativePath), ["summer_plan.canvas"]);
  assert.equal(await readManagedCanvas(libraryRoot, "summer_plan.canvas"), initial);

  const updated = '{"nodes":[{"id":"a","type":"text","x":0,"y":0,"width":200,"height":120,"text":"Idea"}],"edges":[]}\n';
  await saveManagedCanvas(libraryRoot, "summer_plan.canvas", updated);
  assert.equal(await readFile(path.join(libraryRoot, "canvas", "summer_plan.canvas"), "utf8"), updated);
});

test("rejects canvas traversal and symlink escapes", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "castle-canvas-secure-"));
  const libraryRoot = path.join(root, "library");
  const canvasRoot = path.join(libraryRoot, "canvas");
  await mkdir(canvasRoot, { recursive: true });
  await writeFile(path.join(root, "private.canvas"), "{}", "utf8");
  await symlink(path.join(root, "private.canvas"), path.join(canvasRoot, "linked.canvas"));

  await assert.rejects(readManagedCanvas(libraryRoot, "../private.canvas"), /outside/);
  await assert.rejects(readManagedCanvas(libraryRoot, "linked.canvas"), /outside/);
  assert.deepEqual(await listManagedCanvases(libraryRoot), []);
});

test("does not overwrite an existing canvas when creating", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "castle-canvas-existing-"));
  const libraryRoot = path.join(root, "library");
  await mkdir(path.join(libraryRoot, "canvas"), { recursive: true });
  await writeFile(path.join(libraryRoot, "canvas", "ideas.canvas"), "{}", "utf8");
  await assert.rejects(
    createManagedCanvas(libraryRoot, "ideas.canvas", '{"nodes":[],"edges":[]}'),
    /EEXIST/,
  );
});
