/**
 * Custom HomeKit characteristic and service definitions for EVCC data.
 *
 * Two groups:
 *   - site energy (Energy Site, PV Array, Aux Meter): read-only
 *   - charging (Loadpoint Energy, Charging Statistics, control tags): read-only
 *     except Charge Mode and Set Plan, which forward writes to EVCC
 *
 * The UUIDs were generated once and are a public contract: never change or
 * reuse one. Add new entries with new UUIDs instead. The full contract,
 * including units, ranges, signs, the EVCC source field of every
 * characteristic and the charging controls, is in docs/zuhause-contract.md;
 * a test renders its tables from this file.
 *
 * UUID scheme: a random suffix shared by all types of this plugin, with an
 * `E5C0xxxx` prefix for characteristics and `E5C1xxxx` for services.
 */

export const UUID_SUFFIX = "-8B93-4652-90CD-F02EAF5356EA";

const charUuid = (n: string): string => `E5C0${n}${UUID_SUFFIX}`;
const serviceUuid = (n: string): string => `E5C1${n}${UUID_SUFFIX}`;

export type CharFormat = "float" | "uint32" | "bool" | "string";

export interface CharDef {
  readonly uuid: string;
  /** HAP display name of the characteristic. */
  readonly name: string;
  readonly format: CharFormat;
  /** Contract unit (documentation only, except "%" which maps to HAP's percentage unit). */
  readonly unit?: string;
  readonly min?: number;
  readonly max?: number;
  /** Values are rounded to this many decimals before they reach HAP. */
  readonly decimals?: number;
  /** Maximum string length (string format only). */
  readonly maxLen?: number;
  /** Paired write in addition to read and notify; the write is forwarded to EVCC. */
  readonly writable?: boolean;
  /** Contract: EVCC source field and conversion (documentation, checked against the contract). */
  readonly source: string;
  /** Contract: sign convention or value domain note (documentation). */
  readonly sign?: string;
}

const POWER = { format: "float", unit: "W", min: -1_000_000, max: 1_000_000, decimals: 1 } as const;
const ENERGY = { format: "float", unit: "kWh", min: 0, max: 1_000_000_000, decimals: 3 } as const;
const CURRENT = { format: "float", unit: "A", min: -1_000, max: 1_000, decimals: 2 } as const;
const PERCENT = { format: "float", unit: "%", min: 0, max: 100, decimals: 1 } as const;
const PRICE = {
  format: "float",
  unit: "currency/kWh",
  min: -1_000,
  max: 1_000,
  decimals: 4,
} as const;
const TIMESTAMP = {
  format: "uint32",
  unit: "s since 1970-01-01 UTC",
  min: 0,
  max: 4_294_967_295,
} as const;
const TEXT = { format: "string", maxLen: 64 } as const;
const FLAG = { format: "bool" } as const;

const IMPORT_EXPORT = "> 0 import from grid, < 0 export to grid";

export const CHARS = {
  // Site energy: generic meter characteristics, reused by PV Array and Aux Meter.
  MeterPower: {
    uuid: charUuid("0001"),
    name: "Meter Power",
    ...POWER,
    source: "`pv[i].power` / `aux[i].power`",
    sign: "as EVCC (PV normally >= 0)",
  },
  MeterEnergyTotal: {
    uuid: charUuid("0002"),
    name: "Meter Energy Total",
    ...ENERGY,
    source: "`pv[i].energy` (meter total)",
    sign: ">= 0",
  },
  MeterId: {
    uuid: charUuid("0003"),
    name: "Meter ID",
    ...TEXT,
    source: "`pv[i].name` / `aux[i].name` (EVCC meter name; `title` when the name is missing)",
  },

  // Site energy: Energy Site.
  PvPower: {
    uuid: charUuid("0010"),
    name: "PV Power",
    ...POWER,
    source: "`pvPower`; if absent, sum of `pv[].power`",
    sign: "as EVCC (normally >= 0)",
  },
  PvEnergyTotal: {
    uuid: charUuid("0011"),
    name: "PV Energy Total",
    ...ENERGY,
    source: "`pvEnergy`; if absent, sum of `pv[].energy`",
    sign: ">= 0",
  },
  GridPower: {
    uuid: charUuid("0012"),
    name: "Grid Power",
    ...POWER,
    source: "`grid.power`",
    sign: IMPORT_EXPORT,
  },
  GridEnergyImportTotal: {
    uuid: charUuid("0013"),
    name: "Grid Import Total",
    ...ENERGY,
    source: "`grid.energy` (meter total)",
    sign: ">= 0",
  },
  GridEnergyExportTotal: {
    uuid: charUuid("0014"),
    name: "Grid Export Total",
    ...ENERGY,
    source: "`grid.returnEnergy` (meter total)",
    sign: ">= 0",
  },
  GridPowerL1: {
    uuid: charUuid("0015"),
    name: "Grid Power L1",
    ...POWER,
    source: "`grid.powers[0]`",
    sign: IMPORT_EXPORT,
  },
  GridPowerL2: {
    uuid: charUuid("0016"),
    name: "Grid Power L2",
    ...POWER,
    source: "`grid.powers[1]`",
    sign: IMPORT_EXPORT,
  },
  GridPowerL3: {
    uuid: charUuid("0017"),
    name: "Grid Power L3",
    ...POWER,
    source: "`grid.powers[2]`",
    sign: IMPORT_EXPORT,
  },
  GridCurrentL1: {
    uuid: charUuid("0018"),
    name: "Grid Current L1",
    ...CURRENT,
    source: "`grid.currents[0]`",
    sign: "as the meter reports it",
  },
  GridCurrentL2: {
    uuid: charUuid("0019"),
    name: "Grid Current L2",
    ...CURRENT,
    source: "`grid.currents[1]`",
    sign: "as the meter reports it",
  },
  GridCurrentL3: {
    uuid: charUuid("001A"),
    name: "Grid Current L3",
    ...CURRENT,
    source: "`grid.currents[2]`",
    sign: "as the meter reports it",
  },
  HomePower: {
    uuid: charUuid("001B"),
    name: "Home Power",
    ...POWER,
    source: "`homePower`",
    sign: ">= 0",
  },
  AuxPower: {
    uuid: charUuid("001C"),
    name: "Aux Power",
    ...POWER,
    source: "`auxPower`; if absent, sum of `aux[].power`",
    sign: "as EVCC",
  },
  BatteryPower: {
    uuid: charUuid("001D"),
    name: "Battery Power",
    ...POWER,
    source: "`battery.power`",
    sign: "> 0 battery discharging, < 0 battery charging",
  },
  BatterySoc: {
    uuid: charUuid("001E"),
    name: "Battery SoC",
    ...PERCENT,
    source: "`battery.soc` (capacity weighted over all batteries)",
  },
  BatteryCapacity: {
    uuid: charUuid("001F"),
    name: "Battery Capacity",
    ...ENERGY,
    source: "`battery.capacity`",
    sign: ">= 0",
  },
  BatteryEnergyDischargeTotal: {
    uuid: charUuid("0020"),
    name: "Battery Discharge Total",
    ...ENERGY,
    source: "`battery.energy` (total discharged)",
    sign: ">= 0",
  },
  BatteryEnergyChargeTotal: {
    uuid: charUuid("0021"),
    name: "Battery Charge Total",
    ...ENERGY,
    source: "`battery.returnEnergy` (total charged)",
    sign: ">= 0",
  },
  BatteryConfigured: {
    uuid: charUuid("0022"),
    name: "Battery Configured",
    ...FLAG,
    source:
      "derived: `battery.devices` is non-empty; without a devices list, `battery.soc` is a number",
  },
  GridConfigured: {
    uuid: charUuid("0023"),
    name: "Grid Configured",
    ...FLAG,
    source: "`gridConfigured`; if absent, `grid.power` is a number",
  },
  GreenShareHome: {
    uuid: charUuid("0024"),
    name: "Green Share Home",
    ...PERCENT,
    source: "`greenShareHome` (0..1) x 100",
  },
  GreenShareLoadpoints: {
    uuid: charUuid("0025"),
    name: "Green Share Loadpoints",
    ...PERCENT,
    source: "`greenShareLoadpoints` (0..1) x 100",
  },
  TariffGrid: {
    uuid: charUuid("0026"),
    name: "Tariff Grid",
    ...PRICE,
    source: "`tariffGrid`",
    sign: "can be negative with dynamic tariffs",
  },
  TariffFeedIn: {
    uuid: charUuid("0027"),
    name: "Tariff Feed-In",
    ...PRICE,
    source: "`tariffFeedIn`",
  },
  Currency: {
    uuid: charUuid("0028"),
    name: "Currency",
    format: "string",
    maxLen: 8,
    source: "`currency` (ISO 4217 code)",
  },
  LastUpdate: {
    uuid: charUuid("0029"),
    name: "Last Update",
    ...TIMESTAMP,
    source: "plugin clock when it last applied any EVCC data (REST poll or any websocket frame)",
  },

  // Charging: Loadpoint Energy.
  ChargePower: {
    uuid: charUuid("0040"),
    name: "Charge Power",
    ...POWER,
    source: "`loadpoints[i].chargePower`",
    sign: ">= 0",
  },
  ChargeMode: {
    uuid: charUuid("0041"),
    name: "Charge Mode",
    format: "string",
    maxLen: 16,
    writable: true,
    source: "`loadpoints[i].mode`; write: `off`, `now`, `minpv` or `pv`",
  },
  VehicleConnected: {
    uuid: charUuid("0042"),
    name: "Vehicle Connected",
    ...FLAG,
    source: "`loadpoints[i].connected`",
  },
  Charging: {
    uuid: charUuid("0043"),
    name: "Charging",
    ...FLAG,
    source: "`loadpoints[i].charging`",
  },
  LimitSoc: {
    uuid: charUuid("0044"),
    name: "Limit SoC",
    ...PERCENT,
    source: "`loadpoints[i].limitSoc`",
    sign: "0 means no session limit",
  },
  VehicleSoc: {
    uuid: charUuid("0045"),
    name: "Vehicle SoC",
    ...PERCENT,
    source: "`loadpoints[i].vehicleSoc`",
    sign: "not a SoC for heating devices",
  },
  VehicleRange: {
    uuid: charUuid("0046"),
    name: "Vehicle Range",
    format: "float",
    unit: "km",
    min: 0,
    max: 100_000,
    decimals: 0,
    source: "`loadpoints[i].vehicleRange`",
    sign: ">= 0",
  },
  VehicleName: {
    uuid: charUuid("0047"),
    name: "Vehicle Name",
    ...TEXT,
    source: "`loadpoints[i].vehicleName` (key into `vehicles`)",
  },
  VehicleTitle: {
    uuid: charUuid("0048"),
    name: "Vehicle Title",
    ...TEXT,
    source: "`loadpoints[i].vehicleTitle`",
  },
  SessionEnergy: {
    uuid: charUuid("0049"),
    name: "Session Energy",
    ...ENERGY,
    source: "`loadpoints[i].sessionEnergy` (Wh) / 1000",
    sign: ">= 0",
  },
  TodayEnergy: {
    uuid: charUuid("004A"),
    name: "Today Energy",
    ...ENERGY,
    source: "`loadpoints[i].todayEnergy` (Wh) / 1000, since local midnight",
    sign: ">= 0",
  },
  ChargeMeterTotal: {
    uuid: charUuid("004B"),
    name: "Charge Meter Total",
    ...ENERGY,
    source: "`loadpoints[i].chargeTotalImport` (meter total)",
    sign: ">= 0",
  },
  PlanTime: {
    uuid: charUuid("004C"),
    name: "Plan Time",
    ...TIMESTAMP,
    source: "`loadpoints[i].effectivePlanTime`, else `planTime` (RFC 3339)",
    sign: "0 = no plan",
  },
  PlanSoc: {
    uuid: charUuid("004D"),
    name: "Plan SoC",
    ...PERCENT,
    source: "`effectivePlanSoc` when the effective plan is used, else `planSoc`",
    sign: "0 = no plan",
  },
  PlanActive: {
    uuid: charUuid("004E"),
    name: "Plan Active",
    ...FLAG,
    source: "`loadpoints[i].planActive`",
  },
  LoadpointLastUpdate: {
    uuid: charUuid("004F"),
    name: "Loadpoint Last Update",
    ...TIMESTAMP,
    source:
      "plugin clock when it last applied EVCC data for this loadpoint (REST poll or a websocket frame for this loadpoint)",
  },
  SetPlan: {
    uuid: charUuid("0050"),
    name: "Set Plan",
    format: "string",
    maxLen: 32,
    writable: true,
    source: "read: `<Plan SoC>,<Plan Time>` or empty; write: see Charging controls",
    sign: "empty = no plan",
  },

  // Charging: statistics (one service per EVCC statistics period).
  StatPeriod: {
    uuid: charUuid("0060"),
    name: "Statistics Period",
    format: "string",
    maxLen: 16,
    source: "key of `statistics` (`30d`, `365d`, `thisYear`, `total`)",
  },
  StatChargedEnergy: {
    uuid: charUuid("0061"),
    name: "Charged Energy",
    ...ENERGY,
    source: "`statistics.<period>.chargedKWh`",
    sign: ">= 0",
  },
  StatSolarPercentage: {
    uuid: charUuid("0062"),
    name: "Solar Percentage",
    ...PERCENT,
    source: "`statistics.<period>.solarPercentage`",
  },
  StatAvgPrice: {
    uuid: charUuid("0063"),
    name: "Average Price",
    ...PRICE,
    source: "`statistics.<period>.avgPrice`",
    sign: "configured currency",
  },
  StatAvgCo2: {
    uuid: charUuid("0064"),
    name: "Average CO2",
    format: "float",
    unit: "g/kWh",
    min: 0,
    max: 100_000,
    decimals: 1,
    source: "`statistics.<period>.avgCo2`",
    sign: ">= 0",
  },

  // Charging: tags on control services so apps can identify them without
  // relying on service names.
  ControlRole: {
    uuid: charUuid("0070"),
    name: "Control Role",
    format: "string",
    maxLen: 32,
    source: "plugin constant per control service (see Charging controls)",
  },
  ControlEnabled: {
    uuid: charUuid("0071"),
    name: "Control Enabled",
    ...FLAG,
    source: "plugin config: admin password set and the control accepts writes",
  },
} as const satisfies Record<string, CharDef>;

export type CharKey = keyof typeof CHARS;

export interface ServiceDef {
  readonly uuid: string;
  readonly name: string;
  readonly chars: readonly CharKey[];
}

export const SERVICES = {
  EnergySite: {
    uuid: serviceUuid("0001"),
    name: "Energy Site",
    chars: [
      "PvPower",
      "PvEnergyTotal",
      "GridPower",
      "GridEnergyImportTotal",
      "GridEnergyExportTotal",
      "GridPowerL1",
      "GridPowerL2",
      "GridPowerL3",
      "GridCurrentL1",
      "GridCurrentL2",
      "GridCurrentL3",
      "HomePower",
      "AuxPower",
      "BatteryPower",
      "BatterySoc",
      "BatteryCapacity",
      "BatteryEnergyDischargeTotal",
      "BatteryEnergyChargeTotal",
      "BatteryConfigured",
      "GridConfigured",
      "GreenShareHome",
      "GreenShareLoadpoints",
      "TariffGrid",
      "TariffFeedIn",
      "Currency",
      "LastUpdate",
    ],
  },
  PvArray: {
    uuid: serviceUuid("0002"),
    name: "PV Array",
    chars: ["MeterId", "MeterPower", "MeterEnergyTotal"],
  },
  AuxMeter: {
    uuid: serviceUuid("0003"),
    name: "Aux Meter",
    chars: ["MeterId", "MeterPower"],
  },
  LoadpointEnergy: {
    uuid: serviceUuid("0004"),
    name: "Loadpoint Energy",
    chars: [
      "ChargePower",
      "ChargeMode",
      "VehicleConnected",
      "Charging",
      "LimitSoc",
      "VehicleSoc",
      "VehicleRange",
      "VehicleName",
      "VehicleTitle",
      "SessionEnergy",
      "TodayEnergy",
      "ChargeMeterTotal",
      "PlanTime",
      "PlanSoc",
      "PlanActive",
      "LoadpointLastUpdate",
      "SetPlan",
    ],
  },
  ChargingStatistics: {
    uuid: serviceUuid("0005"),
    name: "Charging Statistics",
    chars: ["StatPeriod", "StatChargedEnergy", "StatSolarPercentage", "StatAvgPrice", "StatAvgCo2"],
  },
} as const satisfies Record<string, ServiceDef>;

export type ServiceKey = keyof typeof SERVICES;

/** Services that carry site energy (documented in the contract's site section). */
export const SITE_SERVICE_KEYS = ["EnergySite", "PvArray", "AuxMeter"] as const;
/** Services that carry charging data (documented in the contract's charging section). */
export const CHARGING_SERVICE_KEYS = ["LoadpointEnergy", "ChargingStatistics"] as const;

/** Values of the Control Role characteristic, one per control service. */
export const CONTROL_ROLES = {
  charging: "loadpoint-charging",
  outlet: "loadpoint-enable",
  limitLoadpoint: "loadpoint-limit-soc",
  limitVehicle: "vehicle-limit-soc",
  modeNow: "loadpoint-mode-now",
  modePv: "loadpoint-mode-pv",
  modeMinPv: "loadpoint-mode-minpv",
} as const;

/** A value ready for a characteristic, before sanitising. `undefined` means "not reported". */
export type RawValue = number | string | boolean | null | undefined;

export type CharValues = Partial<Record<CharKey, RawValue>>;
