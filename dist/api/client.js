import { EventEmitter } from "node:events";
import WebSocket from "ws";
import { redactSecret } from "../util/redact.js";
import { applyUpdate, parseFrame } from "./decoders.js";
export const DEFAULT_POLL_INTERVAL_MS = 30_000;
export const DEFAULT_RECONNECT_DELAY_MS = 5_000;
export const MAX_RECONNECT_DELAY_MS = 60_000;
export const REQUEST_TIMEOUT_MS = 10_000;
/**
 * Talks to a single EVCC instance over REST and (optionally) WebSocket.
 *
 * The REST poll keeps state correct even when the WS drops; the WS gives us
 * sub-second pushes when it's available. Auth is only required for write
 * operations (`setLoadpointMode`, `setLoadpointLimitSoc`, …) — without a
 * password the client still works in read-only mode.
 */
export class EvccClient extends EventEmitter {
    baseUrl;
    password;
    log;
    pollIntervalMs;
    fetchImpl;
    webSocketCtor;
    cookie;
    cookieRefreshAt = 0;
    pollTimer = null;
    socket = null;
    reconnectTimer = null;
    reconnectDelay = DEFAULT_RECONNECT_DELAY_MS;
    stopped = false;
    state = {};
    typedListeners = {
        state: new Set(),
        update: new Set(),
        connect: new Set(),
        disconnect: new Set(),
    };
    constructor(opts) {
        super();
        this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
        this.password = opts.password;
        this.log = opts.log;
        this.pollIntervalMs = opts.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
        this.fetchImpl = opts.fetchImpl ?? fetch;
        this.webSocketCtor = opts.webSocketCtor ?? WebSocket;
    }
    /** Snapshot of the most recently observed state. Returned by reference — don't mutate. */
    getState() {
        return this.state;
    }
    /** Authenticate (if a password was given) and start the REST poll + WS subscription. */
    async start() {
        this.stopped = false;
        if (this.password) {
            try {
                await this.login();
            }
            catch (err) {
                this.log.warn("EVCC login failed (%s). Read-only mode will still work; settable HomeKit controls will be disabled.", err.message);
            }
        }
        await this.refreshState();
        this.scheduleNextPoll();
        this.connectSocket();
    }
    /** Stop polling and disconnect the websocket. Idempotent. */
    stop() {
        this.stopped = true;
        if (this.pollTimer) {
            clearTimeout(this.pollTimer);
            this.pollTimer = null;
        }
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        if (this.socket) {
            try {
                this.socket.close();
            }
            catch {
                // ignore
            }
            this.socket = null;
        }
    }
    on(event, listener) {
        this.typedListeners[event].add(listener);
        return this;
    }
    off(event, listener) {
        this.typedListeners[event].delete(listener);
        return this;
    }
    dispatch(event, ...args) {
        for (const listener of this.typedListeners[event]) {
            try {
                listener(...args);
            }
            catch (err) {
                this.log.error("Listener for %s threw: %s", event, err.message);
            }
        }
    }
    // ---------------------------------------------------------------------------
    // Auth
    // ---------------------------------------------------------------------------
    async login() {
        const url = `${this.baseUrl}/api/auth/login`;
        this.log.debug("EVCC login → %s (password=%s)", url, redactSecret(this.password));
        const res = await this.fetchImpl(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ password: this.password ?? "" }),
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        if (!res.ok) {
            throw new Error(`EVCC login HTTP ${res.status}`);
        }
        const setCookie = res.headers.get("set-cookie");
        if (setCookie) {
            const match = /auth=([^;]+)/.exec(setCookie);
            if (match) {
                this.cookie = `auth=${match[1]}`;
                this.cookieRefreshAt = Date.now() + 60 * 60 * 1000;
            }
        }
    }
    // ---------------------------------------------------------------------------
    // REST: state + commands
    // ---------------------------------------------------------------------------
    /** Pull the full `/api/state` snapshot and emit a `state` event. */
    async refreshState() {
        const url = `${this.baseUrl}/api/state`;
        const res = await this.fetchImpl(url, {
            headers: this.authHeaders(),
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        if (!res.ok) {
            throw new Error(`GET /api/state HTTP ${res.status}`);
        }
        const data = (await res.json());
        // Older builds wrap state in `{ result: ... }`. Newer builds return it bare.
        const state = data && typeof data === "object" && "result" in data && data.result
            ? data.result
            : data;
        this.state = state;
        this.dispatch("state", state);
        return state;
    }
    async setLoadpointMode(loadpointId, mode) {
        await this.post(`/api/loadpoints/${loadpointId}/mode/${mode}`);
    }
    async setLoadpointLimitSoc(loadpointId, soc) {
        await this.post(`/api/loadpoints/${loadpointId}/limitsoc/${Math.round(soc)}`);
    }
    async setVehicleLimitSoc(vehicleName, soc) {
        await this.post(`/api/vehicles/${encodeURIComponent(vehicleName)}/limitsoc/${Math.round(soc)}`);
    }
    async setBatteryMode(mode) {
        await this.post(`/api/batterymode/${mode}`);
    }
    async post(path) {
        if (!this.cookie && this.password) {
            // Best-effort re-login; if it fails the POST will surface a 401.
            await this.login().catch(() => undefined);
        }
        const url = `${this.baseUrl}${path}`;
        const res = await this.fetchImpl(url, {
            method: "POST",
            headers: this.authHeaders(),
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        if (!res.ok) {
            // 401 → cookie likely expired; flush so the next call re-logs in.
            if (res.status === 401)
                this.cookie = undefined;
            throw new Error(`POST ${path} HTTP ${res.status}`);
        }
    }
    authHeaders() {
        const h = { Accept: "application/json" };
        if (this.cookie && Date.now() < this.cookieRefreshAt)
            h.Cookie = this.cookie;
        return h;
    }
    scheduleNextPoll() {
        if (this.stopped)
            return;
        if (this.pollTimer)
            clearTimeout(this.pollTimer);
        this.pollTimer = setTimeout(() => {
            void this.refreshState()
                .catch((err) => {
                this.log.warn("EVCC poll failed: %s", err.message);
            })
                .finally(() => this.scheduleNextPoll());
        }, this.pollIntervalMs);
        // Don't keep the Node event loop alive on `setTimeout` alone.
        this.pollTimer.unref?.();
    }
    // ---------------------------------------------------------------------------
    // WebSocket
    // ---------------------------------------------------------------------------
    connectSocket() {
        if (this.stopped)
            return;
        const wsUrl = this.baseUrl.replace(/^http/, "ws") + "/ws";
        this.log.debug("EVCC WebSocket → %s", wsUrl);
        let socket;
        try {
            socket = new this.webSocketCtor(wsUrl, { headers: this.authHeaders() });
        }
        catch (err) {
            this.log.warn("EVCC WS construct failed: %s", err.message);
            this.scheduleReconnect();
            return;
        }
        this.socket = socket;
        socket.on("open", () => {
            this.reconnectDelay = DEFAULT_RECONNECT_DELAY_MS;
            this.log.info("Connected to EVCC websocket at %s", wsUrl);
            this.dispatch("connect");
        });
        socket.on("message", (raw) => {
            const text = Buffer.isBuffer(raw)
                ? raw.toString("utf-8")
                : Array.isArray(raw)
                    ? Buffer.concat(raw).toString("utf-8")
                    : raw instanceof ArrayBuffer
                        ? Buffer.from(raw).toString("utf-8")
                        : String(raw);
            const updates = parseFrame(text);
            for (const u of updates) {
                const touched = applyUpdate(this.state, u);
                this.dispatch("update", u, touched);
            }
        });
        socket.on("close", (code, reason) => {
            const why = `close ${code} ${reason.toString("utf-8") || "(no reason)"}`;
            this.log.debug("EVCC WS %s", why);
            this.dispatch("disconnect", why);
            this.socket = null;
            this.scheduleReconnect();
        });
        socket.on("error", (err) => {
            this.log.warn("EVCC WS error: %s", err.message);
        });
    }
    scheduleReconnect() {
        if (this.stopped)
            return;
        if (this.reconnectTimer)
            return;
        const delay = this.reconnectDelay;
        this.reconnectDelay = Math.min(this.reconnectDelay * 2, MAX_RECONNECT_DELAY_MS);
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            this.connectSocket();
        }, delay);
        this.reconnectTimer.unref?.();
    }
}
//# sourceMappingURL=client.js.map