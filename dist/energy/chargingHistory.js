"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ChargingHistoryService = exports.SUBTYPE_CHARGING_HISTORY = void 0;
const hapTypes_js_1 = require("./hapTypes.js");
exports.SUBTYPE_CHARGING_HISTORY = "charging-history";
/**
 * Read-only "Charging History" service on a loadpoint accessory: summaries of
 * the plugin's copy of EVCC's session log for that loadpoint.
 */
class ChargingHistoryService {
    api;
    accessory;
    constructor(api, accessory) {
        this.api = api;
        this.accessory = accessory;
    }
    apply(title, summary, updatedSeconds) {
        const svc = (0, hapTypes_js_1.ensureEnergyService)(this.api.hap, this.accessory, "ChargingHistory", `${title} Charging History`, exports.SUBTYPE_CHARGING_HISTORY);
        (0, hapTypes_js_1.applyValues)(this.api.hap, svc, {
            ChargedToday: summary.todayKWh,
            ChargedMonth: summary.monthKWh,
            SolarShareMonth: summary.monthSolarPercentage,
            LastSessionEnergy: summary.lastSessionKWh,
            LastSessionEnd: summary.lastSessionEnd,
            SessionsUpdated: updatedSeconds,
        });
    }
    remove() {
        (0, hapTypes_js_1.pruneServices)(this.api.hap, this.accessory, "ChargingHistory", new Set());
    }
}
exports.ChargingHistoryService = ChargingHistoryService;
//# sourceMappingURL=chargingHistory.js.map