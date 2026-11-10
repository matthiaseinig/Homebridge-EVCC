import type { EvccState, LoadpointState, StatisticsPeriod } from "../api/types.js";
import type { CharValues } from "./definitions.js";
import { bool, num, str, toEpochSeconds, whToKwh } from "./sanitize.js";

/**
 * Pure mappings from the EVCC `/api/state` tree to characteristic values.
 * Every value is taken from EVCC unchanged except for the documented unit
 * conversions (Wh to kWh, RFC 3339 to epoch seconds).
 */

/** One charging statistics period. */
export interface StatisticsEntry {
  period: string;
  values: CharValues;
}

const PERIOD_PATTERN = /^[A-Za-z0-9]{1,16}$/;

export function statisticsEntries(state: EvccState): StatisticsEntry[] {
  const stats = state.statistics;
  if (!stats || typeof stats !== "object" || Array.isArray(stats)) return [];
  return Object.entries(stats)
    .filter(
      (e): e is [string, StatisticsPeriod] =>
        PERIOD_PATTERN.test(e[0]) && !!e[1] && typeof e[1] === "object",
    )
    .map(([period, p]) => ({
      period,
      values: {
        StatPeriod: period,
        StatChargedEnergy: num(p.chargedKWh),
        StatSolarPercentage: num(p.solarPercentage),
        StatAvgPrice: num(p.avgPrice),
        StatAvgCo2: num(p.avgCo2),
      },
    }));
}

export function loadpointValues(lp: LoadpointState, nowSeconds: number): CharValues {
  // Prefer the effective plan (covers repeating plans); fall back to the one-off plan.
  const effectiveTime = toEpochSeconds(lp.effectivePlanTime);
  const planTime = effectiveTime || toEpochSeconds(lp.planTime);
  const planSoc = effectiveTime ? num(lp.effectivePlanSoc) : planTime ? num(lp.planSoc) : undefined;
  return {
    ChargePower: num(lp.chargePower),
    ChargeMode: str(lp.mode),
    VehicleConnected: bool(lp.connected),
    Charging: bool(lp.charging),
    LimitSoc: num(lp.limitSoc),
    VehicleSoc: num(lp.vehicleSoc),
    VehicleRange: num(lp.vehicleRange),
    VehicleName: str(lp.vehicleName),
    VehicleTitle: str(lp.vehicleTitle),
    SessionEnergy: whToKwh(lp.sessionEnergy),
    TodayEnergy: whToKwh(lp.todayEnergy),
    ChargeMeterTotal: num(lp.chargeTotalImport),
    PlanTime: planTime,
    PlanSoc: planSoc,
    PlanActive: bool(lp.planActive),
    LastUpdate: nowSeconds,
  };
}
