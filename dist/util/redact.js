"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.redactSecret = redactSecret;
/**
 * Format a secret for log output without leaking it. Returns `"(none)"` for
 * empty values, the first 2 chars + `***` for short strings, otherwise the
 * first 4 chars + `***` + the last 2.
 */
function redactSecret(value) {
    if (!value)
        return "(none)";
    if (value.length <= 4)
        return `${value.slice(0, 2)}***`;
    if (value.length <= 8)
        return `${value.slice(0, 2)}***${value.slice(-1)}`;
    return `${value.slice(0, 4)}***${value.slice(-2)}`;
}
//# sourceMappingURL=redact.js.map