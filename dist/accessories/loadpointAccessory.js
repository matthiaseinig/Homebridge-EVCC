import { clampPercent, powerToLux } from "../util/powerToLux.js";
const SUBTYPE_OUTLET = "outlet";
const SUBTYPE_LIMIT_LP = "limit-loadpoint";
const SUBTYPE_LIMIT_VEHICLE = "limit-vehicle";
const SUBTYPE_BATTERY = "vehicle-battery";
const SUBTYPE_POWER = "charge-power";
const SUBTYPE_MODE_NOW = "mode-now";
const SUBTYPE_MODE_PV = "mode-pv";
const SUBTYPE_MODE_MINPV = "mode-minpv";
const MODE_SUBTYPES = {
    off: null,
    now: SUBTYPE_MODE_NOW,
    pv: SUBTYPE_MODE_PV,
    minpv: SUBTYPE_MODE_MINPV,
};
const SWITCH_MODES = ["now", "pv", "minpv"];
/**
 * Single loadpoint exposed as one HomeKit accessory with a stack of services:
 *
 *   - AccessoryInformation
 *   - Outlet            "<title>"                   On = enabled, OutletInUse = connected
 *   - WindowCovering    "<title> Charge Limit"      TargetPosition = limitSoc, CurrentPosition = vehicleSoc
 *   - WindowCovering    "<title> Vehicle Limit"     (optional, when exposeVehicleLimit)
 *   - BatteryService    "<title> Vehicle"           BatteryLevel = vehicleSoc, ChargingState = charging
 *   - LightSensor       "<title> Power"             CurrentAmbientLightLevel = chargePower (W → lux)
 *   - Switch ×3         "<title> Now"/"PV"/"Min+PV" optional, when modeUi = "switches"
 */
export class LoadpointAccessory {
    api;
    log;
    client;
    accessory;
    loadpointId;
    config;
    state;
    outletService;
    limitLoadpointService;
    batteryService;
    powerService;
    modeSwitches = new Map();
    constructor(deps) {
        this.api = deps.api;
        this.log = deps.log;
        this.client = deps.client;
        this.accessory = deps.accessory;
        this.loadpointId = deps.loadpointId;
        this.state = deps.state;
        this.config = deps.config;
        this.configureInformation();
        this.configureOutlet();
        this.configureLimitLoadpoint();
        if (this.config.exposeVehicleLimit)
            this.configureLimitVehicle();
        this.configureVehicleBattery();
        this.configurePower();
        if (this.config.modeUi === "switches")
            this.configureModeSwitches();
        this.applyState(this.state);
    }
    /** Re-render every service from a fresh loadpoint state. */
    applyState(state) {
        this.state = { ...this.state, ...state };
        const C = this.api.hap.Characteristic;
        if (this.outletService) {
            this.outletService.updateCharacteristic(C.On, !!this.state.enabled);
            this.outletService.updateCharacteristic(C.OutletInUse, !!this.state.connected);
        }
        if (this.limitLoadpointService) {
            const target = clampPercent(this.state.limitSoc);
            const current = clampPercent(this.state.vehicleSoc);
            this.limitLoadpointService.updateCharacteristic(C.TargetPosition, target);
            this.limitLoadpointService.updateCharacteristic(C.CurrentPosition, current);
            this.limitLoadpointService.updateCharacteristic(C.PositionState, 2 /* STOPPED */);
        }
        if (this.batteryService) {
            this.batteryService.updateCharacteristic(C.BatteryLevel, clampPercent(this.state.vehicleSoc));
            this.batteryService.updateCharacteristic(C.ChargingState, this.state.charging ? 1 : 0);
            this.batteryService.updateCharacteristic(C.StatusLowBattery, clampPercent(this.state.vehicleSoc) < 20 ? 1 : 0);
        }
        if (this.powerService) {
            this.powerService.updateCharacteristic(C.CurrentAmbientLightLevel, powerToLux(this.state.chargePower));
        }
        for (const [mode, svc] of this.modeSwitches) {
            svc.updateCharacteristic(C.On, this.state.mode === mode);
        }
    }
    /** Apply a single dotted-key WS update that targets this loadpoint. */
    applyPartial(key, value) {
        // key is the segment after "loadpoints.<n>." — e.g. "chargePower"
        this.state[key] = value;
        this.applyState(this.state);
    }
    dispose() {
        // No long-lived listeners to detach — the platform owns the client subscription.
    }
    // ---------------------------------------------------------------------------
    // Service builders
    // ---------------------------------------------------------------------------
    configureInformation() {
        const Service = this.api.hap.Service;
        const C = this.api.hap.Characteristic;
        const info = this.accessory.getService(Service.AccessoryInformation) ??
            this.accessory.addService(Service.AccessoryInformation);
        info
            .setCharacteristic(C.Manufacturer, "EVCC")
            .setCharacteristic(C.Model, "Loadpoint")
            .setCharacteristic(C.SerialNumber, `lp-${this.loadpointId}`)
            .setCharacteristic(C.Name, this.title());
    }
    configureOutlet() {
        if (this.config.modeUi === "readonly" && !this.config.writable) {
            // Still expose the outlet, but as read-only (drop the onSet handler).
        }
        const Service = this.api.hap.Service;
        const C = this.api.hap.Characteristic;
        const svc = this.ensureService(Service.Outlet, this.title(), SUBTYPE_OUTLET);
        this.outletService = svc;
        const onChar = svc.getCharacteristic(C.On);
        if (this.canWrite() && this.config.modeUi !== "switches") {
            onChar.onSet(async (value) => {
                const target = value ? this.config.defaultMode : "off";
                await this.safeSetMode(target);
            });
        }
    }
    configureLimitLoadpoint() {
        const Service = this.api.hap.Service;
        const C = this.api.hap.Characteristic;
        const svc = this.ensureService(Service.WindowCovering, `${this.title()} Charge Limit`, SUBTYPE_LIMIT_LP);
        this.limitLoadpointService = svc;
        if (this.canWrite()) {
            svc.getCharacteristic(C.TargetPosition).onSet(async (value) => {
                await this.safeSetLoadpointLimit(Number(value));
            });
        }
    }
    configureLimitVehicle() {
        const Service = this.api.hap.Service;
        const C = this.api.hap.Characteristic;
        const svc = this.ensureService(Service.WindowCovering, `${this.title()} Vehicle Limit`, SUBTYPE_LIMIT_VEHICLE);
        if (this.canWrite()) {
            svc.getCharacteristic(C.TargetPosition).onSet(async (value) => {
                if (!this.state.vehicleName)
                    return;
                await this.safeSetVehicleLimit(this.state.vehicleName, Number(value));
            });
        }
    }
    configureVehicleBattery() {
        this.batteryService = this.ensureService(this.api.hap.Service.Battery, `${this.title()} Vehicle`, SUBTYPE_BATTERY);
    }
    configurePower() {
        this.powerService = this.ensureService(this.api.hap.Service.LightSensor, `${this.title()} Power`, SUBTYPE_POWER);
    }
    configureModeSwitches() {
        const Service = this.api.hap.Service;
        const C = this.api.hap.Characteristic;
        for (const mode of SWITCH_MODES) {
            const subtype = MODE_SUBTYPES[mode];
            if (!subtype)
                continue;
            const svc = this.ensureService(Service.Switch, this.modeLabel(mode), subtype);
            this.modeSwitches.set(mode, svc);
            if (this.canWrite()) {
                svc.getCharacteristic(C.On).onSet(async (value) => {
                    if (value) {
                        await this.safeSetMode(mode);
                    }
                    else if (this.state.mode === mode) {
                        // Toggling off the active mode → off
                        await this.safeSetMode("off");
                    }
                });
            }
        }
    }
    // ---------------------------------------------------------------------------
    // Helpers
    // ---------------------------------------------------------------------------
    title() {
        return this.state.title ?? `Loadpoint ${this.loadpointId + 1}`;
    }
    modeLabel(mode) {
        switch (mode) {
            case "now":
                return `${this.title()} Now`;
            case "pv":
                return `${this.title()} PV`;
            case "minpv":
                return `${this.title()} Min+PV`;
            default:
                return `${this.title()} ${mode}`;
        }
    }
    canWrite() {
        return this.config.writable && this.config.modeUi !== "readonly";
    }
    ensureService(ctor, name, subtype) {
        const services = this.accessory.services;
        const existing = services.find((s) => s.UUID === ctor.UUID && s.subtype === subtype);
        const svc = existing ?? this.accessory.addService(ctor, name, subtype);
        const C = this.api.hap.Characteristic;
        svc.setCharacteristic(C.Name, name);
        if (C.ConfiguredName) {
            try {
                svc.setCharacteristic(C.ConfiguredName, name);
            }
            catch {
                // Characteristic.ConfiguredName isn't on every HAP version — fine to skip.
            }
        }
        return svc;
    }
    async safeSetMode(mode) {
        try {
            // EVCC REST API uses 1-based loadpoint IDs.
            await this.client.setLoadpointMode(this.loadpointId + 1, mode);
        }
        catch (err) {
            this.log.warn("Failed to set loadpoint %d mode=%s: %s", this.loadpointId + 1, mode, err.message);
        }
    }
    async safeSetLoadpointLimit(soc) {
        try {
            await this.client.setLoadpointLimitSoc(this.loadpointId + 1, soc);
        }
        catch (err) {
            this.log.warn("Failed to set loadpoint %d limitSoc=%d: %s", this.loadpointId + 1, soc, err.message);
        }
    }
    async safeSetVehicleLimit(name, soc) {
        try {
            await this.client.setVehicleLimitSoc(name, soc);
        }
        catch (err) {
            this.log.warn("Failed to set vehicle %s limitSoc=%d: %s", name, soc, err.message);
        }
    }
}
//# sourceMappingURL=loadpointAccessory.js.map