import { describe, expect, it, vi } from "vitest";
import { SiteAccessory } from "../../src/accessories/siteAccessory.js";
import type { EvccClient } from "../../src/api/client.js";
import type { EvccState } from "../../src/api/types.js";
import { CHARS, SERVICES } from "../../src/energy/definitions.js";
import { MISSING_SNAPSHOTS_BEFORE_REMOVAL } from "../../src/energy/serviceSet.js";
import { energyFixture } from "../energy/fixtures.js";
import {
  MockHAPStatus,
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
  extra: { energy?: boolean; acc?: MockPlatformAccessory; now?: () => number } = {},
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
    now: extra.now ?? (() => 1_900_000_000_000),
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

  it("logs battery mode failures and returns a HAP communication failure", async () => {
    const { acc, client, log } = build({} as EvccState, true);
    (client.setBatteryMode as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("nope"));
    const norm = acc.services.find((s) => s.subtype === "battery-mode-normal")!;
    await expect(norm.getCharacteristic("On").onSetHandler!(true)).rejects.toMatchObject({
      hapStatus: MockHAPStatus.SERVICE_COMMUNICATION_FAILURE,
    });
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining("battery mode"), "normal", "nope");
  });

  it("dispose() is callable", () => {
    const { site } = build({} as EvccState);
    expect(() => site.dispose()).not.toThrow();
  });

  it("adds the site energy and statistics services by default and keeps them current", () => {
    const { acc, site } = build(energyFixture());
    const energy = acc.services.find((s) => s.UUID === SERVICES.EnergySite.uuid)!;
    expect(energy.subtype).toBe("energy-site");
    expect(energy.getCharacteristic(CHARS.GridPower.uuid).value).toBe(-1250.1);
    expect(energy.getCharacteristic(CHARS.LastUpdate.uuid).value).toBe(1_900_000_000);
    const pv = acc.services.filter((s) => s.UUID === SERVICES.PvArray.uuid);
    expect(pv.map((s) => s.subtype).sort()).toEqual(["pv:pv1", "pv:pv2"]);
    expect(acc.services.filter((s) => s.UUID === SERVICES.AuxMeter.uuid)).toHaveLength(1);
    const stats = acc.services.filter((s) => s.UUID === SERVICES.ChargingStatistics.uuid);
    expect(stats.map((s) => s.subtype).sort()).toEqual(["stat:30d", "stat:total"]);

    site.applyState({ ...energyFixture(), grid: { power: 321 } } as EvccState);
    expect(energy.getCharacteristic(CHARS.GridPower.uuid).value).toBe(321);
    expect(energy.getCharacteristic(CHARS.GridPowerL1.uuid).value).toBe(0);
  });

  it("touch() moves Last Update without re-rendering site values", () => {
    let now = 1_900_000_000_000;
    const { acc, site } = build(energyFixture(), false, { now: () => now });
    const energy = acc.services.find((s) => s.UUID === SERVICES.EnergySite.uuid)!;
    now += 42_000;
    site.touch();
    expect(energy.getCharacteristic(CHARS.LastUpdate.uuid).value).toBe(1_900_000_042);
    expect(energy.getCharacteristic(CHARS.GridPower.uuid).value).toBe(-1250.1);
  });

  it("keeps per-meter and statistics services until missing from several snapshots", () => {
    const { acc, site } = build(energyFixture());
    const without = { ...energyFixture(), pv: [], aux: [], statistics: {} } as EvccState;
    const present = (subtype: string): boolean => acc.services.some((s) => s.subtype === subtype);
    // Websocket-driven renders never count as a miss.
    for (let i = 0; i < 10; i++) site.applyState(without);
    expect(present("pv:pv1") && present("aux:aux1") && present("stat:30d")).toBe(true);
    for (let i = 1; i < MISSING_SNAPSHOTS_BEFORE_REMOVAL; i++) site.applyState(without, true);
    expect(present("pv:pv1")).toBe(true);
    // Reappearing resets the count.
    site.applyState(energyFixture(), true);
    for (let i = 1; i < MISSING_SNAPSHOTS_BEFORE_REMOVAL; i++) site.applyState(without, true);
    expect(present("stat:30d")).toBe(true);
    site.applyState(without, true);
    expect(present("pv:pv1") || present("aux:aux1") || present("stat:30d")).toBe(false);
    expect(present("energy-site")).toBe(true);
  });

  it("keeps the existing Home-app services unchanged", () => {
    const { acc } = build(energyFixture());
    const pv = acc.services.find((s) => s.subtype === "pv-power")!;
    expect(pv.getCharacteristic("CurrentAmbientLightLevel").value).toBe(3050);
    const battery = acc.services.find((s) => s.subtype === "home-battery")!;
    expect(battery.getCharacteristic("BatteryLevel").value).toBe(56);
  });

  it("with energy disabled adds no custom services, removes cached ones, and touch() is a no-op", () => {
    const acc = new MockPlatformAccessory("Site", "uuid:site");
    acc.services.push(new MockService(SERVICES.EnergySite.uuid, "Energy Site", "energy-site"));
    acc.services.push(new MockService(SERVICES.PvArray.uuid, "Array A", "pv:pv1"));
    acc.services.push(
      new MockService(SERVICES.ChargingStatistics.uuid, "Charging Statistics total", "stat:total"),
    );
    const { site } = build(energyFixture(), false, { energy: false, acc });
    site.touch();
    const custom = Object.values(SERVICES).map((s) => s.uuid as string);
    expect(acc.services.some((s) => custom.includes(s.UUID))).toBe(false);
    expect(acc.services.some((s) => s.subtype === "pv-power")).toBe(true);
  });
});
