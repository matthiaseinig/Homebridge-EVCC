const SUBTYPE_OCCUPANCY = "vehicle-presence";
/**
 * Per-vehicle presence accessory. Fires when the vehicle is currently assigned
 * to *any* loadpoint and that loadpoint reports a `connected` state.
 *
 * Useful for HomeKit automations like "garage light when my car arrives" or
 * "notify when the spouse's car is plugged in".
 */
export class VehiclePresenceAccessory {
    api;
    accessory;
    vehicle;
    occupancyService;
    constructor(deps) {
        this.api = deps.api;
        this.accessory = deps.accessory;
        this.vehicle = deps.vehicle;
        this.configureInformation();
        this.occupancyService = this.ensureService(this.api.hap.Service.OccupancySensor, this.displayName(), SUBTYPE_OCCUPANCY);
    }
    /** Recompute presence from the current loadpoints array. */
    applyLoadpoints(loadpoints) {
        const C = this.api.hap.Characteristic;
        const home = loadpoints.some((lp) => lp.connected && lp.vehicleName === this.vehicle.name);
        this.occupancyService.updateCharacteristic(C.OccupancyDetected, home ? 1 : 0);
    }
    applyVehicleUpdate(vehicle) {
        this.vehicle = { ...this.vehicle, ...vehicle };
        const C = this.api.hap.Characteristic;
        this.occupancyService.setCharacteristic(C.Name, this.displayName());
    }
    get name() {
        return this.vehicle.name;
    }
    dispose() {
        // No external listeners attached — managed by the platform.
    }
    // ---------------------------------------------------------------------------
    displayName() {
        return this.vehicle.title ?? this.vehicle.name ?? "Vehicle";
    }
    configureInformation() {
        const Service = this.api.hap.Service;
        const C = this.api.hap.Characteristic;
        const info = this.accessory.getService(Service.AccessoryInformation) ??
            this.accessory.addService(Service.AccessoryInformation);
        info
            .setCharacteristic(C.Manufacturer, "EVCC")
            .setCharacteristic(C.Model, "Vehicle")
            .setCharacteristic(C.SerialNumber, this.vehicle.name ?? "vehicle")
            .setCharacteristic(C.Name, this.displayName());
    }
    ensureService(ctor, name, subtype) {
        const services = this.accessory.services;
        const existing = services.find((s) => s.UUID === ctor.UUID && s.subtype === subtype);
        const svc = existing ?? this.accessory.addService(ctor, name, subtype);
        const C = this.api.hap.Characteristic;
        svc.setCharacteristic(C.Name, name);
        return svc;
    }
}
//# sourceMappingURL=vehiclePresenceAccessory.js.map