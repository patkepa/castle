import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, realpath, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  importCanvasMedia,
  resolveCanvasMedia,
} from "../electron/canvas_media_library.ts";

const png = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

test("imports Canvas media into portable library asset paths", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "castle-canvas-media-"));
  const libraryRoot = path.join(root, "library");
  await mkdir(libraryRoot);

  const media = await importCanvasMedia(libraryRoot, {
    name: "Summer photo.PNG",
    mimeType: "image/png",
    data: png.buffer,
  });

  assert.equal(media.kind, "image");
  assert.match(media.file, /^assets\/canvas\/[a-f0-9]{32}_summer_photo\.png$/);
  assert.deepEqual(
    await readFile(path.join(libraryRoot, ...media.file.split("/"))),
    Buffer.from(png),
  );
  assert.equal(
    await resolveCanvasMedia(libraryRoot, media.file),
    await realpath(path.join(libraryRoot, ...media.file.split("/"))),
  );
});

test("rejects invalid image data and library symlink escapes", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "castle-canvas-media-secure-"));
  const libraryRoot = path.join(root, "library");
  await mkdir(libraryRoot);

  await assert.rejects(
    importCanvasMedia(libraryRoot, {
      name: "pretend.png",
      mimeType: "image/png",
      data: Uint8Array.from([1, 2, 3]).buffer,
    }),
    /does not match/,
  );

  const outsideAssets = path.join(root, "outside-assets");
  await mkdir(outsideAssets);
  await symlink(outsideAssets, path.join(libraryRoot, "assets"));
  await assert.rejects(
    importCanvasMedia(libraryRoot, {
      name: "photo.png",
      mimeType: "image/png",
      data: png.buffer,
    }),
    /outside the selected library/,
  );
});
