"use strict";
/**
 * Custom HomeKit characteristic and service definitions for EVCC energy data.
 *
 * These are read-only, notifying characteristics meant for apps that talk to
 * HomeKit directly (the Apple Home app ignores them). The UUIDs were generated
 * once and are a public contract: never change or reuse one. Add new entries
 * with new UUIDs instead. The full contract, including units, ranges, signs
 * and the EVCC source field of every characteristic, is in
 * docs/zuhause-contract.md and must be kept in sync with this file.
 *
 * UUID scheme: a random suffix shared by all types of this plugin, with an
 * `E5C0xxxx` prefix for characteristics and `E5C1xxxx` for services.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.SERVICES = exports.CHARS = exports.UUID_SUFFIX = void 0;
exports.UUID_SUFFIX = "-8B93-4652-90CD-F02EAF5356EA";
const charUuid = (n) => `E5C0${n}${exports.UUID_SUFFIX}`;
const serviceUuid = (n) => `E5C1${n}${exports.UUID_SUFFIX}`;
const POWER = { format: "float", unit: "W", min: -1_000_000, max: 1_000_000, decimals: 1 };
const ENERGY = { format: "float", unit: "kWh", min: 0, max: 1_000_000_000, decimals: 3 };
const CURRENT = { format: "float", unit: "A", min: -1_000, max: 1_000, decimals: 2 };
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
    // Generic meter characteristics, reused by the PV array and aux meter services.
    MeterPower: { uuid: charUuid("0001"), name: "Meter Power", ...POWER },
    MeterEnergyTotal: { uuid: charUuid("0002"), name: "Meter Energy Total", ...ENERGY },
    MeterId: { uuid: charUuid("0003"), name: "Meter ID", ...TEXT },
    // Site.
    PvPower: { uuid: charUuid("0010"), name: "PV Power", ...POWER },
    PvEnergyTotal: { uuid: charUuid("0011"), name: "PV Energy Total", ...ENERGY },
    GridPower: { uuid: charUuid("0012"), name: "Grid Power", ...POWER },
    GridEnergyImportTotal: { uuid: charUuid("0013"), name: "Grid Import Total", ...ENERGY },
    GridEnergyExportTotal: { uuid: charUuid("0014"), name: "Grid Export Total", ...ENERGY },
    GridPowerL1: { uuid: charUuid("0015"), name: "Grid Power L1", ...POWER },
    GridPowerL2: { uuid: charUuid("0016"), name: "Grid Power L2", ...POWER },
    GridPowerL3: { uuid: charUuid("0017"), name: "Grid Power L3", ...POWER },
    GridCurrentL1: { uuid: charUuid("0018"), name: "Grid Current L1", ...CURRENT },
    GridCurrentL2: { uuid: charUuid("0019"), name: "Grid Current L2", ...CURRENT },
    GridCurrentL3: { uuid: charUuid("001A"), name: "Grid Current L3", ...CURRENT },
    HomePower: { uuid: charUuid("001B"), name: "Home Power", ...POWER },
    AuxPower: { uuid: charUuid("001C"), name: "Aux Power", ...POWER },
    BatteryPower: { uuid: charUuid("001D"), name: "Battery Power", ...POWER },
    BatterySoc: { uuid: charUuid("001E"), name: "Battery SoC", ...PERCENT },
    BatteryCapacity: { uuid: charUuid("001F"), name: "Battery Capacity", ...ENERGY },
    BatteryEnergyDischargeTotal: {
        uuid: charUuid("0020"),
        name: "Battery Discharge Total",
        ...ENERGY,
    },
    BatteryEnergyChargeTotal: { uuid: charUuid("0021"), name: "Battery Charge Total", ...ENERGY },
    BatteryConfigured: { uuid: charUuid("0022"), name: "Battery Configured", ...FLAG },
    GridConfigured: { uuid: charUuid("0023"), name: "Grid Configured", ...FLAG },
    GreenShareHome: { uuid: charUuid("0024"), name: "Green Share Home", ...PERCENT },
    GreenShareLoadpoints: { uuid: charUuid("0025"), name: "Green Share Loadpoints", ...PERCENT },
    TariffGrid: { uuid: charUuid("0026"), name: "Tariff Grid", ...PRICE },
    TariffFeedIn: { uuid: charUuid("0027"), name: "Tariff Feed-In", ...PRICE },
    Currency: { uuid: charUuid("0028"), name: "Currency", format: "string", maxLen: 8 },
    LastUpdate: { uuid: charUuid("0029"), name: "Last Update", ...TIMESTAMP },
    // Loadpoint.
    ChargePower: { uuid: charUuid("0040"), name: "Charge Power", ...POWER },
    ChargeMode: { uuid: charUuid("0041"), name: "Charge Mode", format: "string", maxLen: 16 },
    VehicleConnected: { uuid: charUuid("0042"), name: "Vehicle Connected", ...FLAG },
    Charging: { uuid: charUuid("0043"), name: "Charging", ...FLAG },
    LimitSoc: { uuid: charUuid("0044"), name: "Limit SoC", ...PERCENT },
    VehicleSoc: { uuid: charUuid("0045"), name: "Vehicle SoC", ...PERCENT },
    VehicleRange: {
        uuid: charUuid("0046"),
        name: "Vehicle Range",
        format: "float",
        unit: "km",
        min: 0,
        max: 100_000,
        decimals: 0,
    },
    VehicleName: { uuid: charUuid("0047"), name: "Vehicle Name", ...TEXT },
    VehicleTitle: { uuid: charUuid("0048"), name: "Vehicle Title", ...TEXT },
    SessionEnergy: { uuid: charUuid("0049"), name: "Session Energy", ...ENERGY },
    TodayEnergy: { uuid: charUuid("004A"), name: "Today Energy", ...ENERGY },
    ChargeMeterTotal: { uuid: charUuid("004B"), name: "Charge Meter Total", ...ENERGY },
    PlanTime: { uuid: charUuid("004C"), name: "Plan Time", ...TIMESTAMP },
    PlanSoc: { uuid: charUuid("004D"), name: "Plan SoC", ...PERCENT },
    PlanActive: { uuid: charUuid("004E"), name: "Plan Active", ...FLAG },
    // Charging statistics (one service per EVCC statistics period).
    StatPeriod: { uuid: charUuid("0060"), name: "Statistics Period", format: "string", maxLen: 16 },
    StatChargedEnergy: { uuid: charUuid("0061"), name: "Charged Energy", ...ENERGY },
    StatSolarPercentage: { uuid: charUuid("0062"), name: "Solar Percentage", ...PERCENT },
    StatAvgPrice: { uuid: charUuid("0063"), name: "Average Price", ...PRICE },
    StatAvgCo2: {
        uuid: charUuid("0064"),
        name: "Average CO2",
        format: "float",
        unit: "g/kWh",
        min: 0,
        max: 100_000,
        decimals: 1,
    },
};
exports.SERVICES = {
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
        ],
    },
    ChargingStatistics: {
        uuid: serviceUuid("0005"),
        name: "Charging Statistics",
        chars: ["StatPeriod", "StatChargedEnergy", "StatSolarPercentage", "StatAvgPrice", "StatAvgCo2"],
    },
};
//# sourceMappingURL=definitions.js.map