"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SessionsService = exports.AFTER_SESSION_DELAY_MS = exports.POLL_INTERVAL_MS = void 0;
const model_js_1 = require("./model.js");
const server_js_1 = require("./server.js");
const store_js_1 = require("./store.js");
const token_js_1 = require("./token.js");
exports.POLL_INTERVAL_MS = 10 * 60_000;
/** Delay before the refresh that follows a charging or plug state change. */
exports.AFTER_SESSION_DELAY_MS = 10_000;
const FLAG_KEY = /^loadpoints\.(\d+)\.(charging|connected)$/;
/**
 * Keeps EVCC's session log: fetches it every 10 minutes and once shortly after
 * a loadpoint stops charging or is unplugged (seen on the websocket), stores
 * it, serves the optional LAN API and tells the platform when it changed.
 * Never writes to EVCC.
 */
class SessionsService {
    opts;
    store;
    server = null;
    pollTimer = null;
    soonTimer = null;
    running = false;
    refreshing = null;
    stopped = true;
    /** Bumped by every start and stop, so a start that is still loading knows it was stopped meanwhile. */
    generation = 0;
    flags = new Map();
    listeners = new Set();
    now;
    constructor(opts) {
        this.opts = opts;
        this.store = new store_js_1.SessionStore(opts.dir, opts.maxSessions);
        this.now = opts.now ?? Date.now;
    }
    onUpdated(listener) {
        this.listeners.add(listener);
    }
    async start() {
        this.stopped = false;
        const generation = ++this.generation;
        const live = () => generation === this.generation;
        const { log } = this.opts;
        try {
            const loaded = await this.store.load(this.now());
            if (loaded.backup) {
                log.warn("Session log was unreadable and was moved aside to %s", loaded.backup);
            }
        }
        catch (err) {
            log.warn("Could not read the session log: %s", err.message);
        }
        if (!live())
            return;
        this.emit();
        await this.startApi(live);
        if (!live())
            return;
        await this.refresh();
        if (!live())
            return;
        this.schedulePoll();
    }
    stop() {
        this.stopped = true;
        this.generation++;
        this.running = false;
        if (this.pollTimer)
            clearTimeout(this.pollTimer);
        if (this.soonTimer)
            clearTimeout(this.soonTimer);
        this.pollTimer = null;
        this.soonTimer = null;
        const server = this.server;
        this.server = null;
        void server?.stop();
    }
    /** Feed websocket updates; a charging or plug flag turning false schedules one refresh. */
    noteUpdate(key, value) {
        const m = FLAG_KEY.exec(key);
        if (!m || typeof value !== "boolean")
            return;
        const previous = this.flags.get(key);
        this.flags.set(key, value);
        if (previous === true && value === false)
            this.refreshSoon();
    }
    /** Feed the loadpoints of a REST snapshot, so a flag seen true there is known before the first websocket diff. */
    noteLoadpoints(loadpoints) {
        loadpoints.forEach((lp, i) => {
            this.noteUpdate(`loadpoints.${i}.charging`, lp.charging);
            this.noteUpdate(`loadpoints.${i}.connected`, lp.connected);
        });
    }
    /** Refresh once after a short delay; repeated calls within the delay collapse into one. */
    refreshSoon() {
        if (this.stopped || this.soonTimer)
            return;
        this.soonTimer = setTimeout(() => {
            this.soonTimer = null;
            void this.refresh();
        }, this.opts.afterSessionDelayMs ?? exports.AFTER_SESSION_DELAY_MS);
        this.soonTimer.unref?.();
    }
    /** Fetch, merge and persist now. Overlapping calls share one fetch. */
    refresh() {
        if (this.refreshing)
            return this.refreshing;
        this.refreshing = this.doRefresh().finally(() => {
            this.refreshing = null;
        });
        return this.refreshing;
    }
    async doRefresh() {
        const { log, source } = this.opts;
        try {
            const raw = await source.getSessions();
            const currency = source.getState().currency;
            await this.store.update((0, model_js_1.normalizeSessions)(raw), typeof currency === "string" ? currency : "", this.now());
            this.emit();
        }
        catch (err) {
            const message = err.message;
            this.store.lastError = message.slice(0, 200);
            log.warn("Could not refresh the charging sessions: %s", message);
        }
    }
    emit() {
        for (const l of this.listeners) {
            try {
                l();
            }
            catch (err) {
                this.opts.log.error("Sessions listener threw: %s", err.message);
            }
        }
    }
    schedulePoll() {
        if (this.stopped)
            return;
        this.pollTimer = setTimeout(() => {
            void this.refresh().finally(() => this.schedulePoll());
        }, this.opts.pollIntervalMs ?? exports.POLL_INTERVAL_MS);
        this.pollTimer.unref?.();
    }
    async startApi(live) {
        const api = this.opts.api;
        if (!api || this.running)
            return;
        const { log } = this.opts;
        try {
            const token = await (0, token_js_1.resolveApiToken)(this.opts.dir, api.token);
            if (!live())
                return;
            const server = new server_js_1.SessionsServer({
                bindAddress: api.bindAddress,
                port: api.port,
                token: token.token,
                store: this.store,
            });
            const port = await server.start();
            if (!live()) {
                await server.stop();
                return;
            }
            this.server = server;
            this.running = true;
            log.info("Sessions API listening on %s:%d (GET only, bearer token required)", api.bindAddress, port);
            if (token.generated && token.file) {
                log.info("Generated the sessions API token into %s (read it from there)", token.file);
            }
            else if (token.file) {
                log.info("Sessions API token is read from %s", token.file);
            }
        }
        catch (err) {
            log.error("Sessions API could not start: %s", err.message);
        }
    }
}
exports.SessionsService = SessionsService;
//# sourceMappingURL=service.js.map