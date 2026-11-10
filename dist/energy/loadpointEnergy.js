"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LoadpointEnergyService = exports.SUBTYPE_LOADPOINT_ENERGY = void 0;
const extract_js_1 = require("./extract.js");
const hapTypes_js_1 = require("./hapTypes.js");
exports.SUBTYPE_LOADPOINT_ENERGY = "loadpoint-energy";
/** Read-only custom "Loadpoint Energy" service on a loadpoint accessory. */
class LoadpointEnergyService {
    api;
    accessory;
    now;
    constructor(api, accessory, now = Date.now) {
        this.api = api;
        this.accessory = accessory;
        this.now = now;
    }
    apply(state, title) {
        const svc = (0, hapTypes_js_1.ensureEnergyService)(this.api.hap, this.accessory, "LoadpointEnergy", `${title} Energy`, exports.SUBTYPE_LOADPOINT_ENERGY);
        (0, hapTypes_js_1.applyValues)(this.api.hap, svc, (0, extract_js_1.loadpointValues)(state, Math.floor(this.now() / 1000)));
    }
    remove() {
        (0, hapTypes_js_1.pruneServices)(this.api.hap, this.accessory, "LoadpointEnergy", new Set());
    }
}
exports.LoadpointEnergyService = LoadpointEnergyService;
//# sourceMappingURL=loadpointEnergy.js.map