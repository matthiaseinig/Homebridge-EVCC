"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sanitize = sanitize;
exports.toEpochSeconds = toEpochSeconds;
exports.whToKwh = whToKwh;
exports.shareToPercent = shareToPercent;
exports.num = num;
exports.str = str;
exports.bool = bool;
/**
 * Coerce a raw EVCC value into something HAP accepts for `def` without
 * warnings: numbers are rounded to the declared decimals and clamped to the
 * declared range, strings are truncated to `maxLen`. A value EVCC did not
 * report becomes the neutral default (0, false or ""), as documented in the
 * contract.
 */
function sanitize(def, raw) {
    switch (def.format) {
        case "bool":
            return raw === true;
        case "string": {
            const s = typeof raw === "string" ? raw : "";
            return s.slice(0, def.maxLen ?? 64);
        }
        case "uint32":
        case "float": {
            const n = typeof raw === "number" && Number.isFinite(raw) ? raw : 0;
            const decimals = def.format === "uint32" ? 0 : (def.decimals ?? 3);
            const factor = 10 ** decimals;
            const rounded = Math.round(n * factor) / factor;
            const min = def.min ?? Number.NEGATIVE_INFINITY;
            const max = def.max ?? Number.POSITIVE_INFINITY;
            // `+ 0` folds a negative zero produced by rounding into a plain 0.
            return Math.min(max, Math.max(min, rounded)) + 0;
        }
    }
}
/** Parse an RFC 3339 timestamp into whole seconds since the epoch; 0 when absent or invalid. */
function toEpochSeconds(value) {
    if (typeof value !== "string" || value === "")
        return 0;
    const ms = Date.parse(value);
    if (!Number.isFinite(ms) || ms <= 0)
        return 0;
    return Math.floor(ms / 1000);
}
/** Watt-hours to kilowatt-hours; undefined stays undefined. */
function whToKwh(value) {
    return typeof value === "number" && Number.isFinite(value) ? value / 1000 : undefined;
}
/** A 0..1 share to percent; undefined stays undefined. */
function shareToPercent(value) {
    return typeof value === "number" && Number.isFinite(value) ? value * 100 : undefined;
}
function num(value) {
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
function str(value) {
    return typeof value === "string" ? value : undefined;
}
function bool(value) {
    return typeof value === "boolean" ? value : undefined;
}
//# sourceMappingURL=sanitize.js.map