import { describe, expect, it } from "vitest";
import type { EvccState, LoadpointState } from "../../src/api/types.js";
import {
  auxMeterEntries,
  formatPlan,
  loadpointValues,
  pvArrayEntries,
  siteValues,
  statisticsEntries,
} from "../../src/energy/extract.js";
import { FIXTURE_PLAN_EPOCH, energyFixture } from "./fixtures.js";

const NOW = 1_900_000_000;

describe("siteValues", () => {
  it("maps every site field from the newer state layout", () => {
    const v = siteValues(energyFixture(), NOW);
    expect(v).toEqual({
      PvPower: 3050,
      PvEnergyTotal: 1690.6678,
      GridPower: -1250.06,
      GridEnergyImportTotal: 2000.123,
      GridEnergyExportTotal: 1500.987,
      GridPowerL1: -400.1,
      GridPowerL2: -425,
      GridPowerL3: -424.96,
      GridCurrentL1: -1.744,
      GridCurrentL2: -1.85,
      GridCurrentL3: -1.849,
      HomePower: 1000,
      AuxPower: 120,
      BatteryPower: -800,
      BatterySoc: 55.55,
      BatteryCapacity: 10,
      BatteryEnergyDischargeTotal: 300.25,
      BatteryEnergyChargeTotal: 320.5,
      BatteryConfigured: true,
      GridConfigured: true,
      GreenShareHome: 87.5,
      GreenShareLoadpoints: 100,
      TariffGrid: 0.3012,
      TariffFeedIn: 0.081,
      Currency: "EUR",
      LastUpdate: NOW,
    });
  });

  it("falls back to summing pv[] and aux[] when the site totals are missing", () => {
    const s = energyFixture() as Record<string, unknown>;
    delete s.pvPower;
    delete s.pvEnergy;
    delete s.auxPower;
    const v = siteValues(s as EvccState, NOW);
    expect(v.PvPower).toBeCloseTo(3050.44, 6);
    expect(v.PvEnergyTotal).toBeCloseTo(1690.6678, 6);
    expect(v.AuxPower).toBe(120);
  });

  it("reports nothing (undefined) for fields EVCC omits", () => {
    const v = siteValues({} as EvccState, NOW);
    expect(v.PvPower).toBeUndefined();
    expect(v.GridPower).toBeUndefined();
    expect(v.GridPowerL2).toBeUndefined();
    expect(v.BatterySoc).toBeUndefined();
    expect(v.BatteryConfigured).toBe(false);
    expect(v.GridConfigured).toBe(false);
    expect(v.LastUpdate).toBe(NOW);
  });

  it("derives BatteryConfigured from soc when there is no devices list", () => {
    expect(siteValues({ battery: { soc: 10 } } as EvccState, NOW).BatteryConfigured).toBe(true);
    expect(siteValues({ battery: { devices: [] } } as EvccState, NOW).BatteryConfigured).toBe(
      false,
    );
  });

  it("derives GridConfigured from grid.power when gridConfigured is absent", () => {
    expect(siteValues({ grid: { power: 5 } } as EvccState, NOW).GridConfigured).toBe(true);
    const off = { gridConfigured: false, grid: { power: 5 } } as EvccState;
    expect(siteValues(off, NOW).GridConfigured).toBe(false);
  });

  it("ignores non-numeric phase arrays and garbage meters", () => {
    const s = {
      grid: { powers: "nope", currents: [1, "x"] },
      pv: [null, 7, { power: "high" }],
    } as unknown as EvccState;
    const v = siteValues(s, NOW);
    expect(v.GridPowerL1).toBeUndefined();
    expect(v.GridCurrentL1).toBe(1);
    expect(v.GridCurrentL2).toBeUndefined();
    expect(v.PvPower).toBeUndefined();
  });
});

describe("meter entries", () => {
  it("builds one PV entry per array keyed by the EVCC meter name", () => {
    expect(pvArrayEntries(energyFixture())).toEqual([
      {
        subtype: "pv:pv1",
        label: "Array A",
        values: { MeterId: "pv1", MeterPower: 2100.44, MeterEnergyTotal: 1234.5678 },
      },
      {
        subtype: "pv:pv2",
        label: "Array B",
        values: { MeterId: "pv2", MeterPower: 950, MeterEnergyTotal: 456.1 },
      },
    ]);
  });

  it("builds aux entries without an energy value", () => {
    expect(auxMeterEntries(energyFixture())).toEqual([
      { subtype: "aux:aux1", label: "Aux A", values: { MeterId: "aux1", MeterPower: 120 } },
    ]);
  });

  it("keys by title without a name and never by index; skips anonymous and duplicate meters", () => {
    const s = {
      pv: [
        { power: 1 },
        { title: "Roofless", power: 2 },
        { name: "x", power: 3 },
        { name: "x", title: "Again", power: 4 },
      ],
    } as unknown as EvccState;
    const entries = pvArrayEntries(s);
    expect(entries.map((e) => e.subtype)).toEqual(["pv:Roofless", "pv:x"]);
    expect(entries.map((e) => e.label)).toEqual(["Roofless", "x"]);
    expect(entries[0].values.MeterId).toBe("Roofless");
  });

  it("keeps the subtype when the EVCC order changes", () => {
    const s = energyFixture();
    const reversed = { ...s, pv: [...s.pv!].reverse() } as EvccState;
    const byId = (st: EvccState) =>
      Object.fromEntries(pvArrayEntries(st).map((e) => [e.subtype, e.values.MeterPower]));
    expect(byId(reversed)).toEqual(byId(s));
  });

  it("returns no entries when the arrays are absent", () => {
    expect(pvArrayEntries({} as EvccState)).toEqual([]);
    expect(auxMeterEntries({ aux: {} } as unknown as EvccState)).toEqual([]);
  });
});

describe("statisticsEntries", () => {
  it("maps each statistics period", () => {
    expect(statisticsEntries(energyFixture())).toEqual([
      {
        period: "30d",
        values: {
          StatPeriod: "30d",
          StatChargedEnergy: 150.5,
          StatSolarPercentage: 62.3,
          StatAvgPrice: 0.21,
          StatAvgCo2: 210.5,
        },
      },
      {
        period: "total",
        values: {
          StatPeriod: "total",
          StatChargedEnergy: 4000.25,
          StatSolarPercentage: 48.2,
          StatAvgPrice: 0.25,
          StatAvgCo2: 250,
        },
      },
    ]);
  });

  it("skips malformed periods and non-object statistics", () => {
    const s = {
      statistics: { "bad key": {}, thisYear: null, ok: { chargedKWh: 1 } },
    } as unknown as EvccState;
    expect(statisticsEntries(s).map((e) => e.period)).toEqual(["ok"]);
    expect(statisticsEntries({ statistics: [] } as unknown as EvccState)).toEqual([]);
    expect(statisticsEntries({} as EvccState)).toEqual([]);
  });
});

describe("loadpointValues", () => {
  it("maps loadpoint fields, converting Wh to kWh and the plan time to epoch seconds", () => {
    const lp = energyFixture().loadpoints![0];
    expect(loadpointValues(lp, 1_900_000_000)).toEqual({
      ChargePower: 3700,
      ChargeMode: "pv",
      VehicleConnected: true,
      Charging: true,
      LimitSoc: 80,
      VehicleSoc: 42,
      VehicleRange: 180,
      VehicleName: "car1",
      VehicleTitle: "Car One",
      SessionEnergy: 5.432,
      TodayEnergy: 7.65,
      ChargeMeterTotal: 987.654,
      PlanTime: FIXTURE_PLAN_EPOCH,
      PlanSoc: 90,
      PlanActive: false,
      LoadpointLastUpdate: 1_900_000_000,
      SetPlan: `90,${FIXTURE_PLAN_EPOCH}`,
      ChargeLimit: 80,
    });
  });

  it("falls back to the one-off plan when no effective plan is set", () => {
    const lp: LoadpointState = {
      effectivePlanTime: null,
      effectivePlanSoc: 0,
      planTime: "2030-01-02T06:30:00Z",
      planSoc: 70,
    };
    const v = loadpointValues(lp, 0);
    expect(v.PlanTime).toBe(FIXTURE_PLAN_EPOCH);
    expect(v.PlanSoc).toBe(70);
  });

  it("reports no plan for null, invalid or zero-time plan values", () => {
    for (const t of [null, "", "garbage", "0001-01-01T00:00:00Z"]) {
      const v = loadpointValues({ effectivePlanTime: t, effectivePlanSoc: 80 }, 0);
      expect(v.PlanTime).toBe(0);
      expect(v.PlanSoc).toBeUndefined();
    }
  });

  it("leaves absent fields undefined", () => {
    const v = loadpointValues({}, 0);
    expect(v.ChargePower).toBeUndefined();
    expect(v.SessionEnergy).toBeUndefined();
    expect(v.VehicleConnected).toBeUndefined();
  });
});

describe("formatPlan", () => {
  it("formats soc and time, and is empty without a plan", () => {
    expect(formatPlan(1_900_000_000, 79.6)).toBe("80,1900000000");
    expect(formatPlan(0, 80)).toBe("");
    expect(formatPlan(1_900_000_000, undefined)).toBe("");
    expect(formatPlan(1_900_000_000, 0)).toBe("");
  });
});
