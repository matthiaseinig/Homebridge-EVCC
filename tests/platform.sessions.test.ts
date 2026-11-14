import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EvccClient } from "../src/api/client.js";
import { CHARS, SERVICES } from "../src/energy/definitions.js";
import { EvccPlatform } from "../src/platform.js";
import { AFTER_SESSION_DELAY_MS } from "../src/sessions/service.js";
import { MockPlatformAccessory, createMockApi, createMockLogger } from "./helpers/homebridge.js";
import { MockWebSocket, createMockFetch, getWebSocketCtor } from "./helpers/mockEvcc.js";
import { rawSession, tempDir } from "./sessions/fixtures.js";

const NOW = new Date(2026, 2, 10, 12);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

const local = (d: number, h: number): string => new Date(2026, 2, d, h).toISOString();

const SESSIONS = [
  rawSession({
    id: 1,
    created: local(10, 8),
    finished: local(10, 10),
    chargedEnergy: 10,
    solarPercentage: 100,
  }),
  rawSession({
    id: 2,
    created: local(2, 8),
    finished: local(2, 10),
    chargedEnergy: 30,
    solarPercentage: 0,
  }),
  rawSession({
    id: 3,
    created: local(5, 8),
    finished: local(5, 10),
    chargedEnergy: 99,
    loadpoint: "Carport",
  }),
];

interface Opts {
  sessions?: unknown;
  hideEnergyCharacteristics?: boolean;
  storage?: boolean;
  sessionsReply?: { status?: number; body?: unknown };
}

function build(opts: Opts = {}) {
  const log = createMockLogger();
  const api = createMockApi();
  const dir = tempDir();
  if (opts.storage !== false)
    (api as unknown as { user: object }).user = { storagePath: () => dir };
  const fetch = createMockFetch();
  const reply = opts.sessionsReply ?? { body: SESSIONS };
  fetch.push("/api/state", {
    body: { currency: "EUR", loadpoints: [{ title: "Garage", charging: true, connected: true }] },
  });
  fetch.push("/api/sessions", reply);
  const client = new EvccClient({
    baseUrl: "http://evcc.local:7070",
    log,
    pollIntervalMs: 3_600_000,
    fetchImpl: fetch.fetchImpl,
    webSocketCtor: getWebSocketCtor(),
  });
  const platform = new EvccPlatform(
    log,
    {
      platform: "EVCC",
      name: "EVCC",
      url: "http://evcc.local:7070",
      sessions: opts.sessions,
      hideEnergyCharacteristics: opts.hideEnergyCharacteristics,
    },
    api,
    { client },
  );
  return { api, log, fetch, platform, dir };
}

const loadpoint = (api: ReturnType<typeof createMockApi>): MockPlatformAccessory =>
  api.registeredAccessories.find((a) => a.context.kind === "loadpoint")!;
const history = (acc: MockPlatformAccessory) =>
  acc.services.find((s) => s.UUID === SERVICES.ChargingHistory.uuid);
const value = (acc: MockPlatformAccessory, key: keyof typeof CHARS) =>
  history(acc)?.charMap.get(CHARS[key].uuid)?.value;

async function launch(b: ReturnType<typeof build>): Promise<void> {
  b.api.emit("didFinishLaunching");
  await vi.waitFor(() =>
    expect(b.fetch.calls.some((c) => c.url.endsWith("/api/sessions"))).toBe(true),
  );
  await vi.waitFor(() => expect(b.api.registeredAccessories.length).toBeGreaterThan(0));
}

describe("EvccPlatform charging history", () => {
  it("shows this loadpoint's summary from EVCC's session log", async () => {
    const b = build();
    await launch(b);
    const acc = loadpoint(b.api);
    await vi.waitFor(() => expect(value(acc, "ChargedMonth")).toBe(40));
    expect(value(acc, "ChargedToday")).toBe(10);
    expect(value(acc, "SolarShareMonth")).toBe(25);
    expect(value(acc, "LastSessionEnergy")).toBe(10);
    expect(value(acc, "LastSessionEnd")).toBe(
      Math.floor(new Date(2026, 2, 10, 10).getTime() / 1000),
    );
    expect(value(acc, "SessionsUpdated")).toBe(Math.floor(NOW.getTime() / 1000));
    b.api.emit("shutdown");
  });

  it("reads the session log with GET only", async () => {
    const b = build();
    await launch(b);
    const calls = b.fetch.calls.filter((c) => c.url.endsWith("/api/sessions"));
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) expect(c.init?.method ?? "GET").toBe("GET");
    b.api.emit("shutdown");
  });

  it("refreshes after the loadpoint stops charging", async () => {
    const b = build();
    await launch(b);
    await vi.waitFor(() => expect(value(loadpoint(b.api), "ChargedMonth")).toBe(40));
    const before = b.fetch.calls.filter((c) => c.url.endsWith("/api/sessions")).length;
    b.fetch.push("/api/sessions", {
      body: [
        ...SESSIONS,
        rawSession({ id: 4, created: local(10, 11), finished: local(10, 12), chargedEnergy: 5 }),
      ],
    });
    const ws = MockWebSocket.instances[0];
    ws.simulateOpen();
    ws.simulateMessage({ "loadpoints.0.charging": false });
    await vi.advanceTimersByTimeAsync(AFTER_SESSION_DELAY_MS);
    await vi.waitFor(() => expect(value(loadpoint(b.api), "ChargedMonth")).toBe(45));
    expect(b.fetch.calls.filter((c) => c.url.endsWith("/api/sessions")).length).toBe(before + 1);
    b.api.emit("shutdown");
  });

  it("keeps the service at zero while EVCC's session log is unavailable", async () => {
    const b = build({ sessionsReply: { status: 500, body: {} } });
    await launch(b);
    const acc = loadpoint(b.api);
    await vi.waitFor(() => expect(history(acc)).toBeDefined());
    expect(value(acc, "ChargedMonth")).toBe(0);
    expect(value(acc, "SessionsUpdated")).toBe(0);
    expect(b.log.warn).toHaveBeenCalledWith(
      expect.stringContaining("charging sessions"),
      expect.any(String),
    );
    b.api.emit("shutdown");
  });

  it("is off with sessions.enabled false: no fetch, no service", async () => {
    const b = build({ sessions: { enabled: false } });
    b.api.emit("didFinishLaunching");
    await vi.waitFor(() => expect(b.api.registeredAccessories.length).toBeGreaterThan(0));
    expect(history(loadpoint(b.api))).toBeUndefined();
    expect(b.fetch.calls.some((c) => c.url.endsWith("/api/sessions"))).toBe(false);
    b.api.emit("shutdown");
  });

  it("is off when the energy characteristics are hidden", async () => {
    const b = build({ hideEnergyCharacteristics: true });
    await launch(b);
    expect(history(loadpoint(b.api))).toBeUndefined();
    b.api.emit("shutdown");
  });

  it("stays off without a Homebridge storage folder", async () => {
    const b = build({ storage: false });
    b.api.emit("didFinishLaunching");
    await vi.waitFor(() => expect(b.api.registeredAccessories.length).toBeGreaterThan(0));
    expect(history(loadpoint(b.api))).toBeUndefined();
    expect(b.fetch.calls.some((c) => c.url.endsWith("/api/sessions"))).toBe(false);
    b.api.emit("shutdown");
  });

  it("logs a config error and keeps the API off for a public bind address", async () => {
    const b = build({ sessions: { api: { enabled: true, bindAddress: "0.0.0.0" } } });
    await launch(b);
    expect(b.log.error).toHaveBeenCalledWith(expect.stringContaining("bindAddress"));
    expect(b.log.info).not.toHaveBeenCalledWith(
      expect.stringContaining("listening"),
      expect.anything(),
      expect.anything(),
    );
    b.api.emit("shutdown");
  });

  it("starts the sessions service even when EVCC is unreachable at start", async () => {
    const log = createMockLogger();
    const api = createMockApi();
    (api as unknown as { user: object }).user = { storagePath: () => tempDir() };
    const getSessions = vi.fn(async () => {
      throw new Error("offline");
    });
    const client = {
      start: vi.fn(async () => {
        throw new Error("connect refused");
      }),
      stop: vi.fn(),
      on: vi.fn(),
      getState: vi.fn(() => ({})),
      getSessions,
    } as unknown as EvccClient;
    new EvccPlatform(log, { platform: "EVCC", name: "EVCC", url: "http://x" }, api, { client });
    api.emit("didFinishLaunching");
    await vi.waitFor(() => expect(getSessions).toHaveBeenCalled());
    api.emit("shutdown");
  });
});
