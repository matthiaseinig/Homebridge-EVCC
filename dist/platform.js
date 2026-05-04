"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EvccPlatform = void 0;
const client_js_1 = require("./api/client.js");
const decoders_js_1 = require("./api/decoders.js");
const loadpointAccessory_js_1 = require("./accessories/loadpointAccessory.js");
const siteAccessory_js_1 = require("./accessories/siteAccessory.js");
const vehiclePresenceAccessory_js_1 = require("./accessories/vehiclePresenceAccessory.js");
const settings_js_1 = require("./settings.js");
const SITE_ACCESSORY_KEY = "evcc-site";
const LOADPOINT_KEY = (i) => `evcc-loadpoint-${i}`;
const VEHICLE_KEY = (name) => `evcc-vehicle-${name}`;
class EvccPlatform {
    log;
    config;
    api;
    Service;
    Characteristic;
    accessories = [];
    client = null;
    debug;
    // Adopted accessory wrappers, keyed for fast lookup.
    siteAccessory = null;
    loadpoints = new Map();
    vehicles = new Map();
    /** Whether write commands to EVCC are permitted. Flips to true after a successful login. */
    writable = false;
    constructor(log, config, api, deps = {}) {
        this.log = log;
        this.config = config;
        this.api = api;
        this.Service = api.hap.Service;
        this.Characteristic = api.hap.Characteristic;
        this.debug = !!config.debug;
        if (!config.url) {
            log.error("No 'url' configured. Add your EVCC base URL (e.g. http://evcc.local:7070) to the Homebridge config — the plugin will stay idle until you do.");
            return;
        }
        this.writable = !!config.password;
        this.client =
            deps.client ??
                new client_js_1.EvccClient({
                    baseUrl: config.url,
                    password: config.password,
                    log,
                    pollIntervalMs: config.pollInterval ? config.pollInterval * 1000 : undefined,
                });
        this.client.on("state", (state) => this.onState(state));
        this.client.on("update", (update, touched) => this.onUpdate(update, touched));
        this.client.on("connect", () => log.debug("EVCC websocket connected"));
        this.client.on("disconnect", (reason) => log.debug("EVCC websocket disconnected: %s", reason));
        api.on("didFinishLaunching", () => {
            void this.start();
        });
        api.on("shutdown", () => this.stop());
    }
    configureAccessory(accessory) {
        this.log.debug("Restoring cached accessory: %s", accessory.displayName);
        this.accessories.push(accessory);
    }
    async start() {
        if (!this.client)
            return;
        this.log.info("Starting EVCC platform (url=%s, writable=%s)", this.config.url, this.writable);
        try {
            await this.client.start();
        }
        catch (err) {
            this.log.error("Failed to reach EVCC: %s. The plugin will keep retrying in the background.", err.message);
            return;
        }
    }
    stop() {
        if (!this.client)
            return;
        this.log.info("EVCC platform shutting down.");
        for (const lp of this.loadpoints.values())
            lp.dispose();
        for (const v of this.vehicles.values())
            v.dispose();
        this.siteAccessory?.dispose();
        this.loadpoints.clear();
        this.vehicles.clear();
        this.siteAccessory = null;
        this.client.stop();
    }
    // ---------------------------------------------------------------------------
    // Reconciliation
    // ---------------------------------------------------------------------------
    onState(state) {
        this.adoptSite(state);
        this.adoptLoadpoints(state);
        this.adoptVehicles(state);
        this.pruneStale(state);
    }
    onUpdate(update, touched) {
        if (this.debug)
            this.log.debug("EVCC update: %s = %j", update.key, update.value);
        const state = this.client.getState();
        // Site-level keys: re-render the site card on every change. It's cheap.
        if (this.siteAccessory && !update.key.startsWith("loadpoints.")) {
            this.siteAccessory.applyState(state);
        }
        // Per-loadpoint diff: forward only the trailing key segment.
        if (update.key.startsWith("loadpoints.")) {
            for (const idx of touched) {
                const lp = this.loadpoints.get(idx);
                if (!lp)
                    continue;
                const path = update.key.split(".");
                if (path.length === 2) {
                    // Whole loadpoint object replaced.
                    const value = state.loadpoints?.[idx];
                    if (value)
                        lp.applyState(value);
                }
                else if (path.length >= 3) {
                    lp.applyPartial(path.slice(2).join("."), update.value);
                }
            }
        }
        // Connected / vehicleName changes can flip vehicle-presence sensors.
        if (update.key.startsWith("loadpoints.") &&
            (update.key.endsWith(".connected") ||
                update.key.endsWith(".vehicleName") ||
                update.key.split(".").length === 2)) {
            const lps = (0, decoders_js_1.asLoadpointArray)(state.loadpoints);
            for (const v of this.vehicles.values())
                v.applyLoadpoints(lps);
        }
    }
    // ---------------------------------------------------------------------------
    // Adoption
    // ---------------------------------------------------------------------------
    adoptSite(state) {
        if (this.config.hideSite)
            return;
        const uuid = this.api.hap.uuid.generate(SITE_ACCESSORY_KEY);
        const cached = this.accessories.find((a) => a.UUID === uuid);
        let accessory;
        let isNew = false;
        if (cached) {
            accessory = cached;
            accessory.displayName = state.siteTitle ?? "EVCC";
        }
        else {
            const Ctor = this.api.platformAccessory;
            accessory = new Ctor(state.siteTitle ?? "EVCC", uuid);
            isNew = true;
        }
        accessory.context.kind = "site";
        if (this.siteAccessory) {
            this.siteAccessory.applyState(state);
        }
        else {
            this.siteAccessory = new siteAccessory_js_1.SiteAccessory({
                api: this.api,
                log: this.log,
                client: this.client,
                accessory,
                state,
                writable: this.writable,
            });
        }
        if (isNew) {
            this.log.info("Adopted EVCC site accessory.");
            this.api.registerPlatformAccessories(settings_js_1.PLUGIN_NAME, settings_js_1.PLATFORM_NAME, [accessory]);
            this.accessories.push(accessory);
        }
    }
    adoptLoadpoints(state) {
        const lps = (0, decoders_js_1.asLoadpointArray)(state.loadpoints);
        for (let idx = 0; idx < lps.length; idx++) {
            this.adoptLoadpoint(idx, lps[idx]);
        }
    }
    adoptLoadpoint(idx, lp) {
        const uuid = this.api.hap.uuid.generate(LOADPOINT_KEY(idx));
        const cached = this.accessories.find((a) => a.UUID === uuid);
        const title = lp.title ?? `Loadpoint ${idx + 1}`;
        let accessory;
        let isNew = false;
        if (cached) {
            accessory = cached;
            accessory.displayName = title;
        }
        else {
            const Ctor = this.api.platformAccessory;
            accessory = new Ctor(title, uuid);
            isNew = true;
        }
        accessory.context.kind = "loadpoint";
        accessory.context.loadpointId = idx;
        const existing = this.loadpoints.get(idx);
        if (existing) {
            existing.applyState(lp);
        }
        else {
            this.loadpoints.set(idx, new loadpointAccessory_js_1.LoadpointAccessory({
                api: this.api,
                log: this.log,
                client: this.client,
                accessory,
                loadpointId: idx,
                state: lp,
                config: {
                    modeUi: this.config.loadpointMode ?? "outlet",
                    defaultMode: this.config.defaultLoadpointMode ?? "pv",
                    exposeVehicleLimit: !!this.config.exposeVehicleLimit,
                    writable: this.writable,
                },
            }));
        }
        if (isNew) {
            this.log.info("Adopted loadpoint #%d (%s).", idx + 1, title);
            this.api.registerPlatformAccessories(settings_js_1.PLUGIN_NAME, settings_js_1.PLATFORM_NAME, [accessory]);
            this.accessories.push(accessory);
        }
    }
    adoptVehicles(state) {
        if (this.config.hideVehiclePresence)
            return;
        const vehicles = state.vehicles ?? {};
        const lps = (0, decoders_js_1.asLoadpointArray)(state.loadpoints);
        for (const [name, raw] of Object.entries(vehicles)) {
            const vehicle = {
                ...(raw ?? {}),
                name,
            };
            const uuid = this.api.hap.uuid.generate(VEHICLE_KEY(name));
            const cached = this.accessories.find((a) => a.UUID === uuid);
            const display = vehicle.title ?? name;
            let accessory;
            let isNew = false;
            if (cached) {
                accessory = cached;
                accessory.displayName = display;
            }
            else {
                const Ctor = this.api.platformAccessory;
                accessory = new Ctor(display, uuid);
                isNew = true;
            }
            accessory.context.kind = "vehicle";
            accessory.context.vehicleName = name;
            const existing = this.vehicles.get(name);
            if (existing) {
                existing.applyVehicleUpdate(vehicle);
                existing.applyLoadpoints(lps);
            }
            else {
                const v = new vehiclePresenceAccessory_js_1.VehiclePresenceAccessory({
                    api: this.api,
                    log: this.log,
                    accessory,
                    vehicle,
                });
                v.applyLoadpoints(lps);
                this.vehicles.set(name, v);
            }
            if (isNew) {
                this.log.info("Adopted vehicle presence sensor: %s.", display);
                this.api.registerPlatformAccessories(settings_js_1.PLUGIN_NAME, settings_js_1.PLATFORM_NAME, [accessory]);
                this.accessories.push(accessory);
            }
        }
    }
    /**
     * Drop accessories whose backing entity disappeared from EVCC (e.g. user
     * removed a loadpoint or vehicle from the EVCC config). The site accessory
     * is never pruned automatically.
     */
    pruneStale(state) {
        const lpCount = (0, decoders_js_1.asLoadpointArray)(state.loadpoints).length;
        const seenVehicleNames = new Set(Object.keys(state.vehicles ?? {}));
        const stale = [];
        for (const a of this.accessories) {
            const kind = a.context.kind;
            if (kind === "loadpoint") {
                const idx = a.context.loadpointId;
                if (typeof idx !== "number" || idx >= lpCount)
                    stale.push(a);
            }
            else if (kind === "vehicle") {
                const name = a.context.vehicleName;
                if (!name || !seenVehicleNames.has(name))
                    stale.push(a);
            }
            else if (kind === "site" && this.config.hideSite) {
                stale.push(a);
            }
        }
        if (stale.length === 0)
            return;
        this.log.info("Removing %d stale EVCC accessory/accessories.", stale.length);
        this.api.unregisterPlatformAccessories(settings_js_1.PLUGIN_NAME, settings_js_1.PLATFORM_NAME, stale);
        for (const a of stale) {
            const idx = this.accessories.indexOf(a);
            if (idx >= 0)
                this.accessories.splice(idx, 1);
            const kind = a.context.kind;
            if (kind === "loadpoint")
                this.loadpoints.delete(a.context.loadpointId);
            if (kind === "vehicle")
                this.vehicles.delete(a.context.vehicleName);
        }
    }
}
exports.EvccPlatform = EvccPlatform;
//# sourceMappingURL=platform.js.map