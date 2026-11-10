import { describe, expect, it, vi } from "vitest";
import { SiteAccessory } from "../../src/accessories/siteAccessory.js";
import type { EvccClient } from "../../src/api/client.js";
import type { EvccState } from "../../src/api/types.js";
import { MISSING_SNAPSHOTS_BEFORE_REMOVAL } from "../../src/energy/chargingStatistics.js";
import { CHARS, RETIRED, SERVICES } from "../../src/energy/definitions.js";
import { energyFixture } from "../energy/fixtures.js";
import {
  MockPlatformAccessory,
  MockService,
  asPlatformAccessory,
  createMockApi,
  createMockLogger,
} from "../helpers/homebridge.js";

function makeClient(): EvccClient {
  return {
    setBatteryMode: vi.fn(async () => undefined),
  } as unknown as EvccClient;
}

function build(
  state: EvccState,
  writable = false,
  extra: { energy?: boolean; acc?: MockPlatformAccessory } = {},
) {
  const api = createMockApi();
  const log = createMockLogger();
  const client = makeClient();
  const acc = extra.acc ?? new MockPlatformAccessory("Site", "uuid:site");
  const site = new SiteAccessory({
    api,
    log,
    client,
    accessory: asPlatformAccessory(acc),
    state,
    writable,
    energy: extra.energy,
  });
  return { acc, site, client, log };
}

describe("SiteAccessory", () => {
  it("creates the base set of services regardless of state completeness", () => {
    const { acc } = build({} as EvccState);
    const subs = acc.services.map((s) => s.subtype ?? "");
    expect(subs).toContain("home-battery");
    expect(subs).toContain("pv-power");
    expect(subs).toContain("grid-power");
    expect(subs).toContain("grid-direction");
    expect(subs).toContain("home-power");
  });

  it("adds 3 battery-mode switches only when writable", () => {
    const ro = build({} as EvccState, false);
    expect(ro.acc.services.some((s) => s.UUID === "Switch")).toBe(false);
    const rw = build({} as EvccState, true);
    expect(rw.acc.services.filter((s) => s.UUID === "Switch").length).toBe(3);
  });

  it("renders battery + grid + pv with non-trivial state", () => {
    const { acc } = build({
      battery: { soc: 80, power: -1500 },
      pvPower: 5000,
      grid: { power: -1200 },
      homePower: 700,
      batteryMode: "hold",
    } as unknown as EvccState, true);

    const battery = acc.services.find((s) => s.subtype === "home-battery")!;
    expect(battery.getCharacteristic("BatteryLevel").value).toBe(80);
    expect(battery.getCharacteristic("ChargingState").value).toBe(1); // power < 0 => charging
    expect(battery.getCharacteristic("StatusLowBattery").value).toBe(0);

    const pv = acc.services.find((s) => s.subtype === "pv-power")!;
    expect(pv.getCharacteristic("CurrentAmbientLightLevel").value).toBe(5000);
    const grid = acc.services.find((s) => s.subtype === "grid-power")!;
    expect(grid.getCharacteristic("CurrentAmbientLightLevel").value).toBe(1200);
    const dir = acc.services.find((s) => s.subtype === "grid-direction")!;
    expect(dir.getCharacteristic("ContactSensorState").value).toBe(0); // exporting

    const hold = acc.services.find((s) => s.subtype === "battery-mode-hold")!;
    expect(hold.getCharacteristic("On").value).toBe(true);
  });

  it("flags low battery when SOC < 20", () => {
    const { acc } = build({ battery: { soc: 5, power: 0 } } as unknown as EvccState);
    const battery = acc.services.find((s) => s.subtype === "home-battery")!;
    expect(battery.getCharacteristic("StatusLowBattery").value).toBe(1);
  });

  it("grid direction is import when grid.power is positive", () => {
    const { acc } = build({ grid: { power: 800 } } as unknown as EvccState);
    const dir = acc.services.find((s) => s.subtype === "grid-direction")!;
    expect(dir.getCharacteristic("ContactSensorState").value).toBe(1);
  });

  it("battery mode switch fires setBatteryMode and ignores OFF events", async () => {
    const { acc, client } = build({} as EvccState, true);
    const charge = acc.services.find((s) => s.subtype === "battery-mode-charge")!;
    await charge.getCharacteristic("On").onSetHandler!(true);
    expect(client.setBatteryMode).toHaveBeenCalledWith("charge");
    (client.setBatteryMode as ReturnType<typeof vi.fn>).mockClear();
    await charge.getCharacteristic("On").onSetHandler!(false);
    expect(client.setBatteryMode).not.toHaveBeenCalled();
  });

  it("logs battery mode failures without throwing", async () => {
    const { acc, client, log } = build({} as EvccState, true);
    (client.setBatteryMode as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("nope"));
    const norm = acc.services.find((s) => s.subtype === "battery-mode-normal")!;
    await norm.getCharacteristic("On").onSetHandler!(true);
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining("battery mode"), "normal", "nope");
  });

  it("dispose() is callable", () => {
    const { site } = build({} as EvccState);
    expect(() => site.dispose()).not.toThrow();
  });

  it("adds Charging Statistics services by default and exposes no site energy", () => {
    const { acc, site } = build(energyFixture());
    const stats = acc.services.filter((s) => s.UUID === SERVICES.ChargingStatistics.uuid);
    expect(stats.map((s) => s.subtype).sort()).toEqual(["stat:30d", "stat:total"]);
    const total = stats.find((s) => s.subtype === "stat:total")!;
    expect(total.getCharacteristic(CHARS.StatChargedEnergy.uuid).value).toBe(4000.25);
    expect(acc.services.some((s) => s.UUID in RETIRED.services)).toBe(false);

    const next = energyFixture();
    next.statistics = { ...next.statistics, total: { chargedKWh: 4001 } };
    site.applyState(next);
    expect(total.getCharacteristic(CHARS.StatChargedEnergy.uuid).value).toBe(4001);
  });

  it("keeps a statistics service until its period is missing from several snapshots", () => {
    const { acc, site } = build(energyFixture());
    const without = { ...energyFixture(), statistics: {} } as EvccState;
    const has30d = (): boolean => acc.services.some((s) => s.subtype === "stat:30d");
    // Websocket-driven renders never count as a miss.
    for (let i = 0; i < 10; i++) site.applyState(without);
    expect(has30d()).toBe(true);
    for (let i = 1; i < MISSING_SNAPSHOTS_BEFORE_REMOVAL; i++) site.applyState(without, true);
    expect(has30d()).toBe(true);
    // Reappearing resets the count.
    site.applyState(energyFixture(), true);
    for (let i = 1; i < MISSING_SNAPSHOTS_BEFORE_REMOVAL; i++) site.applyState(without, true);
    expect(has30d()).toBe(true);
    site.applyState(without, true);
    expect(has30d()).toBe(false);
  });

  it("keeps the existing Home-app services unchanged", () => {
    const { acc } = build(energyFixture());
    const pv = acc.services.find((s) => s.subtype === "pv-power")!;
    expect(pv.getCharacteristic("CurrentAmbientLightLevel").value).toBe(3050);
    const battery = acc.services.find((s) => s.subtype === "home-battery")!;
    expect(battery.getCharacteristic("BatteryLevel").value).toBe(56);
  });

  it("removes services with retired site-energy UUIDs from a cached accessory", () => {
    const acc = new MockPlatformAccessory("Site", "uuid:site");
    for (const uuid of Object.keys(RETIRED.services)) {
      acc.services.push(new MockService(uuid, "old", "x"));
    }
    build(energyFixture(), false, { acc });
    expect(acc.services.some((s) => s.UUID in RETIRED.services)).toBe(false);
  });

  it("with energy disabled adds no custom services and removes cached ones", () => {
    const acc = new MockPlatformAccessory("Site", "uuid:site");
    acc.services.push(
      new MockService(SERVICES.ChargingStatistics.uuid, "Charging Statistics total", "stat:total"),
    );
    build(energyFixture(), false, { energy: false, acc });
    const custom = Object.values(SERVICES).map((s) => s.uuid as string);
    expect(acc.services.some((s) => custom.includes(s.UUID))).toBe(false);
    expect(acc.services.some((s) => s.subtype === "pv-power")).toBe(true);
  });
});
