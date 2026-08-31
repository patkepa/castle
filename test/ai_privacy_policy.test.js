import assert from "node:assert/strict";
import test from "node:test";
import {
  defaultCastleAiPrivacyPolicy,
  externalContextAllowedByPolicy,
  externalRequestAllowedByPolicy,
} from "../apps/desktop/electron/ai/privacy_policy.ts";

const preview = {
  request: {
    requestId: "request_privacy",
    question: "Question",
    attachedNoteIds: [],
    searchLibrary: true,
  },
  provider: { kind: "external", name: "provider", model: "model" },
  citations: [
    {
      handle: "C1",
      noteId: "personal/private",
      title: "Private",
      route: "/note/personal/private",
      sourceFile: "personal/private.md",
      startLine: 1,
      endLine: 2,
      sourceRevision: "revision",
    },
  ],
  totalCharacters: 100,
};

test("denies external transmission by default", () => {
  assert.equal(
    externalContextAllowedByPolicy(defaultCastleAiPrivacyPolicy, preview),
    false,
  );
});

test("requires an enabled external policy before requesting approval", () => {
  assert.equal(externalRequestAllowedByPolicy(defaultCastleAiPrivacyPolicy), false);
  assert.equal(
    externalRequestAllowedByPolicy({
      ...defaultCastleAiPrivacyPolicy,
      externalTransmission: "confirm_each_request",
    }),
    true,
  );
});

test("applies note and section exclusions to an enabled policy", () => {
  assert.equal(
    externalContextAllowedByPolicy(
      {
        schemaVersion: 1,
        externalTransmission: "allow",
        excludedSections: ["personal"],
        excludedNoteIds: [],
      },
      preview,
    ),
    false,
  );
  assert.equal(
    externalContextAllowedByPolicy(
      {
        schemaVersion: 1,
        externalTransmission: "confirm_each_request",
        excludedSections: [],
        excludedNoteIds: [],
      },
      preview,
    ),
    true,
  );
});
