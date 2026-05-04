import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EvccClient } from "../../src/api/client.js";
import { createMockLogger } from "../helpers/homebridge.js";
import {
  MockWebSocket,
  createMockFetch,
  getWebSocketCtor,
} from "../helpers/mockEvcc.js";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

function buildClient(opts: { password?: string } = {}) {
  const log = createMockLogger();
  const fetch = createMockFetch();
  const ws = getWebSocketCtor();
  const client = new EvccClient({
    baseUrl: "http://evcc.local:7070/",
    password: opts.password,
    log,
    pollIntervalMs: 1000,
    fetchImpl: fetch.fetchImpl,
    webSocketCtor: ws,
  });
  return { client, log, fetch };
}

describe("EvccClient.refreshState", () => {
  it("unwraps the {result: ...} envelope when present", async () => {
    const { client, fetch } = buildClient();
    fetch.push("/api/state", { body: { result: { pvPower: 1500 } } });
    const state = await client.refreshState();
    expect(state.pvPower).toBe(1500);
  });

  it("uses the body as state when no result wrapper is present", async () => {
    const { client, fetch } = buildClient();
    fetch.push("/api/state", { body: { pvPower: 800 } });
    const state = await client.refreshState();
    expect(state.pvPower).toBe(800);
  });

  it("emits the state event", async () => {
    const { client, fetch } = buildClient();
    fetch.push("/api/state", { body: { pvPower: 9 } });
    const seen: unknown[] = [];
    client.on("state", (s) => seen.push(s.pvPower));
    await client.refreshState();
    expect(seen).toEqual([9]);
  });

  it("throws on non-2xx", async () => {
    const { client, fetch } = buildClient();
    fetch.push("/api/state", { status: 500 });
    await expect(client.refreshState()).rejects.toThrow(/500/);
  });
});

describe("EvccClient login + writes", () => {
  it("sends the password and stores the auth cookie on login", async () => {
    const { client, fetch } = buildClient({ password: "secret" });
    fetch.push("/api/auth/login", {
      headers: { "set-cookie": "auth=COOKIEVALUE; Path=/; HttpOnly" },
    });
    fetch.push("/api/state", { body: { pvPower: 0 } });
    await client.start();
    // First call should be login with the password in the body.
    const loginCall = fetch.calls.find((c) => c.url.includes("/api/auth/login"));
    expect(loginCall).toBeDefined();
    expect(loginCall!.init?.body).toContain("secret");
    // Subsequent state call should carry the cookie.
    const stateCall = fetch.calls.find((c) => c.url.includes("/api/state"));
    expect(stateCall).toBeDefined();
    expect((stateCall!.init?.headers as Record<string, string>).Cookie).toContain("COOKIEVALUE");
    client.stop();
  });

  it("warns when login fails but still works in read-only mode", async () => {
    const { client, log, fetch } = buildClient({ password: "wrong" });
    fetch.push("/api/auth/login", { status: 401 });
    fetch.push("/api/state", { body: { pvPower: 0 } });
    await client.start();
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining("login failed"), expect.any(String));
    client.stop();
  });

  it("posts mode/limit/battery commands at the right paths", async () => {
    const { client, fetch } = buildClient();
    await client.setLoadpointMode(2, "pv");
    await client.setLoadpointLimitSoc(1, 80.4);
    await client.setVehicleLimitSoc("vehicle_1", 90);
    await client.setBatteryMode("hold");
    expect(fetch.calls.map((c) => c.url)).toEqual([
      "http://evcc.local:7070/api/loadpoints/2/mode/pv",
      "http://evcc.local:7070/api/loadpoints/1/limitsoc/80",
      "http://evcc.local:7070/api/vehicles/vehicle_1/limitsoc/90",
      "http://evcc.local:7070/api/batterymode/hold",
    ]);
  });

  it("raises and clears the cookie on a 401 from a write", async () => {
    const { client, fetch } = buildClient({ password: "secret" });
    // Successful login + state.
    fetch.push("/api/auth/login", {
      headers: { "set-cookie": "auth=ABC; Path=/" },
    });
    fetch.push("/api/state", { body: {} });
    await client.start();
    // Write returns 401, then on retry the client tries to log in again.
    fetch.push("/api/loadpoints/1/mode/pv", { status: 401 });
    await expect(client.setLoadpointMode(1, "pv")).rejects.toThrow(/401/);
    // Next write should attempt re-login, then send the request.
    fetch.push("/api/auth/login", {
      headers: { "set-cookie": "auth=DEF; Path=/" },
    });
    fetch.push("/api/loadpoints/1/mode/pv", { status: 200 });
    await client.setLoadpointMode(1, "pv");
    expect(fetch.calls.filter((c) => c.url.includes("/auth/login")).length).toBe(2);
    client.stop();
  });
});

describe("EvccClient websocket", () => {
  it("connects, applies state diffs, and re-emits as update events", async () => {
    const { client, fetch } = buildClient();
    fetch.push("/api/state", { body: {} });
    await client.start();
    const ws = MockWebSocket.instances[0];
    expect(ws.url).toBe("ws://evcc.local:7070/ws");

    const seen: Array<{ key: string; value: unknown }> = [];
    client.on("update", (u) => seen.push(u));
    ws.simulateOpen();
    ws.simulateMessage({ pvPower: 4500 });
    ws.simulateMessage({ "loadpoints.0.chargePower": 2200 });

    expect(seen).toEqual([
      { key: "pvPower", value: 4500 },
      { key: "loadpoints.0.chargePower", value: 2200 },
    ]);
    expect(client.getState().pvPower).toBe(4500);
    expect(client.getState().loadpoints?.[0]?.chargePower).toBe(2200);
    client.stop();
  });

  it("ignores malformed frames", async () => {
    const { client, fetch } = buildClient();
    fetch.push("/api/state", { body: {} });
    await client.start();
    const ws = MockWebSocket.instances[0];
    ws.simulateOpen();
    const seen: unknown[] = [];
    client.on("update", (u) => seen.push(u));
    ws.simulateMessage("not-json");
    ws.simulateMessage("[1,2,3]");
    expect(seen).toEqual([]);
    client.stop();
  });

  it("schedules a reconnect on close, with backoff", async () => {
    const { client, fetch } = buildClient();
    fetch.push("/api/state", { body: {} });
    await client.start();
    const first = MockWebSocket.instances[0];
    first.simulateOpen();
    first.simulateClose(1006, "lost");
    // Default reconnect delay = 5s.
    vi.advanceTimersByTime(5_000);
    expect(MockWebSocket.instances.length).toBe(2);
    client.stop();
  });

  it("logs WS errors without throwing", async () => {
    const { client, log, fetch } = buildClient();
    fetch.push("/api/state", { body: {} });
    await client.start();
    const ws = MockWebSocket.instances[0];
    ws.simulateOpen();
    ws.simulateError("kaboom");
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining("WS error"), "kaboom");
    client.stop();
  });

  it("polls REST on the configured interval", async () => {
    const { client, fetch } = buildClient();
    fetch.push("/api/state", { body: { pvPower: 1 } });
    await client.start();
    fetch.push("/api/state", { body: { pvPower: 2 } });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(fetch.calls.filter((c) => c.url.includes("/api/state")).length).toBeGreaterThanOrEqual(2);
    client.stop();
  });

  it("logs poll failures as warnings instead of crashing", async () => {
    const { client, log, fetch } = buildClient();
    fetch.push("/api/state", { body: {} });
    await client.start();
    fetch.push("/api/state", { status: 503 });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining("poll failed"), expect.any(String));
    client.stop();
  });

  it("on/off attaches and detaches typed listeners", async () => {
    const { client, fetch } = buildClient();
    fetch.push("/api/state", { body: {} });
    await client.start();
    const cb = vi.fn();
    client.on("connect", cb);
    MockWebSocket.instances[0].simulateOpen();
    expect(cb).toHaveBeenCalledTimes(1);
    client.off("connect", cb);
    MockWebSocket.instances[0].simulateOpen();
    expect(cb).toHaveBeenCalledTimes(1);
    client.stop();
  });

  it("schedules a reconnect when WebSocket construction throws", async () => {
    const log = createMockLogger();
    const fetch = createMockFetch();
    fetch.push("/api/state", { body: {} });
    const failingCtor = vi.fn(() => {
      throw new Error("ws-construct-failed");
    }) as unknown as typeof import("ws").WebSocket;
    const client = new (await import("../../src/api/client.js")).EvccClient({
      baseUrl: "http://evcc.local:7070",
      log,
      pollIntervalMs: 60_000,
      fetchImpl: fetch.fetchImpl,
      webSocketCtor: failingCtor,
    });
    await client.start();
    expect(log.warn).toHaveBeenCalledWith(
      expect.stringContaining("WS construct failed"),
      "ws-construct-failed",
    );
    client.stop();
  });

  it("isolates listener exceptions", async () => {
    const { client, log, fetch } = buildClient();
    fetch.push("/api/state", { body: {} });
    await client.start();
    client.on("connect", () => {
      throw new Error("listener-bad");
    });
    MockWebSocket.instances[0].simulateOpen();
    expect(log.error).toHaveBeenCalledWith(
      expect.stringContaining("Listener for"),
      "connect",
      "listener-bad",
    );
    client.stop();
  });
});
