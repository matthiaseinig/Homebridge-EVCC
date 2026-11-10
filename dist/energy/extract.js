"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.siteValues = siteValues;
exports.pvArrayEntries = pvArrayEntries;
exports.auxMeterEntries = auxMeterEntries;
exports.statisticsEntries = statisticsEntries;
exports.formatPlan = formatPlan;
exports.loadpointValues = loadpointValues;
const sanitize_js_1 = require("./sanitize.js");
const PERIOD_PATTERN = /^[A-Za-z0-9]{1,16}$/;
function records(v) {
    return Array.isArray(v)
        ? v.filter((x) => !!x && typeof x === "object")
        : [];
}
function sumField(meters, field) {
    const values = meters.map((m) => (0, sanitize_js_1.num)(m[field])).filter((x) => x !== undefined);
    return values.length > 0 ? values.reduce((a, b) => a + b, 0) : undefined;
}
function phase(values, index) {
    return Array.isArray(values) ? (0, sanitize_js_1.num)(values[index]) : undefined;
}
function siteValues(state, nowSeconds) {
    const pv = records(state.pv);
    const aux = records(state.aux);
    const grid = state.grid && typeof state.grid === "object" ? state.grid : {};
    const battery = state.battery && typeof state.battery === "object" ? state.battery : {};
    const devices = Array.isArray(battery.devices) ? battery.devices : undefined;
    return {
        PvPower: (0, sanitize_js_1.num)(state.pvPower) ?? sumField(pv, "power"),
        PvEnergyTotal: (0, sanitize_js_1.num)(state.pvEnergy) ?? sumField(pv, "energy"),
        GridPower: (0, sanitize_js_1.num)(grid.power),
        GridEnergyImportTotal: (0, sanitize_js_1.num)(grid.energy),
        GridEnergyExportTotal: (0, sanitize_js_1.num)(grid.returnEnergy),
        GridPowerL1: phase(grid.powers, 0),
        GridPowerL2: phase(grid.powers, 1),
        GridPowerL3: phase(grid.powers, 2),
        GridCurrentL1: phase(grid.currents, 0),
        GridCurrentL2: phase(grid.currents, 1),
        GridCurrentL3: phase(grid.currents, 2),
        HomePower: (0, sanitize_js_1.num)(state.homePower),
        AuxPower: (0, sanitize_js_1.num)(state.auxPower) ?? sumField(aux, "power"),
        BatteryPower: (0, sanitize_js_1.num)(battery.power),
        BatterySoc: (0, sanitize_js_1.num)(battery.soc),
        BatteryCapacity: (0, sanitize_js_1.num)(battery.capacity),
        BatteryEnergyDischargeTotal: (0, sanitize_js_1.num)(battery.energy),
        BatteryEnergyChargeTotal: (0, sanitize_js_1.num)(battery.returnEnergy),
        BatteryConfigured: devices ? devices.length > 0 : (0, sanitize_js_1.num)(battery.soc) !== undefined,
        GridConfigured: (0, sanitize_js_1.bool)(state.gridConfigured) ?? (0, sanitize_js_1.num)(grid.power) !== undefined,
        GreenShareHome: (0, sanitize_js_1.shareToPercent)(state.greenShareHome),
        GreenShareLoadpoints: (0, sanitize_js_1.shareToPercent)(state.greenShareLoadpoints),
        TariffGrid: (0, sanitize_js_1.num)(state.tariffGrid),
        TariffFeedIn: (0, sanitize_js_1.num)(state.tariffFeedIn),
        Currency: (0, sanitize_js_1.str)(state.currency),
        LastUpdate: nowSeconds,
    };
}
/**
 * One service entry per meter, keyed by the EVCC meter name (or, without a
 * name, its title). Meters with neither, and duplicates of a key already
 * seen, get no service: an index-based subtype would move to another meter
 * when the EVCC configuration is reordered.
 */
function meterEntries(meters, prefix, withEnergy) {
    const seen = new Set();
    const out = [];
    for (const m of records(meters)) {
        const id = (0, sanitize_js_1.str)(m.name) || (0, sanitize_js_1.str)(m.title);
        if (!id || seen.has(id))
            continue;
        seen.add(id);
        const values = { MeterId: id, MeterPower: (0, sanitize_js_1.num)(m.power) };
        if (withEnergy)
            values.MeterEnergyTotal = (0, sanitize_js_1.num)(m.energy);
        out.push({ subtype: `${prefix}:${id}`, label: (0, sanitize_js_1.str)(m.title) || id, values });
    }
    return out;
}
function pvArrayEntries(state) {
    return meterEntries(state.pv, "pv", true);
}
function auxMeterEntries(state) {
    return meterEntries(state.aux, "aux", false);
}
function statisticsEntries(state) {
    const stats = state.statistics;
    if (!stats || typeof stats !== "object" || Array.isArray(stats))
        return [];
    return Object.entries(stats)
        .filter((e) => PERIOD_PATTERN.test(e[0]) && !!e[1] && typeof e[1] === "object")
        .map(([period, p]) => ({
        period,
        values: {
            StatPeriod: period,
            StatChargedEnergy: (0, sanitize_js_1.num)(p.chargedKWh),
            StatSolarPercentage: (0, sanitize_js_1.num)(p.solarPercentage),
            StatAvgPrice: (0, sanitize_js_1.num)(p.avgPrice),
            StatAvgCo2: (0, sanitize_js_1.num)(p.avgCo2),
        },
    }));
}
/** `Set Plan` read value: `<soc>,<epoch seconds>`, or empty without a plan. */
function formatPlan(planTime, planSoc) {
    return planTime > 0 && planSoc !== undefined && planSoc > 0
        ? `${Math.round(planSoc)},${planTime}`
        : "";
}
function loadpointValues(lp, nowSeconds) {
    // Prefer the effective plan (covers repeating plans); fall back to the one-off plan.
    const effectiveTime = (0, sanitize_js_1.toEpochSeconds)(lp.effectivePlanTime);
    const planTime = effectiveTime || (0, sanitize_js_1.toEpochSeconds)(lp.planTime);
    const planSoc = effectiveTime ? (0, sanitize_js_1.num)(lp.effectivePlanSoc) : planTime ? (0, sanitize_js_1.num)(lp.planSoc) : undefined;
    return {
        ChargePower: (0, sanitize_js_1.num)(lp.chargePower),
        ChargeMode: (0, sanitize_js_1.str)(lp.mode),
        VehicleConnected: (0, sanitize_js_1.bool)(lp.connected),
        Charging: (0, sanitize_js_1.bool)(lp.charging),
        LimitSoc: (0, sanitize_js_1.num)(lp.limitSoc),
        VehicleSoc: (0, sanitize_js_1.num)(lp.vehicleSoc),
        VehicleRange: (0, sanitize_js_1.num)(lp.vehicleRange),
        VehicleName: (0, sanitize_js_1.str)(lp.vehicleName),
        VehicleTitle: (0, sanitize_js_1.str)(lp.vehicleTitle),
        SessionEnergy: (0, sanitize_js_1.whToKwh)(lp.sessionEnergy),
        TodayEnergy: (0, sanitize_js_1.whToKwh)(lp.todayEnergy),
        ChargeMeterTotal: (0, sanitize_js_1.num)(lp.chargeTotalImport),
        PlanTime: planTime,
        PlanSoc: planSoc,
        PlanActive: (0, sanitize_js_1.bool)(lp.planActive),
        LoadpointLastUpdate: nowSeconds,
        SetPlan: formatPlan(planTime, planSoc),
        ChargeLimit: (0, sanitize_js_1.num)(lp.limitSoc),
    };
}
//# sourceMappingURL=extract.js.map