"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_MAX_SESSIONS = exports.DEFAULT_API_PORT = void 0;
exports.isPrivateAddress = isPrivateAddress;
exports.parseSessionsConfig = parseSessionsConfig;
const node_net_1 = require("node:net");
const token_js_1 = require("./token.js");
exports.DEFAULT_API_PORT = 8768;
exports.DEFAULT_MAX_SESSIONS = 5000;
/** True for loopback, RFC 1918, link-local and unique-local addresses (never a host name). */
function isPrivateAddress(address) {
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
    const addr = mapped ? mapped[1] : address;
    const family = (0, node_net_1.isIP)(addr);
    if (family === 4) {
        const [a, b] = addr.split(".").map(Number);
        return (a === 10 ||
            a === 127 ||
            (a === 172 && b >= 16 && b <= 31) ||
            (a === 192 && b === 168) ||
            (a === 169 && b === 254));
    }
    if (family === 6) {
        const lower = addr.toLowerCase();
        if (lower === "::1")
            return true;
        const first = parseInt(lower.split(":")[0] || "0", 16);
        return (first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80;
    }
    return false;
}
function intIn(v, fallback, min, max) {
    const n = typeof v === "number" && Number.isFinite(v) ? v : fallback;
    return Math.round(Math.min(max, Math.max(min, n)));
}
function str(v) {
    return typeof v === "string" ? v.trim() : "";
}
function obj(v) {
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
}
/** Parse the `sessions` block of the plugin config; invalid API settings switch the API off. */
function parseSessionsConfig(raw) {
    const s = obj(raw);
    const errors = [];
    const config = {
        enabled: s.enabled !== false,
        maxSessions: intIn(s.maxSessions, exports.DEFAULT_MAX_SESSIONS, 100, 50_000),
    };
    const a = obj(s.api);
    if (a.enabled === true) {
        const bindAddress = str(a.bindAddress);
        const token = str(a.token);
        if (!isPrivateAddress(bindAddress)) {
            errors.push("sessions.api.bindAddress must be a literal private or loopback IP address (not 0.0.0.0, not a host name), sessions API is off");
        }
        else if (token !== "" && token.length < token_js_1.MIN_CONFIGURED_TOKEN_LENGTH) {
            errors.push(`sessions.api.token must be at least ${token_js_1.MIN_CONFIGURED_TOKEN_LENGTH} characters (or empty to generate one), sessions API is off`);
        }
        else {
            config.api = {
                bindAddress,
                port: intIn(a.port, exports.DEFAULT_API_PORT, 1024, 65535),
                ...(token !== "" ? { token } : {}),
            };
        }
    }
    return { config, errors };
}
//# sourceMappingURL=config.js.map