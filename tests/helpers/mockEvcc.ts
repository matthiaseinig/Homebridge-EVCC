import { EventEmitter } from "node:events";
import { vi } from "vitest";
import type WebSocket from "ws";

/** Minimal Response shape for our fetchImpl injection. */
export interface MockResponseInit {
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
}

export function makeResponse(init: MockResponseInit = {}): Response {
  const status = init.status ?? 200;
  const body = init.body;
  const headers = new Map<string, string>(Object.entries(init.headers ?? {}));
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (k: string) => headers.get(k.toLowerCase()) ?? headers.get(k) ?? null,
    },
    async json() {
      return body;
    },
    async text() {
      return JSON.stringify(body ?? "");
    },
  } as unknown as Response;
}

export interface MockFetchCall {
  url: string;
  init?: RequestInit;
}

export interface MockFetchResult {
  fetchImpl: typeof fetch;
  calls: MockFetchCall[];
  push: (matcher: string | RegExp, response: MockResponseInit | (() => MockResponseInit)) => void;
}

/** Test-friendly fetch double. Matches by URL substring or regex; FIFO queue per matcher. */
export function createMockFetch(initial: Record<string, MockResponseInit> = {}): MockFetchResult {
  const queue: Array<{
    matcher: string | RegExp;
    factory: () => MockResponseInit;
  }> = [];
  const calls: MockFetchCall[] = [];

  for (const [matcher, response] of Object.entries(initial)) {
    queue.push({ matcher, factory: () => response });
  }

  const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : (input as URL).toString();
    calls.push({ url, init });
    const idx = queue.findIndex(({ matcher }) =>
      typeof matcher === "string" ? url.includes(matcher) : matcher.test(url),
    );
    if (idx >= 0) {
      const item = queue[idx];
      queue.splice(idx, 1);
      return makeResponse(item.factory());
    }
    // Default: 200 with empty body so the test doesn't have to enumerate every call.
    return makeResponse({ status: 200, body: {} });
  }) as unknown as typeof fetch;

  return {
    fetchImpl,
    calls,
    push(matcher, response) {
      const factory = typeof response === "function" ? response : () => response;
      queue.push({ matcher, factory });
    },
  };
}

/**
 * `ws.WebSocket`-shaped mock. Tests drive the connection lifecycle by calling
 * `simulateOpen`, `simulateMessage(...)`, `simulateClose(...)`, etc.
 */
export class MockWebSocket extends EventEmitter {
  static instances: MockWebSocket[] = [];
  url: string;
  closedWithCode?: number;

  constructor(url: string, _opts?: unknown) {
    super();
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  close(code = 1000, reason = ""): void {
    this.closedWithCode = code;
    setImmediate(() => this.emit("close", code, Buffer.from(reason)));
  }

  simulateOpen(): void {
    this.emit("open");
  }

  simulateMessage(data: unknown): void {
    const buf = Buffer.from(typeof data === "string" ? data : JSON.stringify(data));
    this.emit("message", buf);
  }

  simulateClose(code = 1000, reason = "bye"): void {
    this.emit("close", code, Buffer.from(reason));
  }

  simulateError(message = "boom"): void {
    this.emit("error", new Error(message));
  }
}

export function getWebSocketCtor(): typeof WebSocket {
  MockWebSocket.instances = [];
  return MockWebSocket as unknown as typeof WebSocket;
}
