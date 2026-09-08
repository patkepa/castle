import assert from "node:assert/strict";
import test from "node:test";
import { parseCastleIndexStatus } from "../src/platform/knowledge_queries.ts";

const provider = {
  provider: "fastembed_local",
  model: "intfloat/multilingual-e5-small",
  inputVersion:
    "e5_retrieval_v1_rev_0e60b8d_query_passage_prefix_mean_l2_max512_fastembed5",
  dimensions: 384,
  maximumBatchSize: 16,
};

test("parses typed local embedding diagnostics with aggregate scheduler state", () => {
  const status = parseCastleIndexStatus({
    state: "ready",
    manifest: {
      generation: "generation-2",
      sourceFingerprint: "source-1",
      indexSchemaVersion: 2,
      semanticAvailable: true,
      ignoredFutureField: true,
    },
    databasePath: "/private/cache/index.db",
    recoveredManifest: false,
    message: null,
    embedding: {
      state: "ready",
      local: true,
      modelReady: true,
      provider,
      scheduler: {
        state: "idle",
        provider,
        activeSourceFingerprint: null,
        queuedSourceFingerprint: null,
        publishedRuns: 1,
        cancelledRuns: 0,
        staleRuns: 0,
        failedRuns: 0,
        lastUniqueContentCount: 25,
        lastCacheHits: 20,
        lastGenerated: 5,
        lastPending: 0,
        lastRetries: 0,
        lastErrorClass: null,
      },
      lastErrorClass: null,
      message: null,
    },
  });

  assert.equal(status.embedding.local, true);
  assert.equal(status.embedding.provider.dimensions, 384);
  assert.equal(status.embedding.scheduler?.lastCacheHits, 20);
  assert.equal(status.manifest?.semanticAvailable, true);
});

test("rejects external or content-bearing embedding status shapes", () => {
  assert.throws(
    () =>
      parseCastleIndexStatus({
        state: "ready",
        manifest: null,
        databasePath: null,
        recoveredManifest: false,
        message: null,
        embedding: {
          state: "ready",
          local: false,
          modelReady: true,
          provider,
          scheduler: null,
          lastErrorClass: null,
          message: null,
        },
      }),
    /invalid embedding-status response/,
  );
});
