import assert from "node:assert/strict";
import test from "node:test";
import {
  getExternalWebUrl,
  getStashPreviewBlocks,
  getYouTubeVideoId,
  groupStashNotes,
} from "../apps/desktop/src/features/stash/stashPresentation.ts";

test("groups Stash files by creation day and orders newest first", () => {
  const morning = note("morning", new Date(2026, 7, 2, 9));
  const evening = note("evening", new Date(2026, 7, 2, 19));
  const yesterday = note("yesterday", new Date(2026, 7, 1, 12));

  const groups = groupStashNotes([morning, yesterday, evening]);

  assert.deepEqual(groups.map(({ id }) => id), ["2026-08-02", "2026-08-01"]);
  assert.deepEqual(groups[0].notes.map(({ id }) => id), ["evening", "morning"]);
  assert.deepEqual(groups[1].notes.map(({ id }) => id), ["yesterday"]);
});

test("recognizes common YouTube video URLs without accepting unsafe lookalikes", () => {
  assert.equal(
    getYouTubeVideoId("https://www.youtube.com/watch?v=QrgGy-pki1Y"),
    "QrgGy-pki1Y",
  );
  assert.equal(
    getYouTubeVideoId("https://youtu.be/QrgGy-pki1Y?t=30"),
    "QrgGy-pki1Y",
  );
  assert.equal(
    getYouTubeVideoId("https://www.youtube.com/shorts/QrgGy-pki1Y"),
    "QrgGy-pki1Y",
  );
  assert.equal(
    getYouTubeVideoId("https://youtube.com.example.com/watch?v=QrgGy-pki1Y"),
    null,
  );
  assert.equal(
    getYouTubeVideoId("ftp://www.youtube.com/watch?v=QrgGy-pki1Y"),
    null,
  );
  assert.equal(getYouTubeVideoId("javascript:alert(1)"), null);
});

test("groups standalone web links into preview lists", () => {
  assert.deepEqual(
    getStashPreviewBlocks(
      "Useful references\nhttps://example.com/one\nhttps://example.com/two\n\nKeep these handy.",
    ),
    [
      { kind: "text", text: "Useful references" },
      {
        kind: "links",
        links: ["https://example.com/one", "https://example.com/two"],
      },
      { kind: "text", text: "Keep these handy." },
    ],
  );
  assert.equal(getExternalWebUrl("https://example.com/page"), "https://example.com/page");
  assert.equal(getExternalWebUrl("javascript:alert(1)"), null);
  assert.equal(getExternalWebUrl("not a link"), null);
});

function note(id, createdAt) {
  return {
    id,
    createdAt: createdAt.toISOString(),
    modifiedAt: createdAt.toISOString(),
  };
}
