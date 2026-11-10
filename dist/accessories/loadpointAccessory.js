"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LoadpointAccessory = void 0;
const definitions_js_1 = require("../energy/definitions.js");
const writeValidation_js_1 = require("../energy/writeValidation.js");
const hapTypes_js_1 = require("../energy/hapTypes.js");
const chargingHistory_js_1 = require("../energy/chargingHistory.js");
const loadpointEnergy_js_1 = require("../energy/loadpointEnergy.js");
const applyServiceName_js_1 = require("../util/applyServiceName.js");
const powerToLux_js_1 = require("../util/powerToLux.js");
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
const MODE_ROLES = {
    now: definitions_js_1.CONTROL_ROLES.modeNow,
    pv: definitions_js_1.CONTROL_ROLES.modePv,
    minpv: definitions_js_1.CONTROL_ROLES.modeMinPv,
};
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
 *   - Custom service    "<title> Energy"            read-only Loadpoint Energy characteristics
 *
 * Unless energy characteristics are disabled, every control service above
 * also carries the read-only custom Control Role and Control Enabled
 * characteristics so apps can find and steer the controls without relying on
 * service names (docs/app-contract.md).
 */
class LoadpointAccessory {
    api;
    log;
    client;
    accessory;
    loadpointId;
    config;
    state;
    outletService;
    limitLoadpointService;
    limitVehicleService;
    batteryService;
    powerService;
    modeSwitches = new Map();
    energy;
    history;
    chargingService;
    now;
    energyEnabled;
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
        this.energyEnabled = this.config.energy ?? true;
        this.now = deps.now ?? Date.now;
        this.energy = new loadpointEnergy_js_1.LoadpointEnergyService(this.api, this.accessory, this.now);
        if (this.energyEnabled) {
            this.chargingService = this.energy.ensure(this.title());
            this.configureChargingWrites(this.chargingService);
        }
        else {
            this.energy.remove();
        }
        this.history = new chargingHistory_js_1.ChargingHistoryService(this.api, this.accessory);
        if (!this.energyEnabled || !this.config.sessions)
            this.history.remove();
        this.syncControlRoles();
        this.applyState(this.state);
    }
    /** Loadpoint title as EVCC reports it; the session log refers to loadpoints by it. */
    loadpointTitle() {
        return this.title();
    }
    /** Render the Charging History service; ignored unless history is enabled. */
    applySessions(summary, updatedSeconds) {
        if (!this.energyEnabled || !this.config.sessions)
            return;
        this.history.apply(this.title(), summary, updatedSeconds);
    }
    /** Re-render every service from a fresh loadpoint state. */
    applyState(state) {
        this.state = { ...this.state, ...state };
        const C = this.api.hap.Characteristic;
        // Title can arrive late (after WS reconnect) — keep AccessoryInformation in sync.
        this.refreshInformationName();
        if (this.outletService) {
            this.outletService.updateCharacteristic(C.On, !!this.state.enabled);
            this.outletService.updateCharacteristic(C.OutletInUse, !!this.state.connected);
        }
        if (this.limitLoadpointService) {
            const target = (0, powerToLux_js_1.clampPercent)(this.state.limitSoc);
            const current = (0, powerToLux_js_1.clampPercent)(this.state.vehicleSoc);
            this.limitLoadpointService.updateCharacteristic(C.TargetPosition, target);
            this.limitLoadpointService.updateCharacteristic(C.CurrentPosition, current);
            this.limitLoadpointService.updateCharacteristic(C.PositionState, 2 /* STOPPED */);
        }
        if (this.batteryService) {
            this.batteryService.updateCharacteristic(C.BatteryLevel, (0, powerToLux_js_1.clampPercent)(this.state.vehicleSoc));
            this.batteryService.updateCharacteristic(C.ChargingState, this.state.charging ? 1 : 0);
            this.batteryService.updateCharacteristic(C.StatusLowBattery, (0, powerToLux_js_1.clampPercent)(this.state.vehicleSoc) < 20 ? 1 : 0);
        }
        if (this.powerService) {
            this.powerService.updateCharacteristic(C.CurrentAmbientLightLevel, (0, powerToLux_js_1.powerToLux)(this.state.chargePower));
        }
        for (const [mode, svc] of this.modeSwitches) {
            svc.updateCharacteristic(C.On, this.state.mode === mode);
        }
        if (this.energyEnabled)
            this.energy.apply(this.state, this.title());
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
    refreshInformationName() {
        const info = this.accessory.getService(this.api.hap.Service.AccessoryInformation);
        if (info)
            info.updateCharacteristic(this.api.hap.Characteristic.Name, this.title());
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
        this.limitVehicleService = svc;
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
    /** Tag each control service with its role and whether writes reach EVCC. */
    syncControlRoles() {
        const controls = [
            [this.chargingService, definitions_js_1.CONTROL_ROLES.charging, this.canWrite()],
            [
                this.outletService,
                definitions_js_1.CONTROL_ROLES.outlet,
                this.canWrite() && this.config.modeUi !== "switches",
            ],
            [this.limitLoadpointService, definitions_js_1.CONTROL_ROLES.limitLoadpoint, this.canWrite()],
            [this.limitVehicleService, definitions_js_1.CONTROL_ROLES.limitVehicle, this.canWrite()],
            ...[...this.modeSwitches].map(([mode, svc]) => [
                svc,
                MODE_ROLES[mode],
                this.canWrite(),
            ]),
        ];
        const hap = this.api.hap;
        for (const [svc, role, enabled] of controls) {
            if (!svc)
                continue;
            if (this.energyEnabled) {
                (0, hapTypes_js_1.ensureCustomCharacteristic)(hap, svc, "ControlRole").updateValue(role);
                (0, hapTypes_js_1.ensureCustomCharacteristic)(hap, svc, "ControlEnabled").updateValue(enabled);
            }
            else {
                (0, hapTypes_js_1.removeCustomCharacteristic)(svc, "ControlRole");
                (0, hapTypes_js_1.removeCustomCharacteristic)(svc, "ControlEnabled");
            }
        }
    }
    canWrite() {
        return this.config.writable && this.config.modeUi !== "readonly";
    }
    ensureService(ctor, name, subtype) {
        const services = this.accessory.services;
        const existing = services.find((s) => s.UUID === ctor.UUID && s.subtype === subtype);
        const svc = existing ?? this.accessory.addService(ctor, name, subtype);
        (0, applyServiceName_js_1.applyServiceName)(svc, name, this.api.hap.Characteristic);
        return svc;
    }
    /** Charge Mode and Set Plan on the Loadpoint Energy service accept writes (validated strictly). */
    configureChargingWrites(svc) {
        const types = (0, hapTypes_js_1.energyHapTypes)(this.api.hap);
        svc.getCharacteristic(types.char("ChargeMode")).onSet(async (value) => {
            this.requireWritable();
            const mode = (0, writeValidation_js_1.parseChargeMode)(value);
            if (!mode)
                throw this.hapError("INVALID_VALUE_IN_REQUEST");
            await this.safeSetMode(mode);
        });
        svc.getCharacteristic(types.char("SetPlan")).onSet(async (value) => {
            this.requireWritable();
            const request = (0, writeValidation_js_1.parsePlanRequest)(value, Math.floor(this.now() / 1000));
            if (!request)
                throw this.hapError("INVALID_VALUE_IN_REQUEST");
            // EVCC keeps SoC plans per vehicle; the plan goes to the vehicle at this loadpoint.
            const vehicle = this.state.vehicleName;
            if (!vehicle)
                throw this.hapError("NOT_ALLOWED_IN_CURRENT_STATE");
            try {
                if (request.kind === "clear")
                    await this.client.deleteVehiclePlanSoc(vehicle);
                else
                    await this.client.setVehiclePlanSoc(vehicle, request.soc, (0, writeValidation_js_1.toRfc3339)(request.time));
            }
            catch (err) {
                this.log.warn("Failed to set plan for vehicle %s: %s", vehicle, err.message);
                throw this.hapError("SERVICE_COMMUNICATION_FAILURE");
            }
        });
    }
    requireWritable() {
        if (!this.canWrite())
            throw this.hapError("INSUFFICIENT_PRIVILEGES");
    }
    hapError(status) {
        const hap = this.api.hap;
        const code = {
            SERVICE_COMMUNICATION_FAILURE: -70402 /* hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE */,
            INVALID_VALUE_IN_REQUEST: -70410 /* hap.HAPStatus.INVALID_VALUE_IN_REQUEST */,
            NOT_ALLOWED_IN_CURRENT_STATE: -70412 /* hap.HAPStatus.NOT_ALLOWED_IN_CURRENT_STATE */,
            INSUFFICIENT_PRIVILEGES: -70401 /* hap.HAPStatus.INSUFFICIENT_PRIVILEGES */,
        }[status];
        return new this.api.hap.HapStatusError(code);
    }
    /** Forward a mode change; an EVCC failure becomes a HAP communication error. */
    async safeSetMode(mode) {
        try {
            // EVCC REST API uses 1-based loadpoint IDs.
            await this.client.setLoadpointMode(this.loadpointId + 1, mode);
        }
        catch (err) {
            this.log.warn("Failed to set loadpoint %d mode=%s: %s", this.loadpointId + 1, mode, err.message);
            throw this.hapError("SERVICE_COMMUNICATION_FAILURE");
        }
    }
    async safeSetLoadpointLimit(soc) {
        try {
            await this.client.setLoadpointLimitSoc(this.loadpointId + 1, soc);
        }
        catch (err) {
            this.log.warn("Failed to set loadpoint %d limitSoc=%d: %s", this.loadpointId + 1, soc, err.message);
            throw this.hapError("SERVICE_COMMUNICATION_FAILURE");
        }
    }
    async safeSetVehicleLimit(name, soc) {
        try {
            await this.client.setVehicleLimitSoc(name, soc);
        }
        catch (err) {
            this.log.warn("Failed to set vehicle %s limitSoc=%d: %s", name, soc, err.message);
            throw this.hapError("SERVICE_COMMUNICATION_FAILURE");
        }
    }
}
exports.LoadpointAccessory = LoadpointAccessory;
//# sourceMappingURL=loadpointAccessory.js.map