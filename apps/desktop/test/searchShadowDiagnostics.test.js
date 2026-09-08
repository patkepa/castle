import assert from "node:assert/strict";
import test from "node:test";
import {
  getSearchShadowDiagnostics,
  recordSearchShadowComparison,
  resetSearchShadowDiagnostics,
  summarizeSearchShadowDiagnostics,
} from "../src/lib/searchShadowDiagnostics.ts";

test("records aggregate shadow-search quality without retaining result IDs", () => {
  resetSearchShadowDiagnostics();
  recordSearchShadowComparison({
    desktopResultIds: ["secret-a", "secret-b", "secret-c"],
    browserResultIds: ["secret-a", "secret-c", "secret-d"],
    comparedAt: new Date("2026-08-02T12:00:00.000Z"),
  });

  const snapshot = getSearchShadowDiagnostics();
  assert.deepEqual(snapshot, {
    comparisonCount: 1,
    desktopFailureCount: 0,
    browserFailureCount: 0,
    sameFirstResultCount: 1,
    exactOrderCount: 0,
    overlapAtTenTotal: 2,
    comparedResultCount: 2,
    rankDisplacementTotal: 1,
    lastComparedAt: "2026-08-02T12:00:00.000Z",
  });
  assert.doesNotMatch(JSON.stringify(snapshot), /secret/u);
  assert.deepEqual(summarizeSearchShadowDiagnostics(snapshot), {
    firstResultAgreement: 1,
    exactOrderAgreement: 0,
    meanOverlapAtTen: 2,
    meanRankDisplacement: 0.5,
  });
});

test("counts backend failures and resets process-local diagnostics", () => {
  resetSearchShadowDiagnostics();
  recordSearchShadowComparison({
    desktopFailed: true,
    browserFailed: true,
  });
  assert.equal(getSearchShadowDiagnostics().desktopFailureCount, 1);
  assert.equal(getSearchShadowDiagnostics().browserFailureCount, 1);
  assert.equal(resetSearchShadowDiagnostics().comparisonCount, 0);
  assert.deepEqual(summarizeSearchShadowDiagnostics(), {
    firstResultAgreement: null,
    exactOrderAgreement: null,
    meanOverlapAtTen: null,
    meanRankDisplacement: null,
  });
});
