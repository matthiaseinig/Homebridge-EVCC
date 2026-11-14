"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ServiceSet = exports.MISSING_SNAPSHOTS_BEFORE_REMOVAL = void 0;
const hapTypes_js_1 = require("./hapTypes.js");
/**
 * A service instance whose entry is missing from this many consecutive REST
 * snapshots is removed. Websocket-driven renders never count, so one
 * incomplete payload does not make services (and app bindings) flap.
 */
exports.MISSING_SNAPSHOTS_BEFORE_REMOVAL = 3;
/** Keeps one service per entry for a repeated custom service type on one accessory. */
class ServiceSet {
    api;
    accessory;
    key;
    misses = new Map();
    constructor(api, accessory, key) {
        this.api = api;
        this.accessory = accessory;
        this.key = key;
    }
    /** Render `entries`; `snapshot` is true for a full REST snapshot. */
    sync(entries, snapshot) {
        const hap = this.api.hap;
        const present = new Set();
        for (const entry of entries) {
            present.add(entry.subtype);
            this.misses.delete(entry.subtype);
            const svc = (0, hapTypes_js_1.ensureEnergyService)(hap, this.accessory, this.key, entry.label, entry.subtype);
            (0, hapTypes_js_1.applyValues)(hap, svc, entry.values);
        }
        const keep = new Set(present);
        const ctor = (0, hapTypes_js_1.energyHapTypes)(hap).service(this.key);
        for (const svc of (0, hapTypes_js_1.servicesOfType)(this.accessory, ctor)) {
            const subtype = svc.subtype ?? "";
            if (present.has(subtype))
                continue;
            const misses = (this.misses.get(subtype) ?? 0) + (snapshot ? 1 : 0);
            if (misses < exports.MISSING_SNAPSHOTS_BEFORE_REMOVAL) {
                this.misses.set(subtype, misses);
                keep.add(subtype);
            }
            else {
                this.misses.delete(subtype);
            }
        }
        (0, hapTypes_js_1.pruneServices)(hap, this.accessory, this.key, keep);
    }
    removeAll() {
        this.misses.clear();
        (0, hapTypes_js_1.pruneServices)(this.api.hap, this.accessory, this.key, new Set());
    }
}
exports.ServiceSet = ServiceSet;
//# sourceMappingURL=serviceSet.js.map