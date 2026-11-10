"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SessionStore = exports.STORE_FILE = void 0;
exports.cursorOf = cursorOf;
exports.parseCursor = parseCursor;
const promises_1 = require("node:fs/promises");
const node_path_1 = require("node:path");
const fsutil_js_1 = require("./fsutil.js");
const model_js_1 = require("./model.js");
exports.STORE_FILE = "evcc-sessions.json";
const SCHEMA = 1;
/**
 * Session log kept in the Homebridge storage folder as one JSON file (0600,
 * written atomically). Bounded: the oldest sessions are dropped beyond
 * `maxSessions`. An unreadable file is moved aside, never overwritten.
 */
class SessionStore {
    maxSessions;
    file;
    byKey = new Map();
    sorted = [];
    currencyCode = "";
    updatedAt = null;
    lastSaved = "";
    writing = Promise.resolve();
    /** Short note about the last failed fetch; not persisted. */
    lastError = null;
    constructor(dir, maxSessions) {
        this.maxSessions = maxSessions;
        this.file = (0, node_path_1.join)(dir, exports.STORE_FILE);
    }
    get count() {
        return this.sorted.length;
    }
    get currency() {
        return this.currencyCode;
    }
    /** ms of the last successful fetch, null before the first one. */
    get lastUpdate() {
        return this.updatedAt;
    }
    async load(nowMs = Date.now()) {
        let text;
        try {
            text = await (0, promises_1.readFile)(this.file, "utf8");
        }
        catch {
            return {};
        }
        try {
            const data = JSON.parse(text);
            if (data.schema !== SCHEMA || !Array.isArray(data.sessions))
                throw new Error("schema");
            await (0, promises_1.chmod)(this.file, fsutil_js_1.FILE_MODE);
            this.replace(data.sessions.flatMap((s) => {
                const n = normalizeStored(s);
                return n ? [n] : [];
            }));
            this.currencyCode = typeof data.currency === "string" ? data.currency.slice(0, 8) : "";
            this.updatedAt = typeof data.lastUpdate === "number" ? data.lastUpdate : null;
            this.lastSaved = this.serialize();
            return {};
        }
        catch {
            return { backup: await (0, fsutil_js_1.backupAside)(this.file, nowMs) };
        }
    }
    /** Merge fetched sessions (newer data wins per key), prune and persist. */
    async update(fetched, currency, nowMs) {
        const merged = new Map(this.byKey);
        for (const s of fetched)
            merged.set(s.key, s);
        this.replace([...merged.values()]);
        if (currency)
            this.currencyCode = currency.slice(0, 8);
        this.updatedAt = nowMs;
        this.lastError = null;
        await this.save();
    }
    replace(list) {
        const sorted = [...list].sort(model_js_1.compareSessions);
        const kept = sorted.length > this.maxSessions ? sorted.slice(-this.maxSessions) : sorted;
        this.sorted = kept;
        this.byKey = new Map(kept.map((s) => [s.key, s]));
    }
    serialize() {
        const body = {
            schema: SCHEMA,
            currency: this.currencyCode,
            lastUpdate: this.updatedAt,
            sessions: this.sorted,
        };
        return JSON.stringify(body);
    }
    /** Persist when something changed; writes never overlap. */
    save() {
        const next = this.writing.then(async () => {
            const data = this.serialize();
            if (data === this.lastSaved)
                return;
            await (0, fsutil_js_1.writeFileAtomic)(this.file, data);
            this.lastSaved = data;
        });
        this.writing = next.catch(() => undefined);
        return next;
    }
    /** Sessions in `range`, oldest first. */
    list(range = {}) {
        return this.sorted.filter((s) => (range.fromMs === undefined || s.created >= range.fromMs) &&
            (range.toMs === undefined || s.created < range.toMs));
    }
    /** Sessions of one loadpoint (EVCC title), oldest first. */
    forLoadpoint(title) {
        return this.sorted.filter((s) => s.loadpoint === title);
    }
    /** One page of `list(range)`, starting at `cursor` (from a previous page's `next`). */
    page(range, cursor, limit) {
        const all = this.list(range);
        const start = cursor === undefined ? 0 : all.findIndex((s) => compareCursor(s, cursor) >= 0);
        if (start < 0)
            return { sessions: [], next: null };
        const sessions = all.slice(start, start + limit);
        const after = all[start + limit];
        return { sessions, next: after ? cursorOf(after) : null };
    }
}
exports.SessionStore = SessionStore;
function cursorOf(s) {
    return `${s.created}.${s.key}`;
}
/** Parse a cursor into start time and key; undefined when malformed. */
function parseCursor(cursor) {
    const m = /^(\d{1,15})\.(.{1,160})$/.exec(cursor);
    return m ? { created: Number(m[1]), key: m[2] } : undefined;
}
function compareCursor(s, cursor) {
    const c = parseCursor(cursor);
    if (!c)
        return 1;
    return s.created - c.created || (s.key < c.key ? -1 : s.key > c.key ? 1 : 0);
}
/** Re-validate a stored entry: it must already have the normalised shape. */
function normalizeStored(s) {
    if (!s || typeof s !== "object")
        return undefined;
    const r = s;
    const base = (0, model_js_1.normalizeSession)({
        created: typeof r.created === "number" ? new Date(r.created).toISOString() : undefined,
        finished: typeof r.finished === "number" ? new Date(r.finished).toISOString() : undefined,
        loadpoint: r.loadpoint,
        vehicle: r.vehicle,
        chargedEnergy: r.chargedKWh,
        solarPercentage: r.solarPercentage,
        price: r.price,
        pricePerKWh: r.pricePerKWh,
        co2PerKWh: r.co2PerKWh,
        chargeDuration: r.chargeDurationSeconds,
        odometer: r.odometer,
    });
    return base && typeof r.key === "string" ? { ...base, key: r.key.slice(0, 160) } : undefined;
}
//# sourceMappingURL=store.js.map