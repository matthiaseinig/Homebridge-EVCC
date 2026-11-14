import { describe, expect, it, vi } from "vitest";
import { LoadpointAccessory, type LoadpointAccessoryConfig } from "../../src/accessories/loadpointAccessory.js";
import type { EvccClient } from "../../src/api/client.js";
import type { LoadpointState } from "../../src/api/types.js";
import { CHARS, CONTROL_ROLES, SERVICES } from "../../src/energy/definitions.js";
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
    setLoadpointMode: vi.fn(async () => undefined),
    setLoadpointLimitSoc: vi.fn(async () => undefined),
    setVehicleLimitSoc: vi.fn(async () => undefined),
    setBatteryMode: vi.fn(async () => undefined),
    setVehiclePlanSoc: vi.fn(async () => undefined),
    deleteVehiclePlanSoc: vi.fn(async () => undefined),
  } as unknown as EvccClient;
}

function build(
  state: LoadpointState,
  cfg: Partial<LoadpointAccessoryConfig> = {},
  existing?: MockPlatformAccessory,
): {
  acc: MockPlatformAccessory;
  lp: LoadpointAccessory;
  client: EvccClient;
  log: ReturnType<typeof createMockLogger>;
} {
  const api = createMockApi();
  const log = createMockLogger();
  const client = makeClient();
  const acc = existing ?? new MockPlatformAccessory("LP", "uuid:lp");
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
    now: () => 1_900_000_000_000,
  });
  return { acc, lp, client, log };
}

describe("LoadpointAccessory", () => {
  it("renders all base services", () => {
    const { acc } = build({ title: "Garage", connected: true, charging: true, vehicleSoc: 50 });
    const types = acc.services.map((s) => `${s.UUID}/${s.subtype ?? ""}`);
    expect(types).toContain("AccessoryInformation/");
    expect(types).toContain("Outlet/outlet");
    // The charge limit is no WindowCovering by default (issue #33); see chargeLimit.test.ts.
    expect(types.some((t) => t.startsWith("WindowCovering/"))).toBe(false);
    expect(types).toContain("Battery/vehicle-battery");
    expect(types).toContain("LightSensor/charge-power");
  });

  it("renders the vehicle-limit blinds when configured with the legacy window covering option", () => {
    const { acc } = build({}, { exposeVehicleLimit: true, limitWindowCovering: true });
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

  it("setting the legacy limit blinds POSTs limitSoc", async () => {
    const { acc, client } = build({ limitSoc: 80 }, { limitWindowCovering: true });
    const cov = acc.services.find((s) => s.subtype === "limit-loadpoint")!;
    const handler = cov.getCharacteristic("TargetPosition").onSetHandler!;
    await handler(70);
    expect(client.setLoadpointLimitSoc).toHaveBeenCalledWith(1, 70);
  });

  it("setting the vehicle-limit blinds POSTs vehicle limitSoc", async () => {
    const { acc, client } = build(
      { vehicleName: "vehicle_1" },
      { exposeVehicleLimit: true, limitWindowCovering: true },
    );
    const cov = acc.services.find((s) => s.subtype === "limit-vehicle")!;
    const handler = cov.getCharacteristic("TargetPosition").onSetHandler!;
    await handler(85);
    expect(client.setVehicleLimitSoc).toHaveBeenCalledWith("vehicle_1", 85);
  });

  it("vehicle-limit handler is a no-op when no vehicle is assigned", async () => {
    const { acc, client } = build({}, { exposeVehicleLimit: true, limitWindowCovering: true });
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

  it("logs and returns a HAP communication failure when EVCC rejects a mode write", async () => {
    const { acc, client, log } = build({});
    (client.setLoadpointMode as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("boom"));
    const outlet = acc.services.find((s) => s.subtype === "outlet")!;
    await expect(outlet.getCharacteristic("On").onSetHandler!(true)).rejects.toMatchObject({ hapStatus: MockHAPStatus.SERVICE_COMMUNICATION_FAILURE });
    expect(log.warn).toHaveBeenCalledWith(
      expect.stringContaining("loadpoint"),
      1,
      "pv",
      "boom",
    );
  });

  it("logs and returns a HAP communication failure when setLoadpointLimitSoc fails", async () => {
    const { acc, client, log } = build({ limitSoc: 80 }, { limitWindowCovering: true });
    (client.setLoadpointLimitSoc as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("ouch"),
    );
    const cov = acc.services.find((s) => s.subtype === "limit-loadpoint")!;
    await expect(cov.getCharacteristic("TargetPosition").onSetHandler!(70)).rejects.toMatchObject({ hapStatus: MockHAPStatus.SERVICE_COMMUNICATION_FAILURE });
    expect(log.warn).toHaveBeenCalledWith(
      expect.stringContaining("limitSoc"),
      1,
      70,
      "ouch",
    );
  });

  it("logs and returns a HAP communication failure when setVehicleLimitSoc fails", async () => {
    const { acc, client, log } = build(
      { vehicleName: "ev1" },
      { exposeVehicleLimit: true, limitWindowCovering: true },
    );
    (client.setVehicleLimitSoc as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("bad"),
    );
    const cov = acc.services.find((s) => s.subtype === "limit-vehicle")!;
    await expect(cov.getCharacteristic("TargetPosition").onSetHandler!(85)).rejects.toMatchObject({ hapStatus: MockHAPStatus.SERVICE_COMMUNICATION_FAILURE });
    expect(log.warn).toHaveBeenCalledWith(
      expect.stringContaining("vehicle"),
      "ev1",
      85,
      "bad",
    );
  });

  it("applyState updates outlet, battery, lightsensor and legacy limit characteristics", () => {
    const { acc, lp } = build({}, { limitWindowCovering: true });
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

  it("exposes the read-only Loadpoint Energy service and follows partial updates", () => {
    const { acc, lp } = build({
      title: "Garage",
      mode: "pv",
      chargePower: 3700,
      sessionEnergy: 5432,
      connected: true,
    });
    const svc = acc.services.find((s) => s.UUID === SERVICES.LoadpointEnergy.uuid)!;
    expect(svc.subtype).toBe("loadpoint-energy");
    expect(svc.getCharacteristic("Name").value).toBe("Garage Energy");
    expect(svc.getCharacteristic(CHARS.ChargePower.uuid).value).toBe(3700);
    expect(svc.getCharacteristic(CHARS.SessionEnergy.uuid).value).toBe(5.432);
    expect(svc.getCharacteristic(CHARS.ChargeMode.uuid).value).toBe("pv");
    expect(svc.getCharacteristic(CHARS.VehicleConnected.uuid).value).toBe(true);
    expect(svc.getCharacteristic(CHARS.ChargePower.uuid).onSetHandler).toBeUndefined();

    lp.applyPartial("chargePower", 1100.06);
    expect(svc.getCharacteristic(CHARS.ChargePower.uuid).value).toBe(1100.1);
    lp.applyPartial("effectivePlanTime", "2030-01-02T06:30:00Z");
    expect(svc.getCharacteristic(CHARS.PlanTime.uuid).value).toBe(Date.UTC(2030, 0, 2, 6, 30) / 1000);
  });

  it("with energy disabled adds no energy service and removes a cached one", () => {
    const acc = new MockPlatformAccessory("LP", "uuid:lp");
    acc.services.push(
      new MockService(SERVICES.LoadpointEnergy.uuid, "Garage Energy", "loadpoint-energy"),
    );
    build({ title: "Garage" }, { energy: false }, acc);
    expect(acc.services.some((s) => s.UUID === SERVICES.LoadpointEnergy.uuid)).toBe(false);
  });

  it("updates Last Update on every loadpoint render", () => {
    const { acc } = build({ title: "Garage" });
    const svc = acc.services.find((s) => s.UUID === SERVICES.LoadpointEnergy.uuid)!;
    expect(svc.getCharacteristic(CHARS.LoadpointLastUpdate.uuid).value).toBe(1_900_000_000);
  });

  describe("control role tagging", () => {
    const role = (acc: MockPlatformAccessory, subtype: string) => {
      const svc = acc.services.find((s) => s.subtype === subtype)!;
      return {
        role: svc.charMap.get(CHARS.ControlRole.uuid)?.value,
        enabled: svc.charMap.get(CHARS.ControlEnabled.uuid)?.value,
      };
    };

    it("tags outlet and limit in outlet mode", () => {
      const { acc } = build(
        { title: "Garage" },
        { exposeVehicleLimit: true, limitWindowCovering: true },
      );
      expect(role(acc, "loadpoint-energy")).toEqual({ role: CONTROL_ROLES.charging, enabled: true });
      expect(role(acc, "outlet")).toEqual({ role: CONTROL_ROLES.outlet, enabled: true });
      expect(role(acc, "limit-loadpoint")).toEqual({
        role: CONTROL_ROLES.limitLoadpoint,
        enabled: true,
      });
      expect(role(acc, "limit-vehicle")).toEqual({
        role: CONTROL_ROLES.limitVehicle,
        enabled: true,
      });
      expect(role(acc, "vehicle-battery").role).toBeUndefined();
    });

    it("tags the mode switches and marks the outlet as not writable in switches mode", () => {
      const { acc } = build({ title: "Garage" }, { modeUi: "switches" });
      expect(role(acc, "outlet")).toEqual({ role: CONTROL_ROLES.outlet, enabled: false });
      expect(role(acc, "mode-now")).toEqual({ role: CONTROL_ROLES.modeNow, enabled: true });
      expect(role(acc, "mode-pv")).toEqual({ role: CONTROL_ROLES.modePv, enabled: true });
      expect(role(acc, "mode-minpv")).toEqual({ role: CONTROL_ROLES.modeMinPv, enabled: true });
    });

    it("reports every control as not enabled without a password", () => {
      const { acc } = build({ title: "Garage" }, { writable: false, limitWindowCovering: true });
      expect(role(acc, "outlet").enabled).toBe(false);
      expect(role(acc, "limit-loadpoint").enabled).toBe(false);
    });

    it("removes the tags when energy characteristics are disabled", () => {
      const acc = new MockPlatformAccessory("LP", "uuid:lp");
      build({ title: "Garage" }, {}, acc);
      expect(role(acc, "outlet").role).toBe(CONTROL_ROLES.outlet);
      build({ title: "Garage" }, { energy: false }, acc);
      expect(role(acc, "outlet")).toEqual({ role: undefined, enabled: undefined });
    });
  });

  describe("charging writes on the Loadpoint Energy service", () => {
    const NOW_S = 1_900_000_000;
    const energySvc = (acc: MockPlatformAccessory) =>
      acc.services.find((s) => s.UUID === SERVICES.LoadpointEnergy.uuid)!;
    const write = (acc: MockPlatformAccessory, uuid: string, value: unknown) =>
      energySvc(acc).getCharacteristic(uuid).onSetHandler!(value);
    const status = (code: number) => ({ hapStatus: code });

    it("forwards a valid Charge Mode to the EVCC mode endpoint (1-based id)", async () => {
      const { acc, client } = build({ title: "Garage" });
      for (const mode of ["off", "now", "minpv", "pv"]) {
        await write(acc, CHARS.ChargeMode.uuid, mode);
        expect(client.setLoadpointMode).toHaveBeenLastCalledWith(1, mode);
      }
    });

    it("rejects an invalid Charge Mode before calling EVCC", async () => {
      const { acc, client } = build({ title: "Garage" });
      for (const bad of ["PV", "smart", "", 1, null, "pv "]) {
        await expect(write(acc, CHARS.ChargeMode.uuid, bad)).rejects.toMatchObject(
          status(MockHAPStatus.INVALID_VALUE_IN_REQUEST),
        );
      }
      expect(client.setLoadpointMode).not.toHaveBeenCalled();
    });

    it("returns a communication failure when EVCC rejects the mode", async () => {
      const { acc, client } = build({ title: "Garage" });
      (client.setLoadpointMode as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error("POST /api/loadpoints/1/mode/now HTTP 500"),
      );
      await expect(write(acc, CHARS.ChargeMode.uuid, "now")).rejects.toMatchObject(
        status(MockHAPStatus.SERVICE_COMMUNICATION_FAILURE),
      );
    });

    it("refuses writes without the admin password or in readonly mode", async () => {
      for (const cfg of [{ writable: false }, { modeUi: "readonly" as const }]) {
        const { acc, client } = build({ title: "Garage", vehicleName: "car1" }, cfg);
        expect(energySvc(acc).charMap.get(CHARS.ControlEnabled.uuid)?.value).toBe(false);
        await expect(write(acc, CHARS.ChargeMode.uuid, "pv")).rejects.toMatchObject(
          status(MockHAPStatus.INSUFFICIENT_PRIVILEGES),
        );
        await expect(write(acc, CHARS.SetPlan.uuid, "")).rejects.toMatchObject(
          status(MockHAPStatus.INSUFFICIENT_PRIVILEGES),
        );
        expect(client.setLoadpointMode).not.toHaveBeenCalled();
      }
    });

    it("sets a vehicle SoC plan with an RFC 3339 timestamp", async () => {
      const { acc, client } = build({ title: "Garage", vehicleName: "car1" });
      await write(acc, CHARS.SetPlan.uuid, `80,${NOW_S + 3600}`);
      expect(client.setVehiclePlanSoc).toHaveBeenCalledWith(
        "car1",
        80,
        new Date((NOW_S + 3600) * 1000).toISOString().replace(".000Z", "Z"),
      );
    });

    it("clears the plan with an empty string or 0", async () => {
      const { acc, client } = build({ title: "Garage", vehicleName: "car1" });
      await write(acc, CHARS.SetPlan.uuid, "");
      await write(acc, CHARS.SetPlan.uuid, "0");
      expect(client.deleteVehiclePlanSoc).toHaveBeenCalledTimes(2);
      expect(client.deleteVehiclePlanSoc).toHaveBeenCalledWith("car1");
    });

    it("rejects malformed plans, past times and out-of-range SoC before calling EVCC", async () => {
      const { acc, client } = build({ title: "Garage", vehicleName: "car1" });
      const bad = [
        "80",
        "80;1900003600",
        `0,${NOW_S + 60}`,
        `101,${NOW_S + 60}`,
        `80,${NOW_S}`,
        `80,${NOW_S - 1}`,
        "80,99999999999",
        `-5,${NOW_S + 60}`,
        `80.5,${NOW_S + 60}`,
        ` 80,${NOW_S + 60}`,
        12,
        null,
      ];
      for (const v of bad) {
        await expect(write(acc, CHARS.SetPlan.uuid, v)).rejects.toMatchObject(
          status(MockHAPStatus.INVALID_VALUE_IN_REQUEST),
        );
      }
      expect(client.setVehiclePlanSoc).not.toHaveBeenCalled();
      expect(client.deleteVehiclePlanSoc).not.toHaveBeenCalled();
    });

    it("refuses a plan when no vehicle is at the loadpoint", async () => {
      const { acc, client } = build({ title: "Garage" });
      await expect(write(acc, CHARS.SetPlan.uuid, `80,${NOW_S + 60}`)).rejects.toMatchObject(
        status(MockHAPStatus.NOT_ALLOWED_IN_CURRENT_STATE),
      );
      expect(client.setVehiclePlanSoc).not.toHaveBeenCalled();
    });

    it("returns a communication failure when EVCC rejects the plan", async () => {
      const { acc, client, log } = build({ title: "Garage", vehicleName: "car1" });
      (client.deleteVehiclePlanSoc as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error("network down"),
      );
      await expect(write(acc, CHARS.SetPlan.uuid, "")).rejects.toMatchObject(
        status(MockHAPStatus.SERVICE_COMMUNICATION_FAILURE),
      );
      expect(log.warn).toHaveBeenCalledWith(
        expect.stringContaining("plan"),
        "car1",
        "network down",
      );
    });

    it("mirrors the current plan in Set Plan", () => {
      const { acc } = build({
        title: "Garage",
        effectivePlanTime: new Date((NOW_S + 7200) * 1000).toISOString(),
        effectivePlanSoc: 75,
      });
      expect(energySvc(acc).getCharacteristic(CHARS.SetPlan.uuid).value).toBe(`75,${NOW_S + 7200}`);
    });
  });
});
