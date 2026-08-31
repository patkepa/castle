import assert from "node:assert/strict";
import test from "node:test";
import { resolveCodexExecutable } from "../electron/ai/chat_provider.ts";

test("uses an explicit Castle Codex executable when it exists", () => {
  assert.equal(
    resolveCodexExecutable({ CASTLE_CODEX_PATH: process.execPath, PATH: "" }),
    process.execPath,
  );
});

test("rejects a missing explicit Castle Codex executable", () => {
  assert.equal(
    resolveCodexExecutable({ CASTLE_CODEX_PATH: "/missing/castle-codex", PATH: "" }),
    null,
  );
});
