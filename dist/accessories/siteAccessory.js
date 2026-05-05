"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SiteAccessory = void 0;
const applyServiceName_js_1 = require("../util/applyServiceName.js");
const powerToLux_js_1 = require("../util/powerToLux.js");
const SUBTYPE_BATTERY = "home-battery";
const SUBTYPE_PV = "pv-power";
const SUBTYPE_GRID = "grid-power";
const SUBTYPE_GRID_DIR = "grid-direction";
const SUBTYPE_HOME = "home-power";
const SUBTYPE_MODE_NORMAL = "battery-mode-normal";
const SUBTYPE_MODE_HOLD = "battery-mode-hold";
const SUBTYPE_MODE_CHARGE = "battery-mode-charge";
const BATTERY_MODE_SUBTYPES = {
    normal: SUBTYPE_MODE_NORMAL,
    hold: SUBTYPE_MODE_HOLD,
    charge: SUBTYPE_MODE_CHARGE,
};
/**
 * Site-wide telemetry accessory. One per EVCC instance:
 *
 *   - AccessoryInformation
 *   - BatteryService    "Home Battery"        BatteryLevel = battery.soc, ChargingState driven by sign of battery.power
 *   - LightSensor       "PV Production"       lux = pvPower (W)
 *   - LightSensor       "Grid Power"          lux = |grid.power|
 *   - ContactSensor     "Grid Direction"      open = importing, closed = exporting (grid.power < 0)
 *   - LightSensor       "Home Consumption"    lux = homePower
 *   - Switch ×3         "Battery Normal/Hold/Charge"  (only if writable)
 */
class SiteAccessory {
    api;
    log;
    client;
    accessory;
    writable;
    state;
    batteryService;
    pvService;
    gridService;
    gridDirectionService;
    homeService;
    modeSwitches = new Map();
    constructor(deps) {
        this.api = deps.api;
        this.log = deps.log;
        this.client = deps.client;
        this.accessory = deps.accessory;
        this.writable = deps.writable;
        this.state = deps.state;
        this.configureInformation();
        this.configureBattery();
        this.configurePv();
        this.configureGrid();
        this.configureHome();
        if (this.writable)
            this.configureBatteryModeSwitches();
        this.applyState(this.state);
    }
    applyState(state) {
        this.state = state;
        const C = this.api.hap.Characteristic;
        const battery = state.battery ?? {};
        // siteTitle can change post-startup (rare, but happens on EVCC config reload).
        const info = this.accessory.getService(this.api.hap.Service.AccessoryInformation);
        if (info)
            info.updateCharacteristic(C.Name, state.siteTitle ?? "EVCC");
        if (this.batteryService) {
            this.batteryService.updateCharacteristic(C.BatteryLevel, (0, powerToLux_js_1.clampPercent)(battery.soc));
            // ChargingState: 0 = NOT_CHARGING, 1 = CHARGING (positive battery.power = discharging,
            // so we charge when power < 0). 2 = NOT_CHARGEABLE; we don't use it.
            const power = typeof battery.power === "number" ? battery.power : 0;
            this.batteryService.updateCharacteristic(C.ChargingState, power < 0 ? 1 : 0);
            this.batteryService.updateCharacteristic(C.StatusLowBattery, (0, powerToLux_js_1.clampPercent)(battery.soc) < 20 ? 1 : 0);
        }
        if (this.pvService) {
            this.pvService.updateCharacteristic(C.CurrentAmbientLightLevel, (0, powerToLux_js_1.powerToLux)(state.pvPower));
        }
        if (this.gridService) {
            const gridPower = state.grid && typeof state.grid.power === "number"
                ? state.grid.power
                : 0;
            this.gridService.updateCharacteristic(C.CurrentAmbientLightLevel, (0, powerToLux_js_1.powerToLux)(gridPower));
            if (this.gridDirectionService) {
                // ContactSensor: 0 = CONTACT_DETECTED ("closed", we use for export),
                //                1 = CONTACT_NOT_DETECTED ("open", we use for import).
                this.gridDirectionService.updateCharacteristic(C.ContactSensorState, gridPower < 0 ? 0 : 1);
            }
        }
        if (this.homeService) {
            this.homeService.updateCharacteristic(C.CurrentAmbientLightLevel, (0, powerToLux_js_1.powerToLux)(state.homePower));
        }
        const mode = state.batteryMode;
        for (const [m, svc] of this.modeSwitches) {
            svc.updateCharacteristic(C.On, mode === m);
        }
    }
    dispose() {
        // Nothing to detach.
    }
    // ---------------------------------------------------------------------------
    configureInformation() {
        const Service = this.api.hap.Service;
        const C = this.api.hap.Characteristic;
        const info = this.accessory.getService(Service.AccessoryInformation) ??
            this.accessory.addService(Service.AccessoryInformation);
        info
            .setCharacteristic(C.Manufacturer, "EVCC")
            .setCharacteristic(C.Model, "Site")
            .setCharacteristic(C.SerialNumber, "evcc-site")
            .setCharacteristic(C.Name, this.state.siteTitle ?? "EVCC");
    }
    configureBattery() {
        this.batteryService = this.ensureService(this.api.hap.Service.Battery, "Home Battery", SUBTYPE_BATTERY);
    }
    configurePv() {
        this.pvService = this.ensureService(this.api.hap.Service.LightSensor, "PV Production", SUBTYPE_PV);
    }
    configureGrid() {
        this.gridService = this.ensureService(this.api.hap.Service.LightSensor, "Grid Power", SUBTYPE_GRID);
        this.gridDirectionService = this.ensureService(this.api.hap.Service.ContactSensor, "Grid Direction", SUBTYPE_GRID_DIR);
    }
    configureHome() {
        this.homeService = this.ensureService(this.api.hap.Service.LightSensor, "Home Consumption", SUBTYPE_HOME);
    }
    configureBatteryModeSwitches() {
        const Service = this.api.hap.Service;
        const C = this.api.hap.Characteristic;
        for (const mode of Object.keys(BATTERY_MODE_SUBTYPES)) {
            const svc = this.ensureService(Service.Switch, `Battery ${mode}`, BATTERY_MODE_SUBTYPES[mode]);
            this.modeSwitches.set(mode, svc);
            svc.getCharacteristic(C.On).onSet(async (value) => {
                if (!value)
                    return;
                try {
                    await this.client.setBatteryMode(mode);
                }
                catch (err) {
                    this.log.warn("Failed to set battery mode %s: %s", mode, err.message);
                }
            });
        }
    }
    ensureService(ctor, name, subtype) {
        const services = this.accessory.services;
        const existing = services.find((s) => s.UUID === ctor.UUID && s.subtype === subtype);
        const svc = existing ?? this.accessory.addService(ctor, name, subtype);
        (0, applyServiceName_js_1.applyServiceName)(svc, name, this.api.hap.Characteristic);
        return svc;
    }
}
exports.SiteAccessory = SiteAccessory;
//# sourceMappingURL=siteAccessory.js.map