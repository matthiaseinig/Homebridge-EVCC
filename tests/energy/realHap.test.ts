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
import type { EvccState } from "../../src/api/types.js";
import { CHARS, SERVICES, type CharKey } from "../../src/energy/definitions.js";
import { energyHapTypes } from "../../src/energy/hapTypes.js";
import { LoadpointEnergyService } from "../../src/energy/loadpointEnergy.js";
import { SiteEnergyServices } from "../../src/energy/siteEnergy.js";
import { FIXTURE_PLAN_EPOCH, energyFixture } from "./fixtures.js";

const hap = hapNodejs as unknown as API["hap"];
const api = { hap } as unknown as API;
const NOW_MS = 1_900_000_000_000;

function newAccessory(name: string): PlatformAccessoryType {
  return new PlatformAccessory(
    name,
    hapNodejs.uuid.generate(`test-${name}`),
  ) as unknown as PlatformAccessoryType;
}

function collectWarnings(acc: PlatformAccessoryType): string[] {
  const warnings: string[] = [];
  const hapAccessory = (acc as unknown as { _associatedHAPAccessory: hapNodejs.Accessory })
    ._associatedHAPAccessory;
  hapAccessory.on(hapNodejs.AccessoryEventTypes.CHARACTERISTIC_WARNING, (w) => {
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

describe("custom energy types on real HAP-NodeJS", () => {
  it("builds characteristics with the declared HAP metadata", () => {
    const types = energyHapTypes(hap);
    const grid = new (types.char("GridPower"))();
    expect(grid.UUID).toBe(CHARS.GridPower.uuid);
    expect(grid.displayName).toBe("Grid Power");
    expect(grid.props).toMatchObject({
      format: "float",
      perms: ["pr", "ev"],
      minValue: -1_000_000,
      maxValue: 1_000_000,
    });
    expect(grid.props.unit).toBeUndefined();
    expect(grid.value).toBe(0);

    const soc = new (types.char("BatterySoc"))();
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
    expect(energyHapTypes(hap).char("PvPower")).toBe(energyHapTypes(hap).char("PvPower"));
    expect(energyHapTypes(hap).service("PvArray")).toBe(energyHapTypes(hap).service("PvArray"));
  });

  it("no characteristic is writable", () => {
    const types = energyHapTypes(hap);
    for (const key of Object.keys(CHARS) as CharKey[]) {
      const c = new (types.char(key))();
      expect(c.props.perms, key).toEqual(["pr", "ev"]);
    }
  });

  it("applies the fixture to the site accessory without any HAP warning", () => {
    const acc = newAccessory("site");
    const warnings = collectWarnings(acc);
    new SiteEnergyServices(api, acc, () => NOW_MS).apply(energyFixture());

    const site = find(acc, SERVICES.EnergySite.uuid, "energy-site");
    expect(site).toBeDefined();
    expect(value(site, "GridPower")).toBe(-1250.1);
    expect(value(site, "GridPowerL3")).toBe(-425);
    expect(value(site, "GridCurrentL1")).toBe(-1.74);
    expect(value(site, "BatterySoc")).toBe(55.6);
    expect(value(site, "BatteryPower")).toBe(-800);
    expect(value(site, "GreenShareHome")).toBe(87.5);
    expect(value(site, "Currency")).toBe("EUR");
    expect(value(site, "LastUpdate")).toBe(1_900_000_000);

    const pv1 = find(acc, SERVICES.PvArray.uuid, "pv:pv1");
    expect(value(pv1, "MeterPower")).toBe(2100.4);
    expect(value(pv1, "MeterEnergyTotal")).toBe(1234.568);
    expect(value(pv1, "MeterId")).toBe("pv1");
    expect(pv1?.getCharacteristic(hap.Characteristic.Name).value).toBe("Array A");

    expect(find(acc, SERVICES.AuxMeter.uuid, "aux:aux1")).toBeDefined();
    expect(
      value(find(acc, SERVICES.ChargingStatistics.uuid, "stat:total"), "StatChargedEnergy"),
    ).toBe(4000.25);
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

  it("survives the Homebridge cache round trip without duplicating services", () => {
    const acc = newAccessory("cached");
    new SiteEnergyServices(api, acc, () => NOW_MS).apply(energyFixture());
    const before = acc.services.length;

    const json = JSON.parse(JSON.stringify(PlatformAccessory.serialize(acc as never)));
    const restored = PlatformAccessory.deserialize(json) as unknown as PlatformAccessoryType;
    const warnings = collectWarnings(restored);

    const updated = energyFixture();
    updated.grid = { ...updated.grid, power: 777 };
    new SiteEnergyServices(api, restored, () => NOW_MS).apply(updated);

    expect(restored.services.length).toBe(before);
    const site = find(restored, SERVICES.EnergySite.uuid, "energy-site")!;
    expect(value(site, "GridPower")).toBe(777);
    expect(
      site.characteristics.filter((c) => c.UUID !== hap.Characteristic.Name.UUID),
    ).toHaveLength(SERVICES.EnergySite.chars.length);
    expect(warnings).toEqual([]);
  });

  it("adds characteristics missing from a cached service and re-applies props", () => {
    const acc = newAccessory("old");
    // Simulate a service cached by an older plugin version: right UUID, only one characteristic.
    const old = new hap.Service("PV Array", SERVICES.PvArray.uuid, "pv:pv1");
    const stale = old.addCharacteristic(energyHapTypes(hap).char("MeterPower"));
    stale.setProps({ minValue: 0, maxValue: 10 });
    acc.addService(old);
    const warnings = collectWarnings(acc);

    new SiteEnergyServices(api, acc, () => NOW_MS).apply(energyFixture());

    const pv1 = find(acc, SERVICES.PvArray.uuid, "pv:pv1")!;
    expect(acc.services.filter((s) => s.UUID === SERVICES.PvArray.uuid)).toHaveLength(2);
    expect(pv1.getCharacteristic(energyHapTypes(hap).char("MeterPower")).props.maxValue).toBe(
      1_000_000,
    );
    expect(value(pv1, "MeterPower")).toBe(2100.4);
    expect(value(pv1, "MeterEnergyTotal")).toBe(1234.568);
    expect(warnings).toEqual([]);
  });

  it("removes services for meters and periods that disappear", () => {
    const acc = newAccessory("prune");
    const site = new SiteEnergyServices(api, acc, () => NOW_MS);
    site.apply(energyFixture());
    const fewer = energyFixture() as EvccState;
    fewer.pv = fewer.pv!.slice(0, 1);
    fewer.aux = [];
    fewer.statistics = { total: fewer.statistics!.total };
    site.apply(fewer);
    expect(find(acc, SERVICES.PvArray.uuid, "pv:pv2")).toBeUndefined();
    expect(find(acc, SERVICES.PvArray.uuid, "pv:pv1")).toBeDefined();
    expect(acc.services.some((s) => s.UUID === SERVICES.AuxMeter.uuid)).toBe(false);
    expect(find(acc, SERVICES.ChargingStatistics.uuid, "stat:30d")).toBeUndefined();

    site.removeAll();
    const customUuids = Object.values(SERVICES).map((s) => s.uuid as string);
    expect(acc.services.some((s) => customUuids.includes(s.UUID))).toBe(false);
  });
});
