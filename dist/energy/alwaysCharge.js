"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.hasAlwaysChargeApi = hasAlwaysChargeApi;
exports.alwaysChargeWritable = alwaysChargeWritable;
exports.alwaysChargeActive = alwaysChargeActive;
exports.planModeWrite = planModeWrite;
exports.legacySwitchMode = legacySwitchMode;
exports.parseAlwaysCharge = parseAlwaysCharge;
/**
 * EVCC 0.319 has three charge modes, `off`, `smart` and `now`. The former
 * `pv` and `minpv` modes became `smart` plus the loadpoint's "always charge"
 * setting (`alwaysCharge`: `off`, `on`, or `once` until the vehicle
 * disconnects; source: `api/chargemodestatus.go` and `core/loadpoint_api.go`
 * in evcc-io/evcc 0.319.0). Older EVCC versions publish no `alwaysCharge`
 * field and still use `pv` and `minpv` as real modes.
 */
/** Whether this EVCC instance publishes the always charge setting (0.319 and later). */
function hasAlwaysChargeApi(lp) {
    return typeof lp.alwaysCharge === "string";
}
/**
 * Whether always charge can be written at this loadpoint. EVCC rejects it for
 * switch-socket chargers, which cannot hold a minimum current.
 */
function alwaysChargeWritable(lp) {
    return hasAlwaysChargeApi(lp) && lp.chargerFeatureSwitchDevice !== true;
}
/**
 * Read value of the Always Charge characteristic: `on` and `once` are active.
 * On older EVCC the legacy modes carry the same meaning (`minpv` = always,
 * `pv` = solar only). Undefined when neither tells.
 */
function alwaysChargeActive(lp) {
    switch (lp.alwaysCharge) {
        case "on":
        case "once":
            return true;
        case "off":
            return false;
    }
    if (lp.mode === "minpv")
        return true;
    if (lp.mode === "pv")
        return false;
    return undefined;
}
/**
 * Map a Charge Mode write onto the EVCC API of this instance. On EVCC with
 * always charge, the deprecated `pv` becomes `smart` with always charge off
 * and `minpv` becomes `smart` with always charge on (the same mapping EVCC
 * applies in `ChargeMode.Normalize`; switch-socket chargers get no always
 * charge, as in EVCC's `normalizeMode`). Older EVCC gets the mode unchanged.
 */
function planModeWrite(mode, lp) {
    if (!hasAlwaysChargeApi(lp) || (mode !== "pv" && mode !== "minpv"))
        return { mode };
    if (!alwaysChargeWritable(lp))
        return { mode: "smart" };
    return { mode: "smart", alwaysCharge: mode === "minpv" ? "on" : "off" };
}
/**
 * The mode the legacy mode switches (Now, PV, Min+PV) show as active. On EVCC
 * with always charge, `smart` reads as `minpv` while always charge is active
 * and as `pv` otherwise.
 */
function legacySwitchMode(lp) {
    if (lp.mode !== "smart" || !hasAlwaysChargeApi(lp))
        return lp.mode;
    return alwaysChargeActive(lp) ? "minpv" : "pv";
}
/** Strictly parse an Always Charge write: a boolean (HAP may also send 1 or 0). */
function parseAlwaysCharge(value) {
    if (typeof value === "boolean")
        return value;
    if (value === 1 || value === 0)
        return value === 1;
    return undefined;
}
//# sourceMappingURL=alwaysCharge.js.map