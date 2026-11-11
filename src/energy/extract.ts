import type { EvccState, LoadpointState, MeterReading, StatisticsPeriod } from "../api/types.js";
import { alwaysChargeActive } from "./alwaysCharge.js";
import type { CharValues } from "./definitions.js";
import type { ServiceEntry } from "./serviceSet.js";
import { bool, num, shareToPercent, str, toEpochSeconds, whToKwh } from "./sanitize.js";

/**
 * Pure mappings from the EVCC `/api/state` tree to characteristic values.
 * Every value is taken from EVCC unchanged except for the documented unit
 * conversions (Wh to kWh, 0..1 share to percent, RFC 3339 to epoch seconds).
 * Signs follow EVCC: grid power > 0 is import, battery power > 0 is discharge.
 */

/** One charging statistics period. */
export interface StatisticsEntry {
  period: string;
  values: CharValues;
}

const PERIOD_PATTERN = /^[A-Za-z0-9]{1,16}$/;

function records(v: unknown): Record<string, unknown>[] {
  return Array.isArray(v)
    ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === "object")
    : [];
}

function sumField(
  meters: Record<string, unknown>[],
  field: "power" | "energy",
): number | undefined {
  const values = meters.map((m) => num(m[field])).filter((x): x is number => x !== undefined);
  return values.length > 0 ? values.reduce((a, b) => a + b, 0) : undefined;
}

function phase(values: unknown, index: number): number | undefined {
  return Array.isArray(values) ? num(values[index]) : undefined;
}

export function siteValues(state: EvccState, nowSeconds: number): CharValues {
  const pv = records(state.pv);
  const aux = records(state.aux);
  const grid: MeterReading = state.grid && typeof state.grid === "object" ? state.grid : {};
  const battery = state.battery && typeof state.battery === "object" ? state.battery : {};
  const devices = Array.isArray(battery.devices) ? battery.devices : undefined;

  return {
    PvPower: num(state.pvPower) ?? sumField(pv, "power"),
    PvEnergyTotal: num(state.pvEnergy) ?? sumField(pv, "energy"),
    GridPower: num(grid.power),
    GridEnergyImportTotal: num(grid.energy),
    GridEnergyExportTotal: num(grid.returnEnergy),
    GridPowerL1: phase(grid.powers, 0),
    GridPowerL2: phase(grid.powers, 1),
    GridPowerL3: phase(grid.powers, 2),
    GridCurrentL1: phase(grid.currents, 0),
    GridCurrentL2: phase(grid.currents, 1),
    GridCurrentL3: phase(grid.currents, 2),
    HomePower: num(state.homePower),
    AuxPower: num(state.auxPower) ?? sumField(aux, "power"),
    BatteryPower: num(battery.power),
    BatterySoc: num(battery.soc),
    BatteryCapacity: num(battery.capacity),
    BatteryEnergyDischargeTotal: num(battery.energy),
    BatteryEnergyChargeTotal: num(battery.returnEnergy),
    BatteryConfigured: devices ? devices.length > 0 : num(battery.soc) !== undefined,
    GridConfigured: bool(state.gridConfigured) ?? num(grid.power) !== undefined,
    GreenShareHome: shareToPercent(state.greenShareHome),
    GreenShareLoadpoints: shareToPercent(state.greenShareLoadpoints),
    TariffGrid: num(state.tariffGrid),
    TariffFeedIn: num(state.tariffFeedIn),
    Currency: str(state.currency),
    LastUpdate: nowSeconds,
  };
}

/**
 * One service entry per meter, keyed by the EVCC meter name (or, without a
 * name, its title). Meters with neither, and duplicates of a key already
 * seen, get no service: an index-based subtype would move to another meter
 * when the EVCC configuration is reordered.
 */
function meterEntries(meters: unknown, prefix: string, withEnergy: boolean): ServiceEntry[] {
  const seen = new Set<string>();
  const out: ServiceEntry[] = [];
  for (const m of records(meters)) {
    const id = str(m.name) || str(m.title);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const values: CharValues = { MeterId: id, MeterPower: num(m.power) };
    if (withEnergy) values.MeterEnergyTotal = num(m.energy);
    out.push({ subtype: `${prefix}:${id}`, label: str(m.title) || id, values });
  }
  return out;
}

export function pvArrayEntries(state: EvccState): ServiceEntry[] {
  return meterEntries(state.pv, "pv", true);
}

export function auxMeterEntries(state: EvccState): ServiceEntry[] {
  return meterEntries(state.aux, "aux", false);
}

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

/** `Set Plan` read value: `<soc>,<epoch seconds>`, or empty without a plan. */
export function formatPlan(planTime: number, planSoc: number | undefined): string {
  return planTime > 0 && planSoc !== undefined && planSoc > 0
    ? `${Math.round(planSoc)},${planTime}`
    : "";
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
    LoadpointLastUpdate: nowSeconds,
    SetPlan: formatPlan(planTime, planSoc),
    ChargeLimit: num(lp.limitSoc),
    AlwaysCharge: alwaysChargeActive(lp),
    MinCurrent: num(lp.effectiveMinCurrent) ?? num(lp.minCurrent),
  };
}
