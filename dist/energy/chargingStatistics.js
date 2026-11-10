"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ChargingStatisticsServices = exports.MISSING_SNAPSHOTS_BEFORE_REMOVAL = void 0;
const extract_js_1 = require("./extract.js");
const hapTypes_js_1 = require("./hapTypes.js");
const STAT_PREFIX = "stat:";
exports.MISSING_SNAPSHOTS_BEFORE_REMOVAL = 3;
/**
 * Read-only "Charging Statistics" services on the site accessory, one per
 * EVCC `statistics.<period>`, keyed by the period name (stable subtype).
 * Services for periods that stay absent are removed. Site energy (PV, battery, grid, home, aux) is not exposed by this
 * plugin; services with retired site-energy UUIDs are removed from the
 * cached accessory.
 */
class ChargingStatisticsServices {
    api;
    accessory;
    /** Consecutive snapshots in which a period's service had no data, by subtype. */
    misses = new Map();
    constructor(api, accessory) {
        this.api = api;
        this.accessory = accessory;
        (0, hapTypes_js_1.pruneRetiredServices)(accessory);
    }
    /**
     * Render the statistics. `snapshot` is true for full REST snapshots; a
     * period missing from a snapshot is only removed after it was missing from
     * MISSING_SNAPSHOTS_BEFORE_REMOVAL consecutive snapshots, so one incomplete
     * payload does not make services (and app bindings) flap.
     */
    apply(state, snapshot = false) {
        const hap = this.api.hap;
        const present = new Set();
        for (const entry of (0, extract_js_1.statisticsEntries)(state)) {
            const subtype = STAT_PREFIX + entry.period;
            present.add(subtype);
            this.misses.delete(subtype);
            const svc = (0, hapTypes_js_1.ensureEnergyService)(hap, this.accessory, "ChargingStatistics", `Charging Statistics ${entry.period}`, subtype);
            (0, hapTypes_js_1.applyValues)(hap, svc, entry.values);
        }
        const ctor = (0, hapTypes_js_1.energyHapTypes)(hap).service("ChargingStatistics");
        const keep = new Set(present);
        for (const svc of (0, hapTypes_js_1.servicesOfType)(this.accessory, ctor)) {
            const subtype = svc.subtype ?? "";
            if (present.has(subtype))
                continue;
            const misses = (this.misses.get(subtype) ?? 0) + (snapshot ? 1 : 0);
            this.misses.set(subtype, misses);
            if (misses < exports.MISSING_SNAPSHOTS_BEFORE_REMOVAL)
                keep.add(subtype);
            else
                this.misses.delete(subtype);
        }
        (0, hapTypes_js_1.pruneServices)(hap, this.accessory, "ChargingStatistics", keep);
    }
    /** Remove every custom service from the site accessory. */
    removeAll() {
        (0, hapTypes_js_1.pruneServices)(this.api.hap, this.accessory, "ChargingStatistics", new Set());
    }
}
exports.ChargingStatisticsServices = ChargingStatisticsServices;
//# sourceMappingURL=chargingStatistics.js.map