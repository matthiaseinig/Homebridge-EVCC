import { describe, expect, it, vi } from "vitest";
import { LoadpointAccessory, type LoadpointAccessoryConfig } from "../../src/accessories/loadpointAccessory.js";
import type { EvccClient } from "../../src/api/client.js";
import type { LoadpointState } from "../../src/api/types.js";
import {
  MockPlatformAccessory,
  asPlatformAccessory,
  createMockApi,
  createMockLogger,
} from "../helpers/homebridge.js";

function makeClient(): EvccClient {
  return {
    setLoadpointMode: vi.fn(async () => undefined),
    setLoadpointLimitSoc: vi.fn(async () => undefined),
    setVehicleLimitSoc: vi.fn(async () => undefined),
    setBatteryMode: vi.fn(async () => undefined),
  } as unknown as EvccClient;
}

function build(
  state: LoadpointState,
  cfg: Partial<LoadpointAccessoryConfig> = {},
): {
  acc: MockPlatformAccessory;
  lp: LoadpointAccessory;
  client: EvccClient;
  log: ReturnType<typeof createMockLogger>;
} {
  const api = createMockApi();
  const log = createMockLogger();
  const client = makeClient();
  const acc = new MockPlatformAccessory("LP", "uuid:lp");
  const lp = new LoadpointAccessory({
    api,
    log,
    client,
    accessory: asPlatformAccessory(acc),
    loadpointId: 0,
    state,
    config: {
      modeUi: "outlet",
      defaultMode: "pv",
      exposeVehicleLimit: false,
      writable: true,
      ...cfg,
    },
  });
  return { acc, lp, client, log };
}

describe("LoadpointAccessory", () => {
  it("renders all base services", () => {
    const { acc } = build({ title: "Garage", connected: true, charging: true, vehicleSoc: 50 });
    const types = acc.services.map((s) => `${s.UUID}/${s.subtype ?? ""}`);
    expect(types).toContain("AccessoryInformation/");
    expect(types).toContain("Outlet/outlet");
    expect(types).toContain("WindowCovering/limit-loadpoint");
    expect(types).toContain("Battery/vehicle-battery");
    expect(types).toContain("LightSensor/charge-power");
  });

  it("renders the vehicle-limit blinds when configured", () => {
    const { acc } = build({}, { exposeVehicleLimit: true });
    expect(acc.services.some((s) => s.subtype === "limit-vehicle")).toBe(true);
  });

  it("renders 3 mode switches when modeUi=switches", () => {
    const { acc } = build({ mode: "pv" }, { modeUi: "switches" });
    const subs = acc.services.filter((s) => s.UUID === "Switch").map((s) => s.subtype);
    expect(subs.sort()).toEqual(["mode-minpv", "mode-now", "mode-pv"]);
  });

  it("does NOT render mode switches in outlet mode", () => {
    const { acc } = build({}, { modeUi: "outlet" });
    expect(acc.services.some((s) => s.UUID === "Switch")).toBe(false);
  });

  it("toggling the outlet to ON sends defaultMode", async () => {
    const { acc, client } = build({ enabled: false }, { defaultMode: "pv" });
    const outlet = acc.services.find((s) => s.subtype === "outlet")!;
    const handler = outlet.getCharacteristic("On").onSetHandler!;
    await handler(true);
    expect(client.setLoadpointMode).toHaveBeenCalledWith(1, "pv");
  });

  it("toggling the outlet to OFF sends mode=off", async () => {
    const { acc, client } = build({ enabled: true });
    const outlet = acc.services.find((s) => s.subtype === "outlet")!;
    const handler = outlet.getCharacteristic("On").onSetHandler!;
    await handler(false);
    expect(client.setLoadpointMode).toHaveBeenCalledWith(1, "off");
  });

  it("setting the limit blinds POSTs limitSoc", async () => {
    const { acc, client } = build({ limitSoc: 80 });
    const cov = acc.services.find((s) => s.subtype === "limit-loadpoint")!;
    const handler = cov.getCharacteristic("TargetPosition").onSetHandler!;
    await handler(70);
    expect(client.setLoadpointLimitSoc).toHaveBeenCalledWith(1, 70);
  });

  it("setting the vehicle-limit blinds POSTs vehicle limitSoc", async () => {
    const { acc, client } = build(
      { vehicleName: "vehicle_1" },
      { exposeVehicleLimit: true },
    );
    const cov = acc.services.find((s) => s.subtype === "limit-vehicle")!;
    const handler = cov.getCharacteristic("TargetPosition").onSetHandler!;
    await handler(85);
    expect(client.setVehicleLimitSoc).toHaveBeenCalledWith("vehicle_1", 85);
  });

  it("vehicle-limit handler is a no-op when no vehicle is assigned", async () => {
    const { acc, client } = build({}, { exposeVehicleLimit: true });
    const cov = acc.services.find((s) => s.subtype === "limit-vehicle")!;
    await cov.getCharacteristic("TargetPosition").onSetHandler!(85);
    expect(client.setVehicleLimitSoc).not.toHaveBeenCalled();
  });

  it("readonly mode does NOT register write handlers", () => {
    const { acc } = build({}, { modeUi: "readonly" });
    const outlet = acc.services.find((s) => s.subtype === "outlet")!;
    expect(outlet.getCharacteristic("On").onSetHandler).toBeUndefined();
  });

  it("when not writable, write handlers stay unset even in outlet UI", () => {
    const { acc } = build({}, { writable: false });
    const outlet = acc.services.find((s) => s.subtype === "outlet")!;
    expect(outlet.getCharacteristic("On").onSetHandler).toBeUndefined();
  });

  it("activating a mode switch sets that mode", async () => {
    const { acc, client } = build({ mode: "pv" }, { modeUi: "switches" });
    const sw = acc.services.find((s) => s.subtype === "mode-now")!;
    await sw.getCharacteristic("On").onSetHandler!(true);
    expect(client.setLoadpointMode).toHaveBeenCalledWith(1, "now");
  });

  it("toggling off the active mode switch goes off; toggling off an inactive one is ignored", async () => {
    const { acc, client } = build({ mode: "pv" }, { modeUi: "switches" });
    // Turn off the active 'pv' switch -> off
    const pv = acc.services.find((s) => s.subtype === "mode-pv")!;
    await pv.getCharacteristic("On").onSetHandler!(false);
    expect(client.setLoadpointMode).toHaveBeenCalledWith(1, "off");
    // Turning off an inactive switch shouldn't issue a call
    (client.setLoadpointMode as ReturnType<typeof vi.fn>).mockClear();
    const minpv = acc.services.find((s) => s.subtype === "mode-minpv")!;
    await minpv.getCharacteristic("On").onSetHandler!(false);
    expect(client.setLoadpointMode).not.toHaveBeenCalled();
  });

  it("logs but does not throw when EVCC write commands fail", async () => {
    const { acc, client, log } = build({});
    (client.setLoadpointMode as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("boom"));
    const outlet = acc.services.find((s) => s.subtype === "outlet")!;
    await outlet.getCharacteristic("On").onSetHandler!(true);
    expect(log.warn).toHaveBeenCalledWith(
      expect.stringContaining("loadpoint"),
      1,
      "pv",
      "boom",
    );
  });

  it("logs but does not throw when setLoadpointLimitSoc fails", async () => {
    const { acc, client, log } = build({ limitSoc: 80 });
    (client.setLoadpointLimitSoc as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("ouch"),
    );
    const cov = acc.services.find((s) => s.subtype === "limit-loadpoint")!;
    await cov.getCharacteristic("TargetPosition").onSetHandler!(70);
    expect(log.warn).toHaveBeenCalledWith(
      expect.stringContaining("limitSoc"),
      1,
      70,
      "ouch",
    );
  });

  it("logs but does not throw when setVehicleLimitSoc fails", async () => {
    const { acc, client, log } = build(
      { vehicleName: "ev1" },
      { exposeVehicleLimit: true },
    );
    (client.setVehicleLimitSoc as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("bad"),
    );
    const cov = acc.services.find((s) => s.subtype === "limit-vehicle")!;
    await cov.getCharacteristic("TargetPosition").onSetHandler!(85);
    expect(log.warn).toHaveBeenCalledWith(
      expect.stringContaining("vehicle"),
      "ev1",
      85,
      "bad",
    );
  });

  it("applyState updates outlet, battery, lightsensor characteristics", () => {
    const { acc, lp } = build({});
    lp.applyState({
      enabled: true,
      connected: true,
      charging: true,
      limitSoc: 80,
      vehicleSoc: 15,
      chargePower: 7000,
    });
    const outlet = acc.services.find((s) => s.subtype === "outlet")!;
    expect(outlet.getCharacteristic("On").value).toBe(true);
    expect(outlet.getCharacteristic("OutletInUse").value).toBe(true);
    const cov = acc.services.find((s) => s.subtype === "limit-loadpoint")!;
    expect(cov.getCharacteristic("TargetPosition").value).toBe(80);
    expect(cov.getCharacteristic("CurrentPosition").value).toBe(15);
    const battery = acc.services.find((s) => s.subtype === "vehicle-battery")!;
    expect(battery.getCharacteristic("BatteryLevel").value).toBe(15);
    expect(battery.getCharacteristic("ChargingState").value).toBe(1);
    expect(battery.getCharacteristic("StatusLowBattery").value).toBe(1);
    const power = acc.services.find((s) => s.subtype === "charge-power")!;
    expect(power.getCharacteristic("CurrentAmbientLightLevel").value).toBe(7000);
  });

  it("applyPartial merges into state and re-renders", () => {
    const { acc, lp } = build({ chargePower: 0 });
    lp.applyPartial("chargePower", 4500);
    const power = acc.services.find((s) => s.subtype === "charge-power")!;
    expect(power.getCharacteristic("CurrentAmbientLightLevel").value).toBe(4500);
  });

  it("dispose() is callable", () => {
    const { lp } = build({});
    expect(() => lp.dispose()).not.toThrow();
  });
});
