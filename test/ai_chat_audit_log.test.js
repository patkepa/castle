import assert from "node:assert/strict";
import test from "node:test";
import { CastleChatAuditLog } from "../apps/desktop/electron/ai/chat_audit_log.ts";
import { parseCastleChatAuditSnapshot } from "../apps/desktop/src/platform/ai_chat.ts";

test("keeps bounded aggregate chat audit data without retaining personal context", () => {
  const instants = [
    new Date("2026-08-02T12:00:00.000Z"),
    new Date("2026-08-02T12:00:00.125Z"),
  ];
  const audit = new CastleChatAuditLog(1, () => instants.shift());
  audit.begin("request_12345678");
  audit.observe({
    type: "context",
    requestId: "request_12345678",
    provider: { kind: "local", name: "Local", model: "local-v1" },
    externalTransmission: false,
    toolNames: ["search_knowledge", "read_note"],
    toolCallCount: 2,
    citations: [
      {
        handle: "C1",
        noteId: "personal/secret-note",
        title: "Secret title",
        route: "/note/personal/secret-note",
        sourceFile: "personal/secret-note.md",
        startLine: 1,
        endLine: 2,
        sourceRevision: "secret-revision",
      },
    ],
  });
  audit.observe({
    type: "delta",
    requestId: "request_12345678",
    text: "A sensitive answer",
  });
  audit.observe({
    type: "complete",
    requestId: "request_12345678",
    citations: [],
    unsupportedCitationHandles: ["C9"],
  });

  const snapshot = parseCastleChatAuditSnapshot(audit.snapshot());
  assert.equal(snapshot.entries[0].durationMilliseconds, 125);
  assert.equal(snapshot.entries[0].sourceCount, 1);
  assert.equal(snapshot.entries[0].responseCharacters, 18);
  assert.equal(snapshot.entries[0].unsupportedCitationCount, 1);
  assert.deepEqual(snapshot.entries[0].toolNames, [
    "search_knowledge",
    "read_note",
  ]);
  assert.equal(snapshot.entries[0].toolCallCount, 2);
  assert.doesNotMatch(
    JSON.stringify(snapshot),
    /sensitive|secret-note|Secret title|secret-revision/u,
  );
  assert.equal(audit.clear().entries.length, 0);
});
