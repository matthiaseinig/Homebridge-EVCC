"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.statisticsEntries = statisticsEntries;
exports.loadpointValues = loadpointValues;
const sanitize_js_1 = require("./sanitize.js");
const PERIOD_PATTERN = /^[A-Za-z0-9]{1,16}$/;
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
        LastUpdate: nowSeconds,
    };
}
//# sourceMappingURL=extract.js.map