"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SiteEnergyServices = exports.SUBTYPE_ENERGY_SITE = void 0;
const extract_js_1 = require("./extract.js");
const hapTypes_js_1 = require("./hapTypes.js");
exports.SUBTYPE_ENERGY_SITE = "energy-site";
const STAT_PREFIX = "stat:";
/**
 * Custom energy services on the site accessory:
 *
 *   - Energy Site           (one)              totals, grid, phases, battery, home, aux, tariffs
 *   - PV Array              (one per pv[])     per-array power and energy
 *   - Aux Meter             (one per aux[])    per-consumer power
 *   - Charging Statistics   (one per period)   statistics.<period>
 *
 * Read-only. Per-meter services follow the EVCC configuration: services for
 * meters that disappear from the state are removed.
 */
class SiteEnergyServices {
    api;
    accessory;
    now;
    constructor(api, accessory, now = Date.now) {
        this.api = api;
        this.accessory = accessory;
        this.now = now;
    }
    apply(state) {
        const hap = this.api.hap;
        const site = (0, hapTypes_js_1.ensureEnergyService)(hap, this.accessory, "EnergySite", "Energy Site", exports.SUBTYPE_ENERGY_SITE);
        (0, hapTypes_js_1.applyValues)(hap, site, (0, extract_js_1.siteValues)(state, Math.floor(this.now() / 1000)));
        this.syncMeters("PvArray", (0, extract_js_1.pvArrayEntries)(state));
        this.syncMeters("AuxMeter", (0, extract_js_1.auxMeterEntries)(state));
        const stats = (0, extract_js_1.statisticsEntries)(state);
        const keep = new Set();
        for (const entry of stats) {
            const subtype = STAT_PREFIX + entry.period;
            keep.add(subtype);
            const svc = (0, hapTypes_js_1.ensureEnergyService)(hap, this.accessory, "ChargingStatistics", `Charging Statistics ${entry.period}`, subtype);
            (0, hapTypes_js_1.applyValues)(hap, svc, entry.values);
        }
        (0, hapTypes_js_1.pruneServices)(hap, this.accessory, "ChargingStatistics", keep);
    }
    /** Remove every custom energy service from the site accessory. */
    removeAll() {
        const none = new Set();
        for (const key of ["EnergySite", "PvArray", "AuxMeter", "ChargingStatistics"]) {
            (0, hapTypes_js_1.pruneServices)(this.api.hap, this.accessory, key, none);
        }
    }
    syncMeters(key, entries) {
        const hap = this.api.hap;
        const keep = new Set();
        for (const entry of entries) {
            keep.add(entry.key);
            const svc = (0, hapTypes_js_1.ensureEnergyService)(hap, this.accessory, key, entry.label, entry.key);
            (0, hapTypes_js_1.applyValues)(hap, svc, entry.values);
        }
        (0, hapTypes_js_1.pruneServices)(hap, this.accessory, key, keep);
    }
}
exports.SiteEnergyServices = SiteEnergyServices;
//# sourceMappingURL=siteEnergy.js.map