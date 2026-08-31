import assert from "node:assert/strict";
import test from "node:test";
import {
  canvasMediaAccept,
  canvasMediaKind,
  canvasMediaUrl,
} from "../apps/desktop/src/features/canvas/canvasMedia.ts";

test("recognizes Canvas image and PDF file types", () => {
  assert.equal(canvasMediaKind("photo.PNG"), "image");
  assert.equal(canvasMediaKind("diagram.webp"), "image");
  assert.equal(canvasMediaKind("agreement.pdf"), "pdf");
  assert.equal(canvasMediaKind("vector.svg"), null);
  assert.match(canvasMediaAccept, /\.pdf/);
});

test("resolves safe Canvas media references to published asset paths", () => {
  assert.equal(
    canvasMediaUrl("assets/canvas/holiday photo.png"),
    "/assets/canvas/holiday%20photo.png",
  );
  assert.equal(
    canvasMediaUrl("notes/reference.pdf"),
    "/content-assets/notes/reference.pdf",
  );
  assert.equal(canvasMediaUrl("../private.pdf"), "");
});
