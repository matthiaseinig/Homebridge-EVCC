import type { EvccState, LoadpointState, MeterReading, StatisticsPeriod } from "../api/types.js";
import type { CharValues } from "./definitions.js";
import { bool, num, shareToPercent, str, toEpochSeconds, whToKwh } from "./sanitize.js";

/**
 * Pure mappings from the EVCC `/api/state` tree to characteristic values.
 * Every value is taken from EVCC unchanged except for the documented unit
 * conversions (Wh to kWh, 0..1 share to percent, RFC 3339 to epoch seconds).
 * Signs follow EVCC: grid power > 0 is import, battery power > 0 is discharge.
 */

/** One per-meter entry (PV array or aux consumer). */
export interface MeterEntry {
  /** Stable key used as the HAP service subtype. */
  key: string;
  /** Display name for the service. */
  label: string;
  values: CharValues;
}

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

function meterEntries(
  meters: unknown,
  prefix: string,
  fallbackLabel: string,
  withEnergy: boolean,
): MeterEntry[] {
  const seen = new Set<string>();
  const out: MeterEntry[] = [];
  records(meters).forEach((m, index) => {
    const name = str(m.name);
    let key = `${prefix}:${name ?? `#${index}`}`;
    // Duplicate names would collide on the HAP subtype; fall back to the index.
    if (seen.has(key)) key = `${prefix}:#${index}`;
    seen.add(key);
    const values: CharValues = { MeterId: name, MeterPower: num(m.power) };
    if (withEnergy) values.MeterEnergyTotal = num(m.energy);
    out.push({ key, label: str(m.title) || name || `${fallbackLabel} ${index + 1}`, values });
  });
  return out;
}

export function pvArrayEntries(state: EvccState): MeterEntry[] {
  return meterEntries(state.pv, "pv", "PV", true);
}

export function auxMeterEntries(state: EvccState): MeterEntry[] {
  return meterEntries(state.aux, "aux", "Aux", false);
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

export function loadpointValues(lp: LoadpointState): CharValues {
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
  };
}
