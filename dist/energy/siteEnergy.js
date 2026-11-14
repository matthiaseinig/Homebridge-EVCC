"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SiteEnergyServices = exports.SUBTYPE_ENERGY_SITE = void 0;
const extract_js_1 = require("./extract.js");
const hapTypes_js_1 = require("./hapTypes.js");
const serviceSet_js_1 = require("./serviceSet.js");
exports.SUBTYPE_ENERGY_SITE = "energy-site";
/**
 * Read-only site energy services on the site accessory:
 *
 *   - Energy Site   (one)              totals, grid, phases, battery, home, aux, tariffs
 *   - PV Array      (one per pv[])     per-array power and energy, keyed by meter name
 *   - Aux Meter     (one per aux[])    per-consumer power, keyed by meter name
 */
class SiteEnergyServices {
    api;
    accessory;
    now;
    pv;
    aux;
    site;
    constructor(api, accessory, now = Date.now) {
        this.api = api;
        this.accessory = accessory;
        this.now = now;
        this.pv = new serviceSet_js_1.ServiceSet(api, accessory, "PvArray");
        this.aux = new serviceSet_js_1.ServiceSet(api, accessory, "AuxMeter");
    }
    /** Render `state`; `snapshot` is true for a full REST snapshot. */
    apply(state, snapshot = false) {
        const hap = this.api.hap;
        this.site = (0, hapTypes_js_1.ensureEnergyService)(hap, this.accessory, "EnergySite", "Energy Site", exports.SUBTYPE_ENERGY_SITE);
        (0, hapTypes_js_1.applyValues)(hap, this.site, (0, extract_js_1.siteValues)(state, this.nowSeconds()));
        this.pv.sync((0, extract_js_1.pvArrayEntries)(state), snapshot);
        this.aux.sync((0, extract_js_1.auxMeterEntries)(state), snapshot);
    }
    /** Move Last Update for EVCC data that does not change site values (loadpoint frames). */
    touch() {
        if (!this.site)
            return;
        this.site.updateCharacteristic((0, hapTypes_js_1.energyHapTypes)(this.api.hap).char("LastUpdate"), this.nowSeconds());
    }
    removeAll() {
        (0, hapTypes_js_1.pruneServices)(this.api.hap, this.accessory, "EnergySite", new Set());
        this.pv.removeAll();
        this.aux.removeAll();
        this.site = undefined;
    }
    nowSeconds() {
        return Math.floor(this.now() / 1000);
    }
}
exports.SiteEnergyServices = SiteEnergyServices;
//# sourceMappingURL=siteEnergy.js.map