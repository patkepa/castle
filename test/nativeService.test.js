import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import test from "node:test";
import {
  CASTLE_CONTENT_CONTRACT_VERSION,
  CASTLE_RPC_PROTOCOL_VERSION,
} from "../src/generated/castle_contracts.ts";
import {
  CastleNativeError,
  CastleNativeService,
} from "../electron/native_service.ts";

class FakeNativeProcess extends EventEmitter {
  stdin = new PassThrough();
  stdout = new PassThrough();
  stderr = new PassThrough();
  killed = false;
  messages = [];

  constructor() {
    super();
    this.stdin.setEncoding("utf8");
    this.stdin.on("data", (chunk) => {
      for (const line of chunk.split("\n").filter(Boolean)) {
        this.messages.push(JSON.parse(line));
      }
    });
  }

  kill() {
    this.killed = true;
    return true;
  }

  emitMessage(message) {
    this.stdout.write(`${JSON.stringify({
      protocolVersion: CASTLE_RPC_PROTOCOL_VERSION,
      ...message,
    })}\n`);
  }
}

const serviceState = {
  protocol: {
    protocolVersion: CASTLE_RPC_PROTOCOL_VERSION,
    contentContractVersion: CASTLE_CONTENT_CONTRACT_VERSION,
    serverVersion: "test",
    capabilities: ["typedContracts", "requestCancellation"],
  },
  generatedAt: "2026-08-03T00:00:00Z",
  publicRoot: "/tmp/castle-test",
};

async function startFakeService(options = {}, state = serviceState) {
  const process = new FakeNativeProcess();
  const started = CastleNativeService.start({
    binaryPath: "/fake/castle",
    libraryRoot: "/fake/library",
    repositoryRoot: "/fake/repository",
    cacheRoot: "/fake/cache",
    processFactory: () => process,
    readyTimeoutMilliseconds: 100,
    ...options,
  });
  process.emitMessage({ event: "ready", data: state });
  return { process, service: await started };
}

function requestMessages(process) {
  return process.messages.filter((message) =>
    message.method !== "cancelRequest" && message.method !== "shutdown"
  );
}

test("native requests keep reads bounded and serialize writes behind them", async () => {
  const { process, service } = await startFakeService({
    maximumConcurrentReads: 2,
  });
  const reads = [
    service.request("getRelationshipGraph", {}),
    service.request("getRelationshipGraph", {}),
    service.request("getRelationshipGraph", {}),
  ];
  const refresh = service.request("refresh", {});
  assert.equal(requestMessages(process).length, 2);

  const [first, second] = requestMessages(process);
  process.emitMessage({ id: first.id, result: {} });
  assert.equal(requestMessages(process).length, 3);
  process.emitMessage({ id: second.id, result: {} });
  assert.equal(requestMessages(process).length, 3);

  const third = requestMessages(process)[2];
  process.emitMessage({ id: third.id, result: {} });
  assert.equal(requestMessages(process).length, 4);
  const write = requestMessages(process)[3];
  assert.equal(write.method, "refresh");
  process.emitMessage({ id: write.id, result: serviceState });

  assert.deepEqual(await Promise.all(reads), [{}, {}, {}]);
  assert.deepEqual(await refresh, serviceState);
  service.stop();
});

test("native requests propagate structured failures, timeouts, and cancellation", async () => {
  const { process, service } = await startFakeService();
  const failed = service.request("getRelationshipGraph", {});
  const failureRequest = requestMessages(process).at(-1);
  process.emitMessage({
    id: failureRequest.id,
    error: { code: "INDEX_BUSY", message: "Index is rebuilding.", retryable: true },
  });
  await assert.rejects(failed, (reason) => {
    assert.ok(reason instanceof CastleNativeError);
    assert.equal(reason.code, "INDEX_BUSY");
    assert.equal(reason.retryable, true);
    return true;
  });

  const keepTestAlive = setTimeout(() => {}, 100);
  const timedOut = service.request("getRelationshipGraph", {}, {
    timeoutMilliseconds: 5,
  });
  const timeoutRequest = requestMessages(process).at(-1);
  await assert.rejects(timedOut, (reason) => {
    assert.ok(reason instanceof CastleNativeError);
    assert.equal(reason.code, "CASTLE_NATIVE_TIMEOUT");
    return true;
  });
  clearTimeout(keepTestAlive);
  assert.ok(process.messages.some((message) =>
    message.method === "cancelRequest" &&
    message.params.requestId === timeoutRequest.id
  ));
  process.emitMessage({ id: timeoutRequest.id, result: {} });

  const controller = new AbortController();
  const cancelled = service.request("getRelationshipGraph", {}, {
    signal: controller.signal,
  });
  const cancelRequest = requestMessages(process).at(-1);
  controller.abort();
  await assert.rejects(cancelled, { name: "AbortError" });
  assert.ok(process.messages.some((message) =>
    message.method === "cancelRequest" &&
    message.params.requestId === cancelRequest.id
  ));
  process.emitMessage({ id: cancelRequest.id, result: {} });
  service.stop();
});

test("native requests only ask the server to cancel when it advertises support", async () => {
  const stateWithoutCancellation = {
    ...serviceState,
    protocol: { ...serviceState.protocol, capabilities: ["typedContracts"] },
  };
  const { process, service } = await startFakeService({}, stateWithoutCancellation);
  const controller = new AbortController();
  const request = service.request("getRelationshipGraph", {}, {
    signal: controller.signal,
  });
  const nativeRequest = requestMessages(process).at(-1);
  controller.abort();

  await assert.rejects(request, { name: "AbortError" });
  assert.equal(
    process.messages.some((message) => message.method === "cancelRequest"),
    false,
  );
  process.emitMessage({ id: nativeRequest.id, result: {} });
  service.stop();
});

test("native startup rejects incompatible protocol envelopes", async () => {
  const process = new FakeNativeProcess();
  const started = CastleNativeService.start({
    binaryPath: "/fake/castle",
    libraryRoot: "/fake/library",
    repositoryRoot: "/fake/repository",
    cacheRoot: "/fake/cache",
    processFactory: () => process,
    readyTimeoutMilliseconds: 100,
  });
  process.stdout.write(`${JSON.stringify({
    protocolVersion: CASTLE_RPC_PROTOCOL_VERSION + 1,
    event: "ready",
    data: serviceState,
  })}\n`);
  await assert.rejects(started, (reason) => {
    assert.ok(reason instanceof CastleNativeError);
    assert.equal(reason.code, "CASTLE_NATIVE_PROTOCOL_MISMATCH");
    return true;
  });
  assert.equal(process.killed, true);
});

test("native request queue applies backpressure and startup has a deadline", async () => {
  const { process, service } = await startFakeService({
    maximumQueuedRequests: 1,
  });
  const active = service.request("getRelationshipGraph", {});
  await assert.rejects(
    service.request("getRelationshipGraph", {}),
    (reason) => {
      assert.ok(reason instanceof CastleNativeError);
      assert.equal(reason.code, "CASTLE_NATIVE_BACKPRESSURE");
      return true;
    },
  );
  const request = requestMessages(process).at(-1);
  process.emitMessage({ id: request.id, result: {} });
  await active;
  service.stop();

  const stalledProcess = new FakeNativeProcess();
  const keepTestAlive = setTimeout(() => {}, 100);
  const stalled = CastleNativeService.start({
    binaryPath: "/fake/castle",
    libraryRoot: "/fake/library",
    repositoryRoot: "/fake/repository",
    cacheRoot: "/fake/cache",
    processFactory: () => stalledProcess,
    readyTimeoutMilliseconds: 5,
  });
  await assert.rejects(stalled, (reason) => {
    assert.ok(reason instanceof CastleNativeError);
    assert.equal(reason.code, "CASTLE_NATIVE_READY_TIMEOUT");
    return true;
  });
  clearTimeout(keepTestAlive);
  assert.equal(stalledProcess.killed, true);
});
