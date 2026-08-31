import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import path from "node:path";
import {
  CASTLE_CONTENT_CONTRACT_VERSION,
  CASTLE_RPC_PROTOCOL_VERSION,
  parseCastleContract,
  type ServiceState,
} from "@castle/contracts";
import {
  parseCastleContentDelta,
  parseCastleSourceChange,
} from "../src/platform/desktop_bridge";
import type {
  CastleContentDelta,
  CastleSourceChange,
} from "../src/platform/castle_platform";
import {
  nativeMethodSpecs,
  type CastleNativeLane,
  type CastleNativeMethod,
  type CastleNativeParams,
  type CastleNativeResult,
} from "./native_contract";

export type CastleNativeState = ServiceState;

interface NativeErrorPayload {
  code?: string;
  message?: string;
  retryable?: boolean;
}

interface NativeRequest {
  id: number;
  method: CastleNativeMethod;
  params: unknown;
  lane: CastleNativeLane;
  timeoutMilliseconds: number;
  parse(value: unknown): unknown;
  resolve(value: unknown): void;
  reject(reason: Error): void;
  signal?: AbortSignal;
  abortListener?: () => void;
  timeout?: NodeJS.Timeout;
  callerSettled: boolean;
}

export interface CastleNativeRequestOptions {
  signal?: AbortSignal;
  timeoutMilliseconds?: number;
}

const maximumQueuedRequests = 256;
const maximumConcurrentReads = 8;
const readyTimeoutMilliseconds = 20_000;

export interface CastleNativeServiceOptions {
  binaryPath: string;
  libraryRoot: string;
  repositoryRoot: string;
  cacheRoot: string;
  processFactory?: (
    binaryPath: string,
    arguments_: string[],
  ) => ChildProcessWithoutNullStreams;
  readyTimeoutMilliseconds?: number;
  maximumQueuedRequests?: number;
  maximumConcurrentReads?: number;
}

export class CastleNativeError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly requestId?: number;

  constructor(payload: NativeErrorPayload, requestId?: number) {
    super(payload.message || "Castle native service failed.");
    this.name = "CastleNativeError";
    this.code = payload.code || "CASTLE_NATIVE_ERROR";
    this.retryable = payload.retryable === true;
    this.requestId = requestId;
  }
}

export class CastleNativeService {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly pending = new Map<number, NativeRequest>();
  private readonly queue: NativeRequest[] = [];
  private readonly snapshotListeners = new Set<(state: CastleNativeState) => void>();
  private readonly sourceChangeListeners = new Set<(change: CastleSourceChange) => void>();
  private readonly contentDeltaListeners = new Set<(delta: CastleContentDelta) => void>();
  private readonly errorListeners = new Set<(reason: Error) => void>();
  private readonly exitListeners = new Set<(reason: Error) => void>();
  private nextRequestId = 1;
  private stopped = false;
  private readyResolve!: (state: CastleNativeState) => void;
  private readyReject!: (reason: Error) => void;
  private readonly readyPromise: Promise<CastleNativeState>;
  private readonly readyTimeout: NodeJS.Timeout;
  private currentState: CastleNativeState | null = null;
  private activeReads = 0;
  private activeWrite = false;
  private exited = false;
  private readonly maximumQueuedRequests: number;
  private readonly maximumConcurrentReads: number;

  private constructor(options: CastleNativeServiceOptions) {
    this.maximumQueuedRequests = options.maximumQueuedRequests ?? maximumQueuedRequests;
    this.maximumConcurrentReads =
      options.maximumConcurrentReads ?? maximumConcurrentReads;
    this.readyPromise = new Promise<CastleNativeState>((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
    });
    const arguments_ = [
      "daemon",
      "--library",
      options.libraryRoot,
      "--repository",
      options.repositoryRoot,
      "--cache",
      options.cacheRoot,
    ];
    this.child = options.processFactory
      ? options.processFactory(options.binaryPath, arguments_)
      : spawn(options.binaryPath, arguments_, {
          stdio: ["pipe", "pipe", "pipe"],
          windowsHide: true,
        });
    this.readyTimeout = setTimeout(() => {
      this.handleExit(new CastleNativeError({
        code: "CASTLE_NATIVE_READY_TIMEOUT",
        message: "Castle native service did not complete its protocol handshake.",
        retryable: true,
      }));
      this.child.kill();
    }, options.readyTimeoutMilliseconds ?? readyTimeoutMilliseconds);
    this.readyTimeout.unref();
    const lines = createInterface({ input: this.child.stdout });
    lines.on("line", (line) => this.handleLine(line));
    this.child.stderr.setEncoding("utf8");
    this.child.stderr.on("data", (chunk: string) => {
      const message = chunk.trim();
      if (message) console.error(`[castle:native] ${message}`);
    });
    this.child.once("error", (reason) => this.handleExit(reason));
    this.child.once("exit", (code, signal) => {
      if (this.stopped && code === 0) return;
      this.handleExit(
        new Error(
          `Castle native service exited unexpectedly (${signal ?? code ?? "unknown"}).`,
        ),
      );
    });
  }

  static async start(options: CastleNativeServiceOptions) {
    const service = new CastleNativeService(options);
    await service.readyPromise;
    return service;
  }

  get state() {
    if (!this.currentState) {
      throw new Error("Castle native service is not ready.");
    }
    return this.currentState;
  }

  request<Method extends CastleNativeMethod>(
    method: Method,
    params: CastleNativeParams<Method>,
    options: CastleNativeRequestOptions = {},
  ): Promise<CastleNativeResult<Method>> {
    if (this.stopped) {
      return Promise.reject(new Error("Castle native service has stopped."));
    }
    if (options.signal?.aborted) {
      return Promise.reject(abortError(method));
    }
    if (this.queue.length + this.pending.size >= this.maximumQueuedRequests) {
      return Promise.reject(new CastleNativeError({
        code: "CASTLE_NATIVE_BACKPRESSURE",
        message: "Castle native service has too many queued requests.",
        retryable: true,
      }));
    }

    const spec = nativeMethodSpecs[method];
    const id = this.nextRequestId++;
    return new Promise<CastleNativeResult<Method>>((resolve, reject) => {
      const request: NativeRequest = {
        id,
        method,
        params,
        lane: spec.lane,
        timeoutMilliseconds:
          options.timeoutMilliseconds ?? spec.timeoutMilliseconds,
        parse: spec.parse,
        resolve: (value) => resolve(value as CastleNativeResult<Method>),
        reject,
        signal: options.signal,
        callerSettled: false,
      };
      if (options.signal) {
        request.abortListener = () => this.abortRequest(request);
        options.signal.addEventListener("abort", request.abortListener, { once: true });
      }
      this.queue.push(request);
      this.pumpQueue();
    });
  }

  onSnapshotChanged(listener: (state: CastleNativeState) => void) {
    this.snapshotListeners.add(listener);
    return () => this.snapshotListeners.delete(listener);
  }

  onSourceChanged(listener: (change: CastleSourceChange) => void) {
    this.sourceChangeListeners.add(listener);
    return () => this.sourceChangeListeners.delete(listener);
  }

  onContentDelta(listener: (delta: CastleContentDelta) => void) {
    this.contentDeltaListeners.add(listener);
    return () => this.contentDeltaListeners.delete(listener);
  }

  onSnapshotError(listener: (reason: Error) => void) {
    this.errorListeners.add(listener);
    return () => this.errorListeners.delete(listener);
  }

  onExit(listener: (reason: Error) => void) {
    this.exitListeners.add(listener);
    return () => this.exitListeners.delete(listener);
  }

  stop() {
    if (this.stopped) return;
    this.stopped = true;
    clearTimeout(this.readyTimeout);
    const reason = new Error("Castle native service has stopped.");
    this.rejectAll(reason);
    this.writeMessage({
      id: this.nextRequestId++,
      method: "shutdown",
      params: {},
    });
    this.child.stdin.end();
    const timeout = setTimeout(() => this.child.kill(), 2_000);
    timeout.unref();
  }

  private pumpQueue() {
    if (this.stopped || this.activeWrite) return;
    while (
      this.queue.length > 0 &&
      this.activeReads < this.maximumConcurrentReads
    ) {
      const request = this.queue[0];
      if (request.lane === "write") {
        if (this.activeReads > 0) return;
        this.queue.shift();
        this.activeWrite = true;
        this.startRequest(request);
        return;
      }
      this.queue.shift();
      this.activeReads += 1;
      this.startRequest(request);
    }
  }

  private startRequest(request: NativeRequest) {
    this.pending.set(request.id, request);
    request.timeout = setTimeout(
      () => this.timeoutRequest(request),
      request.timeoutMilliseconds,
    );
    request.timeout.unref();
    this.writeMessage(
      { id: request.id, method: request.method, params: request.params },
      (reason) => {
        if (reason) this.failTransport(request, reason);
      },
    );
  }

  private abortRequest(request: NativeRequest) {
    if (request.callerSettled) return;
    request.callerSettled = true;
    request.reject(abortError(request.method));
    const queuedIndex = this.queue.indexOf(request);
    if (queuedIndex >= 0) {
      this.queue.splice(queuedIndex, 1);
      this.cleanRequest(request);
      this.pumpQueue();
      return;
    }
    if (this.pending.has(request.id)) this.sendCancellation(request.id);
  }

  private timeoutRequest(request: NativeRequest) {
    if (request.callerSettled) return;
    request.callerSettled = true;
    request.reject(new CastleNativeError({
      code: "CASTLE_NATIVE_TIMEOUT",
      message: `Castle native method ${request.method} timed out after ${request.timeoutMilliseconds} ms.`,
      retryable: request.lane === "read",
    }, request.id));
    this.sendCancellation(request.id);
  }

  private sendCancellation(requestId: number) {
    if (
      !this.currentState?.protocol.capabilities.includes("requestCancellation")
    ) {
      return;
    }
    this.writeMessage({
      id: this.nextRequestId++,
      method: "cancelRequest",
      params: { requestId },
    });
  }

  private handleLine(line: string) {
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      this.notifyError(new Error("Castle native service returned invalid JSON."));
      return;
    }
    if (!isRecord(message)) return;
    if (message.protocolVersion !== CASTLE_RPC_PROTOCOL_VERSION) {
      const error = new CastleNativeError({
        code: "CASTLE_NATIVE_PROTOCOL_MISMATCH",
        message: "Castle native service returned an incompatible protocol envelope.",
        retryable: false,
      });
      this.handleExit(error);
      this.child.kill();
      return;
    }
    try {
      if (message.event === "ready") {
        const state = parseState(message.data);
        clearTimeout(this.readyTimeout);
        this.currentState = state;
        this.readyResolve(state);
        return;
      }
      if (message.event === "snapshotChanged") {
        const state = parseState(message.data);
        this.currentState = state;
        for (const listener of this.snapshotListeners) listener(state);
        return;
      }
      if (message.event === "sourceChanged") {
        const change = parseCastleSourceChange(message.data);
        for (const listener of this.sourceChangeListeners) listener(change);
        return;
      }
      if (message.event === "contentDelta") {
        const delta = parseCastleContentDelta(message.data);
        for (const listener of this.contentDeltaListeners) listener(delta);
        return;
      }
      if (message.event === "snapshotError") {
        this.notifyError(new CastleNativeError(asErrorPayload(message.error)));
        return;
      }
      if (typeof message.id !== "number") return;
      const request = this.pending.get(message.id);
      if (!request) return;
      if (message.error) {
        if (!request.callerSettled) {
          request.callerSettled = true;
          request.reject(new CastleNativeError(asErrorPayload(message.error), request.id));
        }
      } else if (!request.callerSettled) {
        const result = request.parse(message.result);
        request.callerSettled = true;
        request.resolve(result);
      }
      this.finishRequest(request);
    } catch (reason) {
      const error = reason instanceof Error ? reason : new Error(String(reason));
      if (typeof message.id === "number") {
        const request = this.pending.get(message.id);
        if (request) {
          if (!request.callerSettled) request.reject(error);
          this.finishRequest(request);
          return;
        }
      }
      this.notifyError(error);
    }
  }

  private failTransport(request: NativeRequest, reason: Error) {
    if (!this.pending.has(request.id)) return;
    if (!request.callerSettled) {
      request.callerSettled = true;
      request.reject(reason);
    }
    this.finishRequest(request);
  }

  private finishRequest(request: NativeRequest) {
    this.pending.delete(request.id);
    this.cleanRequest(request);
    if (request.lane === "write") this.activeWrite = false;
    else this.activeReads = Math.max(0, this.activeReads - 1);
    this.pumpQueue();
  }

  private cleanRequest(request: NativeRequest) {
    if (request.timeout) clearTimeout(request.timeout);
    if (request.signal && request.abortListener) {
      request.signal.removeEventListener("abort", request.abortListener);
    }
  }

  private handleExit(reason: Error) {
    if (this.exited) return;
    this.exited = true;
    this.stopped = true;
    clearTimeout(this.readyTimeout);
    this.readyReject(reason);
    this.rejectAll(reason);
    for (const listener of this.exitListeners) listener(reason);
  }

  private rejectAll(reason: Error) {
    for (const request of [...this.queue, ...this.pending.values()]) {
      if (!request.callerSettled) request.reject(reason);
      this.cleanRequest(request);
    }
    this.queue.length = 0;
    this.pending.clear();
    this.activeReads = 0;
    this.activeWrite = false;
  }

  private writeMessage(
    message: Record<string, unknown>,
    callback?: (reason?: Error | null) => void,
  ) {
    this.child.stdin.write(
      `${JSON.stringify({ protocolVersion: CASTLE_RPC_PROTOCOL_VERSION, ...message })}\n`,
      callback,
    );
  }

  private notifyError(reason: Error) {
    for (const listener of this.errorListeners) listener(reason);
  }
}

export function resolveCastleNativeBinary(options: {
  appRoot: string;
  repositoryRoot?: string;
  isPackaged: boolean;
  resourcesPath: string;
  platform: NodeJS.Platform;
}) {
  const executableName = options.platform === "win32" ? "castle.exe" : "castle";
  return options.isPackaged
    ? path.join(options.resourcesPath, executableName)
    : path.join(
        options.repositoryRoot ?? options.appRoot,
        "native",
        "target",
        "release",
        executableName,
      );
}

function parseState(value: unknown): CastleNativeState {
  const state = parseCastleContract("ServiceState", value);
  if (
    state.protocol.protocolVersion !== CASTLE_RPC_PROTOCOL_VERSION ||
    state.protocol.contentContractVersion !== CASTLE_CONTENT_CONTRACT_VERSION
  ) {
    throw new CastleNativeError({
      code: "CASTLE_NATIVE_PROTOCOL_MISMATCH",
      message:
        `Castle native protocol ${state.protocol.protocolVersion}/${state.protocol.contentContractVersion} ` +
        `does not match desktop protocol ${CASTLE_RPC_PROTOCOL_VERSION}/${CASTLE_CONTENT_CONTRACT_VERSION}.`,
      retryable: false,
    });
  }
  return state;
}

function asErrorPayload(value: unknown): NativeErrorPayload {
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function abortError(method: CastleNativeMethod) {
  const error = new Error(`Castle native method ${method} was cancelled.`);
  error.name = "AbortError";
  return error;
}
