"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.describeSecret = describeSecret;
exports.redactUrl = redactUrl;
/**
 * Describe a secret for log output without revealing any part of it: only
 * whether one is configured.
 */
function describeSecret(value) {
    return value ? "configured" : "not configured";
}
/**
 * Strip credentials (user:password@) from a URL before logging it. Input that
 * does not parse as a URL is replaced entirely rather than risk leaking it.
 */
function redactUrl(value) {
    if (!value)
        return "(none)";
    try {
        const u = new URL(value);
        if (u.username || u.password) {
            u.username = "";
            u.password = "";
            return u.toString().replace(/^([a-z]+:\/\/)/i, "$1***@");
        }
        return value;
    }
    catch {
        return "(invalid url)";
    }
}
//# sourceMappingURL=redact.js.map