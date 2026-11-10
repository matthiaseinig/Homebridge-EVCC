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
import {
  ChargingStatisticsServices,
  MISSING_SNAPSHOTS_BEFORE_REMOVAL,
} from "../../src/energy/chargingStatistics.js";
import { CHARS, RETIRED, SERVICES, type CharKey } from "../../src/energy/definitions.js";
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

  it("no custom characteristic is writable", () => {
    const types = energyHapTypes(hap);
    for (const key of Object.keys(CHARS) as CharKey[]) {
      const c = new (types.char(key))();
      expect(c.props.perms, key).toEqual(["pr", "ev"]);
    }
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
      },
    });
    const role = (svc: Service): unknown =>
      svc.characteristics.find((c) => c.UUID === CHARS.ControlRole.uuid)?.value;
    const roles = acc.services.map(role).filter((r) => r !== undefined);
    expect(roles.sort()).toEqual([
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

  it("removes services with retired site-energy UUIDs from a cached accessory", () => {
    const acc = newAccessory("retired");
    for (const uuid of Object.keys(RETIRED.services)) {
      acc.addService(new hap.Service("old", uuid, "x"));
    }
    new ChargingStatisticsServices(api, acc);
    expect(acc.services.some((s) => s.UUID in RETIRED.services)).toBe(false);
    expect(acc.services.some((s) => s.UUID === hap.Service.AccessoryInformation.UUID)).toBe(true);
  });
});
