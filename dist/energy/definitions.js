"use strict";
/**
 * Custom HomeKit characteristic and service definitions for EVCC charging data.
 *
 * These are read-only, notifying characteristics meant for apps that talk to
 * HomeKit directly (the Apple Home app ignores them). The UUIDs were generated
 * once and are a public contract: never change or reuse one, including the
 * retired ones listed in RETIRED. Add new entries with new UUIDs instead. The
 * full contract, including units, ranges, signs, the EVCC source field of
 * every characteristic and the charging controls, is in
 * docs/zuhause-contract.md and must be kept in sync with this file.
 *
 * Site energy (PV, battery, grid, home, aux) is deliberately not exposed by
 * this plugin; the consuming app gets it from a dedicated inverter plugin.
 *
 * UUID scheme: a random suffix shared by all types of this plugin, with an
 * `E5C0xxxx` prefix for characteristics and `E5C1xxxx` for services.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.RETIRED = exports.CONTROL_ROLES = exports.SERVICES = exports.CHARS = exports.UUID_SUFFIX = void 0;
exports.UUID_SUFFIX = "-8B93-4652-90CD-F02EAF5356EA";
const charUuid = (n) => `E5C0${n}${exports.UUID_SUFFIX}`;
const serviceUuid = (n) => `E5C1${n}${exports.UUID_SUFFIX}`;
const POWER = { format: "float", unit: "W", min: -1_000_000, max: 1_000_000, decimals: 1 };
const ENERGY = { format: "float", unit: "kWh", min: 0, max: 1_000_000_000, decimals: 3 };
const PERCENT = { format: "float", unit: "%", min: 0, max: 100, decimals: 1 };
const PRICE = {
    format: "float",
    unit: "currency/kWh",
    min: -1_000,
    max: 1_000,
    decimals: 4,
};
const TIMESTAMP = {
    format: "uint32",
    unit: "s since 1970-01-01 UTC",
    min: 0,
    max: 4_294_967_295,
};
const TEXT = { format: "string", maxLen: 64 };
const FLAG = { format: "bool" };
exports.CHARS = {
    // Loadpoint.
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
        source: "`loadpoints[i].mode`: `off`, `now`, `minpv`, `pv` (passed through, future EVCC modes included)",
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
    LastUpdate: {
        uuid: charUuid("004F"),
        name: "Last Update",
        ...TIMESTAMP,
        source: "plugin clock when it last applied EVCC data for this loadpoint (REST poll or a websocket frame for this loadpoint)",
    },
    // Charging statistics (one service per EVCC statistics period).
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
    // Added to the existing standard control services so apps can identify them
    // without relying on service names.
    ControlRole: {
        uuid: charUuid("0070"),
        name: "Control Role",
        format: "string",
        maxLen: 32,
        source: "plugin constant per control service (see Charging controls)",
    },
    // True when a write to the control is forwarded to EVCC (admin password
    // configured and the control is not read-only by configuration).
    ControlEnabled: {
        uuid: charUuid("0071"),
        name: "Control Enabled",
        ...FLAG,
        source: "plugin config: admin password set and the control has a write handler",
    },
};
exports.SERVICES = {
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
            "LastUpdate",
        ],
    },
    ChargingStatistics: {
        uuid: serviceUuid("0005"),
        name: "Charging Statistics",
        chars: ["StatPeriod", "StatChargedEnergy", "StatSolarPercentage", "StatAvgPrice", "StatAvgCo2"],
    },
};
/** Values of the Control Role characteristic, one per existing control service. */
exports.CONTROL_ROLES = {
    outlet: "loadpoint-enable",
    limitLoadpoint: "loadpoint-limit-soc",
    limitVehicle: "vehicle-limit-soc",
    modeNow: "loadpoint-mode-now",
    modePv: "loadpoint-mode-pv",
    modeMinPv: "loadpoint-mode-minpv",
};
/**
 * Retired UUIDs: site energy types that were defined during development of
 * this feature and then dropped (site energy comes from a dedicated inverter
 * plugin). They were never released. Never reuse them; services with a
 * retired UUID are removed from cached accessories.
 */
exports.RETIRED = {
    services: {
        [serviceUuid("0001")]: "Energy Site",
        [serviceUuid("0002")]: "PV Array",
        [serviceUuid("0003")]: "Aux Meter",
    },
    characteristics: {
        [charUuid("0001")]: "Meter Power",
        [charUuid("0002")]: "Meter Energy Total",
        [charUuid("0003")]: "Meter ID",
        [charUuid("0010")]: "PV Power",
        [charUuid("0011")]: "PV Energy Total",
        [charUuid("0012")]: "Grid Power",
        [charUuid("0013")]: "Grid Import Total",
        [charUuid("0014")]: "Grid Export Total",
        [charUuid("0015")]: "Grid Power L1",
        [charUuid("0016")]: "Grid Power L2",
        [charUuid("0017")]: "Grid Power L3",
        [charUuid("0018")]: "Grid Current L1",
        [charUuid("0019")]: "Grid Current L2",
        [charUuid("001A")]: "Grid Current L3",
        [charUuid("001B")]: "Home Power",
        [charUuid("001C")]: "Aux Power",
        [charUuid("001D")]: "Battery Power",
        [charUuid("001E")]: "Battery SoC",
        [charUuid("001F")]: "Battery Capacity",
        [charUuid("0020")]: "Battery Discharge Total",
        [charUuid("0021")]: "Battery Charge Total",
        [charUuid("0022")]: "Battery Configured",
        [charUuid("0023")]: "Grid Configured",
        [charUuid("0024")]: "Green Share Home",
        [charUuid("0025")]: "Green Share Loadpoints",
        [charUuid("0026")]: "Tariff Grid",
        [charUuid("0027")]: "Tariff Feed-In",
        [charUuid("0028")]: "Currency",
        [charUuid("0029")]: "Last Update",
    },
};
//# sourceMappingURL=definitions.js.map