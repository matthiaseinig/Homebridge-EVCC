"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SessionsServer = exports.MAX_PAGE = exports.DEFAULT_PAGE = void 0;
exports.parseBound = parseBound;
const node_http_1 = require("node:http");
const node_crypto_1 = require("node:crypto");
const config_js_1 = require("./config.js");
const store_js_1 = require("./store.js");
const summary_js_1 = require("./summary.js");
/** Default and maximum page size of /v1/sessions. */
exports.DEFAULT_PAGE = 200;
exports.MAX_PAGE = 1000;
function safeEqual(a, b) {
    const ba = Buffer.from(a);
    const bb = Buffer.from(b);
    return ba.length === bb.length && (0, node_crypto_1.timingSafeEqual)(ba, bb);
}
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
/**
 * A `from` or `to` bound: `YYYY-MM-DD` (a local calendar day, covering the
 * whole day on both ends) or a full ISO time (`from` inclusive, `to`
 * exclusive). Undefined when invalid.
 */
function parseBound(value, edge) {
    const day = DAY.exec(value);
    if (day) {
        const y = Number(day[1]);
        const m = Number(day[2]);
        const d = Number(day[3]);
        const start = new Date(y, m - 1, d);
        if (start.getFullYear() !== y || start.getMonth() !== m - 1 || start.getDate() !== d) {
            return undefined;
        }
        return edge === "from" ? start.getTime() : new Date(y, m - 1, d + 1).getTime();
    }
    if (!/^\d{4}-\d{2}-\d{2}T/.test(value))
        return undefined;
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? ms : undefined;
}
function toApi(s) {
    return {
        id: s.key,
        created: new Date(s.created).toISOString(),
        finished: s.finished === null ? null : new Date(s.finished).toISOString(),
        loadpoint: s.loadpoint,
        vehicle: s.vehicle,
        chargedKWh: s.chargedKWh,
        solarPercentage: s.solarPercentage,
        price: s.price,
        pricePerKWh: s.pricePerKWh,
        co2PerKWh: s.co2PerKWh,
        chargeDurationSeconds: s.chargeDurationSeconds,
        odometer: s.odometer,
    };
}
/**
 * Small read-only JSON API for the session log. GET only, no redirects. It
 * binds to one literal private or loopback address (never a wildcard),
 * refuses requests from non-private peers, accepts only
 * `Host: <bindAddress>:<port>` (421 otherwise, which stops DNS rebinding) and
 * always requires `Authorization: Bearer`.
 *
 *   GET /v1/status
 *   GET /v1/sessions?from&to&limit&cursor      from/to: YYYY-MM-DD or ISO time
 *   GET /v1/sessions/summary?period=month|year[&from&to]
 */
class SessionsServer {
    opts;
    server = null;
    allowedHost = "";
    constructor(opts) {
        this.opts = opts;
        if (!(0, config_js_1.isPrivateAddress)(opts.bindAddress)) {
            throw new Error("sessions API must bind to a private or loopback address");
        }
        if (!opts.token)
            throw new Error("sessions API needs a token");
    }
    /** Resolves with the bound port (useful with port 0 in tests). */
    start() {
        return new Promise((resolve, reject) => {
            const server = (0, node_http_1.createServer)((req, res) => this.handle(req, res));
            server.once("error", reject);
            server.listen(this.opts.port, this.opts.bindAddress, () => {
                server.off("error", reject);
                this.server = server;
                const addr = server.address();
                const port = typeof addr === "object" && addr ? addr.port : this.opts.port;
                const host = this.opts.bindAddress.includes(":")
                    ? `[${this.opts.bindAddress}]`
                    : this.opts.bindAddress;
                this.allowedHost = `${host}:${port}`.toLowerCase();
                resolve(port);
            });
        });
    }
    stop() {
        const server = this.server;
        this.server = null;
        if (!server)
            return Promise.resolve();
        return new Promise((resolve) => {
            server.close(() => resolve());
            server.closeAllConnections();
        });
    }
    send(res, status, body) {
        res.writeHead(status, {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
        });
        res.end(JSON.stringify(body));
    }
    handle(req, res) {
        try {
            if (!(0, config_js_1.isPrivateAddress)(req.socket.remoteAddress ?? ""))
                return this.send(res, 403, { error: "forbidden" });
            if ((req.headers.host ?? "").toLowerCase() !== this.allowedHost) {
                return this.send(res, 421, { error: "misdirected request" });
            }
            if (req.method !== "GET") {
                res.setHeader("Allow", "GET");
                return this.send(res, 405, { error: "method not allowed" });
            }
            const header = req.headers.authorization ?? "";
            if (!header.startsWith("Bearer ") || !safeEqual(header.slice(7), this.opts.token)) {
                return this.send(res, 401, { error: "unauthorized" });
            }
            this.route(new URL(req.url ?? "/", "http://localhost"), res);
        }
        catch {
            this.send(res, 500, { error: "internal error" });
        }
    }
    range(q) {
        const range = {};
        const from = q.get("from");
        const to = q.get("to");
        if (from !== null && from !== "") {
            range.fromMs = parseBound(from, "from");
            if (range.fromMs === undefined)
                return "from must be YYYY-MM-DD or an ISO time";
        }
        if (to !== null && to !== "") {
            range.toMs = parseBound(to, "to");
            if (range.toMs === undefined)
                return "to must be YYYY-MM-DD or an ISO time";
        }
        return range;
    }
    route(url, res) {
        const { store } = this.opts;
        const q = url.searchParams;
        const bad = (msg) => this.send(res, 400, { error: msg });
        switch (url.pathname) {
            case "/v1/status": {
                const all = store.list();
                return this.send(res, 200, {
                    schema: 1,
                    sessions: store.count,
                    currency: store.currency,
                    oldest: all.length > 0 ? new Date(all[0].created).toISOString() : null,
                    newest: all.length > 0 ? new Date(all[all.length - 1].created).toISOString() : null,
                    lastUpdate: store.lastUpdate === null ? null : new Date(store.lastUpdate).toISOString(),
                    lastError: store.lastError,
                    units: {
                        chargedKWh: "kWh",
                        solarPercentage: "percent, 0 to 100",
                        price: "currency",
                        pricePerKWh: "currency per kWh",
                        co2PerKWh: "g per kWh",
                        chargeDurationSeconds: "s",
                        odometer: "km",
                        periods: "month and year buckets use the local time of the Homebridge host",
                    },
                });
            }
            case "/v1/sessions": {
                const range = this.range(q);
                if (typeof range === "string")
                    return bad(range);
                const limitRaw = q.get("limit");
                const limit = limitRaw === null ? exports.DEFAULT_PAGE : Number(limitRaw);
                if (!Number.isInteger(limit) || limit < 1 || limit > exports.MAX_PAGE) {
                    return bad(`limit must be an integer from 1 to ${exports.MAX_PAGE}`);
                }
                const cursor = q.get("cursor") ?? undefined;
                if (cursor !== undefined && !(0, store_js_1.parseCursor)(cursor))
                    return bad("cursor is not valid");
                const page = store.page(range, cursor, limit);
                return this.send(res, 200, {
                    currency: store.currency,
                    sessions: page.sessions.map(toApi),
                    next: page.next,
                });
            }
            case "/v1/sessions/summary": {
                const period = q.get("period");
                if (period !== "month" && period !== "year")
                    return bad("period must be month or year");
                const range = this.range(q);
                if (typeof range === "string")
                    return bad(range);
                return this.send(res, 200, {
                    period: period,
                    currency: store.currency,
                    buckets: (0, summary_js_1.summarize)(store.list(range), period),
                });
            }
            default:
                return this.send(res, 404, { error: "not found" });
        }
    }
}
exports.SessionsServer = SessionsServer;
//# sourceMappingURL=server.js.map