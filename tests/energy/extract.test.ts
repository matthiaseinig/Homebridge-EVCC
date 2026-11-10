import { describe, expect, it } from "vitest";
import type { EvccState, LoadpointState } from "../../src/api/types.js";
import { loadpointValues, statisticsEntries } from "../../src/energy/extract.js";
import { FIXTURE_PLAN_EPOCH, energyFixture } from "./fixtures.js";

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
      LastUpdate: 1_900_000_000,
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
