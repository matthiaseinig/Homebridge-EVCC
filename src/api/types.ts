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
  /** Energy delivered in this session, kWh. */
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
}

export interface BatteryDevice {
  power?: number;
  capacity?: number;
  soc?: number;
  controllable?: boolean;
}

export interface MeterReading {
  power?: number;
  energy?: number;
}

export type BatteryMode = "unknown" | "normal" | "hold" | "charge";

export interface SiteState {
  siteTitle?: string;
  battery?: { power?: number; capacity?: number; soc?: number; devices?: BatteryDevice[] };
  batteryMode?: BatteryMode;
  pv?: MeterReading[];
  pvPower?: number;
  pvEnergy?: number;
  grid?: MeterReading;
  homePower?: number;
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
