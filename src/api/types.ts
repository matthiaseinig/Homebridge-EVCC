/**
 * EVCC API types — derived from the upstream OpenAPI 3.1 spec
 * (https://raw.githubusercontent.com/evcc-io/docs/refs/heads/main/static/openapi.yaml)
 * and the live `/api/state` payload from demo.evcc.io. The State surface is
 * intentionally loose: the upstream schema is documented as "structure may
 * change between releases", so we only type the fields we actually consume.
 */

export type ChargeMode = "off" | "now" | "minpv" | "pv";

export interface VehicleState {
  /** Stable name (slug) used as the path identifier in the REST API. */
  name?: string;
  /** Human-readable title from the EVCC config. */
  title?: string;
  /** Target SOC for the vehicle, percent. */
  limitSoc?: number;
  /** Minimum SOC for the vehicle, percent. */
  minSoc?: number;
}

export interface LoadpointState {
  /** Display title from the EVCC config. */
  title?: string;
  /** Charging mode. */
  mode?: ChargeMode;
  /** Whether a vehicle is plugged in. */
  connected?: boolean;
  /** Whether the loadpoint is actively delivering power. */
  charging?: boolean;
  /** Loadpoint enabled flag (mode != "off" and not paused). */
  enabled?: boolean;
  /** Current charge power in watts. */
  chargePower?: number;
  /** Energy delivered in this session, Wh (the upstream OpenAPI text says kWh; the code publishes Wh). */
  sessionEnergy?: number;
  /** SOC limit for the loadpoint, percent. */
  limitSoc?: number;
  /** Energy limit for the loadpoint, kWh. */
  limitEnergy?: number;
  /** Reported vehicle SOC, percent. */
  vehicleSoc?: number;
  /** Reported vehicle range, km. */
  vehicleRange?: number;
  /** Currently assigned vehicle slug (matches VehicleState.name). */
  vehicleName?: string;
  /** Currently assigned vehicle display title. */
  vehicleTitle?: string;
  /** Energy charged since local midnight, Wh (the upstream OpenAPI text says kWh; the code publishes Wh). */
  todayEnergy?: number;
  /** Charge meter total import, kWh. */
  chargeTotalImport?: number;
  /** Target time of the currently applied plan (RFC 3339), null when none. */
  effectivePlanTime?: string | null;
  /** SoC goal of the currently applied plan, percent. */
  effectivePlanSoc?: number;
  /** Target time of the (non-repeating) plan (RFC 3339), null when none. */
  planTime?: string | null;
  /** SoC goal of the (non-repeating) plan, percent. */
  planSoc?: number;
  /** Whether the planner has determined the current slot to be an active charging slot. */
  planActive?: boolean;
}

export interface BatteryDevice {
  power?: number;
  capacity?: number;
  soc?: number;
  controllable?: boolean;
}

export interface MeterReading {
  /** Stable meter name from the EVCC config (e.g. "pv1" or "db:3"). */
  name?: string;
  /** Display title from the EVCC config. */
  title?: string;
  /** Current power, W. */
  power?: number;
  /** Meter total, kWh (import / production). */
  energy?: number;
  /** Meter total in the opposite direction, kWh (export). */
  returnEnergy?: number;
  /** Power per phase, W. */
  powers?: number[];
  /** Current per phase, A. */
  currents?: number[];
}

/** One period of EVCC's charging statistics (`statistics.<period>`). */
export interface StatisticsPeriod {
  avgCo2?: number;
  avgPrice?: number;
  chargedKWh?: number;
  solarPercentage?: number;
}

export type BatteryMode = "unknown" | "normal" | "hold" | "charge";

export interface SiteState {
  siteTitle?: string;
  battery?: {
    power?: number;
    capacity?: number;
    soc?: number;
    /** Total discharged energy, kWh. */
    energy?: number;
    /** Total charged energy, kWh. */
    returnEnergy?: number;
    devices?: BatteryDevice[];
  };
  batteryMode?: BatteryMode;
  pv?: MeterReading[];
  pvPower?: number;
  pvEnergy?: number;
  grid?: MeterReading;
  gridConfigured?: boolean;
  homePower?: number;
  aux?: MeterReading[];
  auxPower?: number;
  /** Green share of home consumption, 0..1. */
  greenShareHome?: number;
  /** Green share of loadpoint consumption, 0..1. */
  greenShareLoadpoints?: number;
  /** Current grid price per kWh, configured currency. */
  tariffGrid?: number;
  /** Current feed-in price per kWh, configured currency. */
  tariffFeedIn?: number;
  currency?: string;
  statistics?: Record<string, StatisticsPeriod>;
  loadpoints?: LoadpointState[];
  vehicles?: Record<string, VehicleState>;
}

/** Full state snapshot returned by GET /api/state. */
export type EvccState = SiteState & Record<string, unknown>;

/**
 * A flattened key/value pair pushed over the EVCC websocket. Keys may be
 * dotted paths into the state tree (e.g. "loadpoints.0.chargePower") or
 * top-level site keys (e.g. "pvPower").
 */
export interface WebSocketUpdate {
  key: string;
  value: unknown;
}
