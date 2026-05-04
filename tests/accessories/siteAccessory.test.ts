import { describe, expect, it, vi } from "vitest";
import { SiteAccessory } from "../../src/accessories/siteAccessory.js";
import type { EvccClient } from "../../src/api/client.js";
import type { EvccState } from "../../src/api/types.js";
import {
  MockPlatformAccessory,
  asPlatformAccessory,
  createMockApi,
  createMockLogger,
} from "../helpers/homebridge.js";

function makeClient(): EvccClient {
  return {
    setBatteryMode: vi.fn(async () => undefined),
  } as unknown as EvccClient;
}

function build(state: EvccState, writable = false) {
  const api = createMockApi();
  const log = createMockLogger();
  const client = makeClient();
  const acc = new MockPlatformAccessory("Site", "uuid:site");
  const site = new SiteAccessory({
    api,
    log,
    client,
    accessory: asPlatformAccessory(acc),
    state,
    writable,
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
});
