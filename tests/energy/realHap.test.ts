/**
 * Integration tests against the real HAP-NodeJS and Homebridge
 * PlatformAccessory (not the mocks), so the custom types are proven to be
 * accepted by HAP without warnings and to survive the Homebridge accessory
 * cache round trip.
 */
import * as hapNodejs from "hap-nodejs";
import type { API, PlatformAccessory as PlatformAccessoryType, Service } from "homebridge";
import { PlatformAccessory } from "homebridge/lib/platformAccessory.js";
import { describe, expect, it } from "vitest";
import { LoadpointAccessory } from "../../src/accessories/loadpointAccessory.js";
import type { EvccClient } from "../../src/api/client.js";
import type { EvccState } from "../../src/api/types.js";
import { ChargingStatisticsServices } from "../../src/energy/chargingStatistics.js";
import { CHARS, SERVICES, type CharKey } from "../../src/energy/definitions.js";
import { MISSING_SNAPSHOTS_BEFORE_REMOVAL } from "../../src/energy/serviceSet.js";
import { SiteEnergyServices } from "../../src/energy/siteEnergy.js";
import { energyHapTypes } from "../../src/energy/hapTypes.js";
import { LoadpointEnergyService } from "../../src/energy/loadpointEnergy.js";
import { createMockLogger } from "../helpers/homebridge.js";
import { FIXTURE_PLAN_EPOCH, energyFixture } from "./fixtures.js";

const hap = hapNodejs as unknown as API["hap"];
const api = { hap } as unknown as API;

function newAccessory(name: string): PlatformAccessoryType {
  return new PlatformAccessory(
    name,
    hapNodejs.uuid.generate(`test-${name}`),
  ) as unknown as PlatformAccessoryType;
}

const OWN_UUIDS = new Set<string>(Object.values(CHARS).map((c) => c.uuid));

/**
 * Collect HAP warnings. With `ownOnly`, only warnings about this plugin's
 * custom characteristics count (the existing services already trigger a HAP
 * warning for ConfiguredName, which is outside this feature).
 */
function collectWarnings(acc: PlatformAccessoryType, ownOnly = false): string[] {
  const warnings: string[] = [];
  const hapAccessory = (acc as unknown as { _associatedHAPAccessory: hapNodejs.Accessory })
    ._associatedHAPAccessory;
  hapAccessory.on(hapNodejs.AccessoryEventTypes.CHARACTERISTIC_WARNING, (w) => {
    if (ownOnly && !OWN_UUIDS.has(w.characteristic.UUID)) return;
    warnings.push(`${w.type}: ${w.message}`);
  });
  return warnings;
}

function value(svc: Service | undefined, key: CharKey): unknown {
  return svc?.getCharacteristic(energyHapTypes(hap).char(key)).value;
}

function find(acc: PlatformAccessoryType, uuid: string, subtype: string): Service | undefined {
  return acc.services.find((s) => s.UUID === uuid && s.subtype === subtype);
}

describe("custom types on real HAP-NodeJS", () => {
  it("builds characteristics with the declared HAP metadata", () => {
    const types = energyHapTypes(hap);
    const power = new (types.char("ChargePower"))();
    expect(power.UUID).toBe(CHARS.ChargePower.uuid);
    expect(power.displayName).toBe("Charge Power");
    expect(power.props).toMatchObject({
      format: "float",
      perms: ["pr", "ev"],
      minValue: -1_000_000,
      maxValue: 1_000_000,
    });
    expect(power.props.unit).toBeUndefined();
    expect(power.value).toBe(0);

    const soc = new (types.char("VehicleSoc"))();
    expect(soc.props).toMatchObject({ unit: "percentage", minValue: 0, maxValue: 100 });

    const mode = new (types.char("ChargeMode"))();
    expect(mode.props).toMatchObject({ format: "string", maxLen: 16 });
    expect(mode.value).toBe("");

    const flag = new (types.char("Charging"))();
    expect(flag.props.format).toBe("bool");
    expect(flag.value).toBe(false);

    const ts = new (types.char("PlanTime"))();
    expect(ts.props).toMatchObject({ format: "uint32", minValue: 0, maxValue: 4_294_967_295 });
  });

  it("caches the generated classes per HAP instance", () => {
    expect(energyHapTypes(hap).char("ChargePower")).toBe(energyHapTypes(hap).char("ChargePower"));
    expect(energyHapTypes(hap).service("ChargingStatistics")).toBe(
      energyHapTypes(hap).service("ChargingStatistics"),
    );
  });

  it("only Charge Mode, Always Charge, Set Plan and Charge Limit are writable; everything else is read and notify", () => {
    const types = energyHapTypes(hap);
    for (const key of Object.keys(CHARS) as CharKey[]) {
      const c = new (types.char(key))();
      const expected =
        key === "ChargeMode" || key === "AlwaysCharge" || key === "SetPlan" || key === "ChargeLimit"
          ? ["pr", "pw", "ev"]
          : ["pr", "ev"];
      expect(c.props.perms, key).toEqual(expected);
    }
  });

  it("applies the fixture to the site accessory without any HAP warning", () => {
    const acc = newAccessory("site");
    const warnings = collectWarnings(acc);
    new SiteEnergyServices(api, acc, () => 1_900_000_000_000).apply(energyFixture(), true);
    const site = find(acc, SERVICES.EnergySite.uuid, "energy-site");
    expect(value(site, "GridPower")).toBe(-1250.1);
    expect(value(site, "GridPowerL3")).toBe(-425);
    expect(value(site, "GridCurrentL1")).toBe(-1.74);
    expect(value(site, "BatterySoc")).toBe(55.6);
    expect(value(site, "GreenShareHome")).toBe(87.5);
    expect(value(site, "Currency")).toBe("EUR");
    expect(value(site, "LastUpdate")).toBe(1_900_000_000);
    const pv1 = find(acc, SERVICES.PvArray.uuid, "pv:pv1");
    expect(value(pv1, "MeterPower")).toBe(2100.4);
    expect(value(pv1, "MeterEnergyTotal")).toBe(1234.568);
    expect(value(pv1, "MeterId")).toBe("pv1");
    expect(pv1?.getCharacteristic(hap.Characteristic.Name).value).toBe("Array A");
    expect(find(acc, SERVICES.AuxMeter.uuid, "aux:aux1")).toBeDefined();
    expect(warnings).toEqual([]);
  });

  it("applies charging statistics without any HAP warning", () => {
    const acc = newAccessory("site");
    const warnings = collectWarnings(acc);
    new ChargingStatisticsServices(api, acc).apply(energyFixture());
    const total = find(acc, SERVICES.ChargingStatistics.uuid, "stat:total");
    expect(value(total, "StatPeriod")).toBe("total");
    expect(value(total, "StatChargedEnergy")).toBe(4000.25);
    expect(value(total, "StatAvgCo2")).toBe(250);
    expect(total?.getCharacteristic(hap.Characteristic.Name).value).toBe(
      "Charging Statistics total",
    );
    expect(find(acc, SERVICES.ChargingStatistics.uuid, "stat:30d")).toBeDefined();
    expect(warnings).toEqual([]);
  });

  it("applies a loadpoint without any HAP warning", () => {
    const acc = newAccessory("lp");
    const warnings = collectWarnings(acc);
    new LoadpointEnergyService(api, acc).apply(energyFixture().loadpoints![0], "Loadpoint A");
    const svc = find(acc, SERVICES.LoadpointEnergy.uuid, "loadpoint-energy");
    expect(value(svc, "SessionEnergy")).toBe(5.432);
    expect(value(svc, "PlanTime")).toBe(FIXTURE_PLAN_EPOCH);
    expect(value(svc, "ChargeMode")).toBe("pv");
    expect(svc?.getCharacteristic(hap.Characteristic.Name).value).toBe("Loadpoint A Energy");
    expect(warnings).toEqual([]);
  });

  it("tags the standard control services with role and enabled flag, without warnings", () => {
    const acc = newAccessory("controls");
    const warnings = collectWarnings(acc, true);
    new LoadpointAccessory({
      api,
      log: createMockLogger(),
      client: {} as EvccClient,
      accessory: acc,
      loadpointId: 0,
      state: energyFixture().loadpoints![0],
      config: {
        modeUi: "switches",
        defaultMode: "pv",
        exposeVehicleLimit: true,
        writable: true,
        limitWindowCovering: true,
      },
    });
    const role = (svc: Service): unknown =>
      svc.characteristics.find((c) => c.UUID === CHARS.ControlRole.uuid)?.value;
    const roles = acc.services.map(role).filter((r) => r !== undefined);
    expect(roles.sort()).toEqual([
      "loadpoint-charging",
      "loadpoint-enable",
      "loadpoint-limit-soc",
      "loadpoint-mode-minpv",
      "loadpoint-mode-now",
      "loadpoint-mode-pv",
      "vehicle-limit-soc",
    ]);
    const outlet = acc.services.find((s) => role(s) === "loadpoint-enable")!;
    const enabled = (svc: Service): unknown =>
      svc.characteristics.find((c) => c.UUID === CHARS.ControlEnabled.uuid)?.value;
    // In "switches" mode the outlet has no write handler; the switches do.
    expect(enabled(outlet)).toBe(false);
    expect(enabled(acc.services.find((s) => role(s) === "loadpoint-mode-now")!)).toBe(true);
    expect(enabled(acc.services.find((s) => role(s) === "loadpoint-limit-soc")!)).toBe(true);
    expect(warnings).toEqual([]);
  });

  it("survives the Homebridge cache round trip without duplicating services", () => {
    const acc = newAccessory("cached");
    new ChargingStatisticsServices(api, acc).apply(energyFixture());
    new LoadpointEnergyService(api, acc).apply(energyFixture().loadpoints![0], "Loadpoint A");
    const before = acc.services.length;

    const json = JSON.parse(JSON.stringify(PlatformAccessory.serialize(acc as never)));
    const restored = PlatformAccessory.deserialize(json) as unknown as PlatformAccessoryType;
    const warnings = collectWarnings(restored);

    const lp = { ...energyFixture().loadpoints![0], chargePower: 777 };
    new ChargingStatisticsServices(api, restored).apply(energyFixture());
    new LoadpointEnergyService(api, restored).apply(lp, "Loadpoint A");

    expect(restored.services.length).toBe(before);
    const svc = find(restored, SERVICES.LoadpointEnergy.uuid, "loadpoint-energy")!;
    expect(value(svc, "ChargePower")).toBe(777);
    expect(svc.characteristics.filter((c) => c.UUID !== hap.Characteristic.Name.UUID)).toHaveLength(
      SERVICES.LoadpointEnergy.chars.length,
    );
    expect(warnings).toEqual([]);
  });

  it("adds characteristics missing from a cached service and re-applies props", () => {
    const acc = newAccessory("old");
    // Simulate a service cached by an older plugin version: right UUID, only one characteristic.
    const old = new hap.Service(
      "Loadpoint A Energy",
      SERVICES.LoadpointEnergy.uuid,
      "loadpoint-energy",
    );
    const stale = old.addCharacteristic(energyHapTypes(hap).char("ChargePower"));
    stale.setProps({ minValue: 0, maxValue: 10 });
    acc.addService(old);
    const warnings = collectWarnings(acc);

    new LoadpointEnergyService(api, acc).apply(energyFixture().loadpoints![0], "Loadpoint A");

    const svc = find(acc, SERVICES.LoadpointEnergy.uuid, "loadpoint-energy")!;
    expect(acc.services.filter((s) => s.UUID === SERVICES.LoadpointEnergy.uuid)).toHaveLength(1);
    expect(svc.getCharacteristic(energyHapTypes(hap).char("ChargePower")).props.maxValue).toBe(
      1_000_000,
    );
    expect(value(svc, "ChargePower")).toBe(3700);
    expect(value(svc, "TodayEnergy")).toBe(7.65);
    expect(warnings).toEqual([]);
  });

  it("removes statistics periods that stay absent, and everything on removeAll", () => {
    const acc = newAccessory("prune");
    const stats = new ChargingStatisticsServices(api, acc);
    stats.apply(energyFixture(), true);
    const fewer = energyFixture() as EvccState;
    fewer.statistics = { total: fewer.statistics!.total };
    for (let i = 0; i < MISSING_SNAPSHOTS_BEFORE_REMOVAL; i++) stats.apply(fewer, true);
    expect(find(acc, SERVICES.ChargingStatistics.uuid, "stat:30d")).toBeUndefined();
    expect(find(acc, SERVICES.ChargingStatistics.uuid, "stat:total")).toBeDefined();
    stats.removeAll();
    expect(acc.services.some((s) => s.UUID === SERVICES.ChargingStatistics.uuid)).toBe(false);
  });

  it("surfaces write validation and EVCC failures as HAP status codes", async () => {
    const acc = newAccessory("writes");
    const setLoadpointMode = async (): Promise<void> => {
      throw new Error("HTTP 500");
    };
    new LoadpointAccessory({
      api,
      log: createMockLogger(),
      client: { setLoadpointMode } as unknown as EvccClient,
      accessory: acc,
      loadpointId: 0,
      state: energyFixture().loadpoints![0],
      config: { modeUi: "outlet", defaultMode: "pv", exposeVehicleLimit: false, writable: true },
    });
    const svc = find(acc, SERVICES.LoadpointEnergy.uuid, "loadpoint-energy")!;
    const mode = svc.getCharacteristic(energyHapTypes(hap).char("ChargeMode"));
    await expect(mode.handleSetRequest("bogus")).rejects.toBe(
      hapNodejs.HAPStatus.INVALID_VALUE_IN_REQUEST,
    );
    await expect(mode.handleSetRequest("now")).rejects.toBe(
      hapNodejs.HAPStatus.SERVICE_COMMUNICATION_FAILURE,
    );
    expect(mode.value).toBe("pv");
  });

  it("issue #33: no window covering by default, cached ones removed, Charge Limit writes reach EVCC", async () => {
    const acc = newAccessory("limit");
    // An accessory cached by plugin 1.1.0 carries the old charge-limit window covering.
    acc.addService(new hap.Service.WindowCovering("Loadpoint A Charge Limit", "limit-loadpoint"));
    const json = JSON.parse(JSON.stringify(PlatformAccessory.serialize(acc as never)));
    const restored = PlatformAccessory.deserialize(json) as unknown as PlatformAccessoryType;
    expect(restored.services.some((s) => s.UUID === hap.Service.WindowCovering.UUID)).toBe(true);
    const warnings = collectWarnings(restored, true);

    const calls: Array<[number, number]> = [];
    new LoadpointAccessory({
      api,
      log: createMockLogger(),
      client: {
        setLoadpointLimitSoc: async (id: number, soc: number) => {
          calls.push([id, soc]);
        },
      } as unknown as EvccClient,
      accessory: restored,
      loadpointId: 0,
      state: energyFixture().loadpoints![0],
      config: { modeUi: "outlet", defaultMode: "pv", exposeVehicleLimit: true, writable: true },
    });

    expect(restored.services.some((s) => s.UUID === hap.Service.WindowCovering.UUID)).toBe(false);
    const svc = find(restored, SERVICES.LoadpointEnergy.uuid, "loadpoint-energy")!;
    const limit = svc.getCharacteristic(energyHapTypes(hap).char("ChargeLimit"));
    expect(limit.props.minStep).toBe(1);
    expect(limit.props.unit).toBe(hap.Units.PERCENTAGE);
    expect(limit.value).toBe(80);
    await limit.handleSetRequest(70);
    expect(calls).toEqual([[1, 70]]);
    await expect(limit.handleSetRequest(70.5)).rejects.toBe(
      hapNodejs.HAPStatus.INVALID_VALUE_IN_REQUEST,
    );
    expect(calls).toHaveLength(1);
    expect(warnings).toEqual([]);
  });
});
