import type { CastleChatCitation, CastleChatRequest } from "../../src/platform/ai_chat";

export const castleAiPolicySchemaVersion = 1;

export interface CastleAiPrivacyPolicy {
  schemaVersion: typeof castleAiPolicySchemaVersion;
  externalTransmission: "deny" | "confirm_each_request" | "allow";
  excludedSections: readonly string[];
  excludedNoteIds: readonly string[];
}

export interface ExternalContextPreview {
  request: CastleChatRequest;
  provider: { kind: "external"; name: string; model: string };
  citations: readonly CastleChatCitation[];
  totalCharacters: number;
}

export interface ExternalRequestPreview {
  request: CastleChatRequest;
  provider: { kind: "external"; name: string; model: string };
  maximumSources: number;
  maximumContextCharacters: number;
}

export type ExternalRequestAuthorizer = (
  preview: ExternalRequestPreview,
) => Promise<boolean>;

/**
 * Castle has no external provider configured by default. This policy therefore
 * denies every external transmission until the owner selects a provider and
 * explicitly changes the policy through a future settings flow.
 */
export const defaultCastleAiPrivacyPolicy: CastleAiPrivacyPolicy = Object.freeze({
  schemaVersion: castleAiPolicySchemaVersion,
  externalTransmission: "deny",
  excludedSections: Object.freeze([]),
  excludedNoteIds: Object.freeze([]),
});

export function externalContextAllowedByPolicy(
  policy: CastleAiPrivacyPolicy,
  preview: ExternalContextPreview,
) {
  if (policy.externalTransmission === "deny") return false;
  const excludedNotes = new Set(policy.excludedNoteIds);
  const excludedSections = new Set(policy.excludedSections);
  return preview.citations.every((citation) => {
    const section = citation.sourceFile.split("/", 1)[0] ?? "";
    return !excludedNotes.has(citation.noteId) && !excludedSections.has(section);
  });
}

export function externalRequestAllowedByPolicy(
  policy: CastleAiPrivacyPolicy,
) {
  return policy.externalTransmission !== "deny";
}
