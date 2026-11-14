"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WRITABLE_CHARGE_MODES = void 0;
exports.parseChargeMode = parseChargeMode;
exports.parseChargeLimit = parseChargeLimit;
exports.parsePlanRequest = parsePlanRequest;
exports.toRfc3339 = toRfc3339;
/** Modes the plugin forwards to EVCC. Anything else is rejected before EVCC is called. */
exports.WRITABLE_CHARGE_MODES = ["off", "now", "minpv", "pv"];
/** Strictly parse a Charge Mode write; undefined when the value is not one of the four modes. */
function parseChargeMode(value) {
    return typeof value === "string" && exports.WRITABLE_CHARGE_MODES.includes(value)
        ? value
        : undefined;
}
/**
 * Strictly parse a Charge Limit write: an integer number 0 .. 100 (0 clears the
 * session limit in EVCC). Strings, booleans, fractions and non-finite numbers
 * return undefined.
 */
function parseChargeLimit(value) {
    return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 100
        ? value
        : undefined;
}
const PLAN_PATTERN = /^(\d{1,3}),(\d{1,10})$/;
const MAX_EPOCH = 4_294_967_295;
/**
 * Strictly parse a Set Plan write:
 *   - "" or "0"                     clear the plan
 *   - "<soc>,<epoch seconds>"       soc an integer 1..100, time in the future
 * Anything else returns undefined.
 */
function parsePlanRequest(value, nowSeconds) {
    if (value === "" || value === "0")
        return { kind: "clear" };
    if (typeof value !== "string")
        return undefined;
    const m = PLAN_PATTERN.exec(value);
    if (!m)
        return undefined;
    const soc = Number(m[1]);
    const time = Number(m[2]);
    if (soc < 1 || soc > 100)
        return undefined;
    if (time <= nowSeconds || time > MAX_EPOCH)
        return undefined;
    return { kind: "set", soc, time };
}
/** Epoch seconds as RFC 3339 in UTC without fractional seconds, as EVCC's REST API expects. */
function toRfc3339(epochSeconds) {
    return new Date(epochSeconds * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
}
//# sourceMappingURL=writeValidation.js.map