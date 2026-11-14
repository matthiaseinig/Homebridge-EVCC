"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ChargingStatisticsServices = void 0;
const extract_js_1 = require("./extract.js");
const serviceSet_js_1 = require("./serviceSet.js");
/**
 * Read-only "Charging Statistics" services on the site accessory, one per
 * EVCC `statistics.<period>`, keyed by the period name.
 */
class ChargingStatisticsServices {
    set;
    constructor(api, accessory) {
        this.set = new serviceSet_js_1.ServiceSet(api, accessory, "ChargingStatistics");
    }
    apply(state, snapshot = false) {
        this.set.sync((0, extract_js_1.statisticsEntries)(state).map((e) => ({
            subtype: `stat:${e.period}`,
            label: `Charging Statistics ${e.period}`,
            values: e.values,
        })), snapshot);
    }
    removeAll() {
        this.set.removeAll();
    }
}
exports.ChargingStatisticsServices = ChargingStatisticsServices;
//# sourceMappingURL=chargingStatistics.js.map