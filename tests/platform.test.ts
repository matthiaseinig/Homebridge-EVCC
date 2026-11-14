import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EvccClient } from "../src/api/client.js";
import { CHARS, SERVICES } from "../src/energy/definitions.js";
import { EvccPlatform } from "../src/platform.js";
import { energyFixture } from "./energy/fixtures.js";
import {
  MockPlatformAccessory,
  asPlatformAccessory,
  createMockApi,
  createMockLogger,
} from "./helpers/homebridge.js";
import {
  MockWebSocket,
  createMockFetch,
  getWebSocketCtor,
} from "./helpers/mockEvcc.js";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

interface BuildOpts {
  url?: string;
  password?: string;
  hideSite?: boolean;
  hideVehiclePresence?: boolean;
  loadpointMode?: "outlet" | "switches" | "readonly";
  exposeVehicleLimit?: boolean;
  limitWindowCovering?: boolean;
  hideEnergyCharacteristics?: boolean;
  initialState?: Record<string, unknown>;
}

function buildPlatform(opts: BuildOpts = {}) {
  const log = createMockLogger();
  const api = createMockApi();
  const fetch = createMockFetch();
  fetch.push("/api/state", { body: opts.initialState ?? {} });
  if (opts.password) {
    fetch.push("/api/auth/login", {
      headers: { "set-cookie": "auth=ABC; Path=/" },
    });
  }
  const client = opts.url
    ? new EvccClient({
        baseUrl: opts.url,
        password: opts.password,
        log,
        pollIntervalMs: 60_000,
        fetchImpl: fetch.fetchImpl,
        webSocketCtor: getWebSocketCtor(),
      })
    : undefined;
  const platform = new EvccPlatform(
    log,
    {
      platform: "EVCC",
      name: "EVCC",
      url: opts.url,
      password: opts.password,
      hideSite: opts.hideSite,
      hideVehiclePresence: opts.hideVehiclePresence,
      loadpointMode: opts.loadpointMode,
      exposeVehicleLimit: opts.exposeVehicleLimit,
      limitWindowCovering: opts.limitWindowCovering,
      hideEnergyCharacteristics: opts.hideEnergyCharacteristics,
    },
    api,
    { client },
  );
  return { platform, log, api, fetch, client };
}

describe("EvccPlatform — bootstrap", () => {
  it("logs an error and stays idle when no url is configured", () => {
    const { log } = buildPlatform();
    expect(log.error).toHaveBeenCalledWith(expect.stringContaining("url"));
  });

  it("starts on didFinishLaunching when a url is provided", async () => {
    const { api, log } = buildPlatform({ url: "http://evcc.local:7070" });
    api.emit("didFinishLaunching");
    await vi.waitFor(() => {
      expect(log.info).toHaveBeenCalledWith(
        expect.stringContaining("Starting EVCC"),
        expect.any(String),
        expect.any(Boolean),
      );
    });
  });

  it("logs an error if the EVCC start fails (cannot reach the host)", async () => {
    const log = createMockLogger();
    const api = createMockApi();
    const failingClient = {
      start: vi.fn(async () => {
        throw new Error("connect refused");
      }),
      stop: vi.fn(),
      on: vi.fn(),
      getState: vi.fn(() => ({})),
    } as unknown as EvccClient;
    new EvccPlatform(
      log,
      { platform: "EVCC", name: "EVCC", url: "http://x" },
      api,
      { client: failingClient },
    );
    api.emit("didFinishLaunching");
    await vi.waitFor(() => {
      expect(log.error).toHaveBeenCalledWith(
        expect.stringContaining("Failed to reach"),
        "connect refused",
      );
    });
  });

  it("disconnects the client on shutdown", async () => {
    const { api, log, client } = buildPlatform({ url: "http://evcc.local:7070" });
    api.emit("didFinishLaunching");
    await vi.waitFor(() => expect(client!.getState).not.toBeUndefined());
    api.emit("shutdown");
    expect(log.info).toHaveBeenCalledWith(expect.stringContaining("shutting down"));
  });

  it("shutdown is a no-op without a client", () => {
    const { api, log } = buildPlatform();
    api.emit("shutdown");
    expect(log.info).not.toHaveBeenCalledWith(expect.stringContaining("shutting down"));
  });

  it("caches accessories restored by Homebridge", () => {
    const { platform, log } = buildPlatform({ url: "http://evcc.local:7070" });
    const fakeAccessory = { displayName: "Restored" } as unknown as Parameters<
      typeof platform.configureAccessory
    >[0];
    platform.configureAccessory(fakeAccessory);
    expect(platform.accessories).toHaveLength(1);
    expect(log.debug).toHaveBeenCalledWith(expect.stringContaining("Restoring"), "Restored");
  });
});

describe("EvccPlatform — adoption", () => {
  it("adopts site, loadpoints, and vehicle accessories from the initial state", async () => {
    const { api, platform } = buildPlatform({
      url: "http://evcc.local:7070",
      initialState: {
        siteTitle: "Home",
        loadpoints: [{ title: "Garage", connected: true, vehicleName: "ev1" }],
        vehicles: { ev1: { title: "EV1" } },
      },
    });
    api.emit("didFinishLaunching");
    await vi.waitFor(() =>
      expect(platform.accessories.length).toBeGreaterThanOrEqual(3),
    );
    const kinds = platform.accessories.map((a) => a.context.kind);
    expect(kinds).toContain("site");
    expect(kinds).toContain("loadpoint");
    expect(kinds).toContain("vehicle");
  });

  it("exposes the charge limit as a window covering only with limitWindowCovering (issue #33)", async () => {
    const coverings = async (limitWindowCovering?: boolean): Promise<number> => {
      const { api, platform } = buildPlatform({
        url: "http://evcc.local:7070",
        hideSite: true,
        hideVehiclePresence: true,
        exposeVehicleLimit: true,
        limitWindowCovering,
        initialState: { loadpoints: [{ title: "Garage", limitSoc: 80 }] },
      });
      api.emit("didFinishLaunching");
      await vi.waitFor(() => expect(platform.accessories.length).toBe(1));
      const acc = platform.accessories[0] as unknown as MockPlatformAccessory;
      return acc.services.filter((s) => s.UUID === "WindowCovering").length;
    };
    expect(await coverings(undefined)).toBe(0);
    expect(await coverings(false)).toBe(0);
    expect(await coverings(true)).toBe(2);
  });

  it("hideSite + hideVehiclePresence skip those adoptions", async () => {
    const { api, platform } = buildPlatform({
      url: "http://evcc.local:7070",
      hideSite: true,
      hideVehiclePresence: true,
      initialState: {
        loadpoints: [{ title: "Garage" }],
        vehicles: { ev1: { title: "EV1" } },
      },
    });
    api.emit("didFinishLaunching");
    await vi.waitFor(() => expect(platform.accessories.length).toBe(1));
    expect(platform.accessories[0].context.kind).toBe("loadpoint");
  });

  it("re-uses cached accessories on the second poll instead of re-registering", async () => {
    const { api, platform, fetch } = buildPlatform({
      url: "http://evcc.local:7070",
      initialState: { loadpoints: [{ title: "A" }] },
    });
    api.emit("didFinishLaunching");
    await vi.waitFor(() => expect(platform.accessories.length).toBeGreaterThan(0));
    const first = platform.accessories.length;
    fetch.push("/api/state", { body: { loadpoints: [{ title: "A" }] } });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(platform.accessories.length).toBe(first);
  });

  it("prunes accessories when their entity disappears from EVCC", async () => {
    const { api, platform, fetch } = buildPlatform({
      url: "http://evcc.local:7070",
      initialState: {
        loadpoints: [{ title: "A" }, { title: "B" }],
        vehicles: { ev1: { title: "EV1" } },
      },
    });
    api.emit("didFinishLaunching");
    await vi.waitFor(() =>
      expect(platform.accessories.length).toBeGreaterThanOrEqual(4),
    );
    const before = platform.accessories.length;
    fetch.push("/api/state", { body: { loadpoints: [{ title: "A" }], vehicles: {} } });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(platform.accessories.length).toBeLessThan(before);
  });

  it("forwards websocket diffs to the right loadpoint accessory", async () => {
    const { api, platform } = buildPlatform({
      url: "http://evcc.local:7070",
      initialState: {
        loadpoints: [{ title: "A", chargePower: 0 }],
      },
    });
    api.emit("didFinishLaunching");
    await vi.waitFor(() => expect(platform.accessories.length).toBeGreaterThan(0));
    const ws = MockWebSocket.instances[0];
    ws.simulateOpen();
    ws.simulateMessage({ "loadpoints.0.chargePower": 5500 });
    const lp = platform.accessories.find((a) => a.context.kind === "loadpoint")! as unknown as
      MockPlatformAccessory;
    const power = lp.services.find((s) => s.subtype === "charge-power")!;
    expect(power.getCharacteristic("CurrentAmbientLightLevel").value).toBe(5500);
  });

  it("forwards a whole-loadpoint diff (path length 2) and refreshes vehicle presence", async () => {
    const { api, platform } = buildPlatform({
      url: "http://evcc.local:7070",
      initialState: {
        loadpoints: [{ title: "A", chargePower: 0, connected: false }],
        vehicles: { ev1: { title: "EV1" } },
      },
    });
    api.emit("didFinishLaunching");
    await vi.waitFor(() =>
      expect(platform.accessories.filter((a) => a.context.kind === "loadpoint").length).toBe(1),
    );
    const ws = MockWebSocket.instances[0];
    ws.simulateOpen();
    ws.simulateMessage({
      "loadpoints.0": { title: "A", chargePower: 1234, connected: true, vehicleName: "ev1" },
    });
    const lp = platform.accessories.find((a) => a.context.kind === "loadpoint")! as unknown as
      MockPlatformAccessory;
    const power = lp.services.find((s) => s.subtype === "charge-power")!;
    expect(power.getCharacteristic("CurrentAmbientLightLevel").value).toBe(1234);
    const ev1 = platform.accessories.find(
      (a) => a.context.kind === "vehicle" && a.context.vehicleName === "ev1",
    )! as unknown as MockPlatformAccessory;
    const occ = ev1.services.find((s) => s.UUID === "OccupancySensor")!;
    expect(occ.getCharacteristic("OccupancyDetected").value).toBe(1);
  });

  it("re-renders the site card on a non-loadpoint diff", async () => {
    const { api, platform } = buildPlatform({
      url: "http://evcc.local:7070",
      initialState: { pvPower: 0 },
    });
    api.emit("didFinishLaunching");
    await vi.waitFor(() => expect(platform.accessories.length).toBeGreaterThan(0));
    const ws = MockWebSocket.instances[0];
    ws.simulateOpen();
    ws.simulateMessage({ pvPower: 3300 });
    const site = platform.accessories.find((a) => a.context.kind === "site")! as unknown as
      MockPlatformAccessory;
    const pv = site.services.find((s) => s.subtype === "pv-power")!;
    expect(pv.getCharacteristic("CurrentAmbientLightLevel").value).toBe(3300);
  });

  it("flips a vehicle presence sensor when a connected loadpoint switches vehicles", async () => {
    const { api, platform, fetch } = buildPlatform({
      url: "http://evcc.local:7070",
      initialState: {
        loadpoints: [{ title: "A", connected: true, vehicleName: "ev1" }],
        vehicles: { ev1: { title: "EV1" }, ev2: { title: "EV2" } },
      },
    });
    api.emit("didFinishLaunching");
    await vi.waitFor(() =>
      expect(platform.accessories.filter((a) => a.context.kind === "vehicle").length).toBe(2),
    );
    // Force a state-poll-driven reconciliation: ev2 is now connected.
    fetch.push("/api/state", {
      body: {
        loadpoints: [{ title: "A", connected: true, vehicleName: "ev2" }],
        vehicles: { ev1: { title: "EV1" }, ev2: { title: "EV2" } },
      },
    });
    await vi.advanceTimersByTimeAsync(60_000);
    const ev1 = platform.accessories.find(
      (a) => a.context.kind === "vehicle" && a.context.vehicleName === "ev1",
    )! as unknown as MockPlatformAccessory;
    const ev2 = platform.accessories.find(
      (a) => a.context.kind === "vehicle" && a.context.vehicleName === "ev2",
    )! as unknown as MockPlatformAccessory;
    const occ1 = ev1.services.find((s) => s.UUID === "OccupancySensor")!;
    const occ2 = ev2.services.find((s) => s.UUID === "OccupancySensor")!;
    expect(occ1.getCharacteristic("OccupancyDetected").value).toBe(0);
    expect(occ2.getCharacteristic("OccupancyDetected").value).toBe(1);
  });
});

describe("EvccPlatform: energy characteristics", () => {
  function service(platform: EvccPlatform, kind: string, uuid: string, subtype?: string) {
    const acc = platform.accessories.find((a) => a.context.kind === kind) as unknown as
      | MockPlatformAccessory
      | undefined;
    return acc?.services.find((s) => s.UUID === uuid && (!subtype || s.subtype === subtype));
  }

  it("reads the older { result: ... } wrapper and follows websocket diffs", async () => {
    const { api, platform } = buildPlatform({
      url: "http://evcc.local:7070",
      initialState: { result: energyFixture() },
    });
    api.emit("didFinishLaunching");
    await vi.waitFor(() =>
      expect(service(platform, "loadpoint", SERVICES.LoadpointEnergy.uuid)).toBeDefined(),
    );
    const lp = service(platform, "loadpoint", SERVICES.LoadpointEnergy.uuid)!;
    const total = service(platform, "site", SERVICES.ChargingStatistics.uuid, "stat:total")!;
    expect(lp.getCharacteristic(CHARS.TodayEnergy.uuid).value).toBe(7.65);
    expect(total.getCharacteristic(CHARS.StatChargedEnergy.uuid).value).toBe(4000.25);

    const ws = MockWebSocket.instances[0];
    ws.simulateOpen();
    const site = service(platform, "site", SERVICES.EnergySite.uuid)!;
    ws.simulateMessage({
      grid: { power: 640.04, powers: [200, 220, 220.04], currents: [0.9, 1, 1] },
      homePower: 1800,
    });
    expect(site.getCharacteristic(CHARS.GridPower.uuid).value).toBe(640);
    expect(site.getCharacteristic(CHARS.GridPowerL3.uuid).value).toBe(220);
    expect(site.getCharacteristic(CHARS.HomePower.uuid).value).toBe(1800);

    // A loadpoint-only frame moves the site's Last Update too.
    site.getCharacteristic(CHARS.LastUpdate.uuid).updateValue(0);
    ws.simulateMessage({ "loadpoints.0.chargePower": 0, "loadpoints.0.charging": false });
    expect(site.getCharacteristic(CHARS.LastUpdate.uuid).value).toBeGreaterThan(0);
    expect(site.getCharacteristic(CHARS.HomePower.uuid).value).toBe(1800);
    ws.simulateMessage({ statistics: { total: { chargedKWh: 4002 } } });
    expect(lp.getCharacteristic(CHARS.ChargePower.uuid).value).toBe(0);
    expect(lp.getCharacteristic(CHARS.Charging.uuid).value).toBe(false);
    expect(total.getCharacteristic(CHARS.StatChargedEnergy.uuid).value).toBe(4002);
    // A websocket frame without the 30d period does not remove its service.
    expect(service(platform, "site", SERVICES.ChargingStatistics.uuid, "stat:30d")).toBeDefined();
  });

  it("hideEnergyCharacteristics keeps the classic services and skips the custom ones", async () => {
    const { api, platform } = buildPlatform({
      url: "http://evcc.local:7070",
      hideEnergyCharacteristics: true,
      initialState: energyFixture() as unknown as Record<string, unknown>,
    });
    api.emit("didFinishLaunching");
    await vi.waitFor(() =>
      expect(platform.accessories.filter((a) => a.context.kind === "loadpoint")).toHaveLength(1),
    );
    expect(service(platform, "site", SERVICES.ChargingStatistics.uuid)).toBeUndefined();
    expect(service(platform, "site", SERVICES.EnergySite.uuid)).toBeUndefined();
    expect(service(platform, "loadpoint", SERVICES.LoadpointEnergy.uuid)).toBeUndefined();
    expect(service(platform, "site", "LightSensor")).toBeDefined();
  });
});
