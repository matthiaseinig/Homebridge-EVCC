import type { API, Logging, PlatformAccessory, Service, WithUUID } from "homebridge";
import type { LoadpointState, VehicleState } from "../api/types.js";
import { applyServiceName } from "../util/applyServiceName.js";

export interface VehiclePresenceDeps {
  api: API;
  log: Logging;
  accessory: PlatformAccessory;
  vehicle: VehicleState;
}

const SUBTYPE_OCCUPANCY = "vehicle-presence";

/**
 * Per-vehicle presence accessory. Fires when the vehicle is currently assigned
 * to *any* loadpoint and that loadpoint reports a `connected` state.
 *
 * Useful for HomeKit automations like "garage light when my car arrives" or
 * "notify when the spouse's car is plugged in".
 */
export class VehiclePresenceAccessory {
  private readonly api: API;
  private readonly accessory: PlatformAccessory;
  private vehicle: VehicleState;
  private occupancyService!: Service;

  constructor(deps: VehiclePresenceDeps) {
    this.api = deps.api;
    this.accessory = deps.accessory;
    this.vehicle = deps.vehicle;

    this.configureInformation();
    this.occupancyService = this.ensureService(
      this.api.hap.Service.OccupancySensor,
      this.displayName(),
      SUBTYPE_OCCUPANCY,
    );
  }

  /** Recompute presence from the current loadpoints array. */
  applyLoadpoints(loadpoints: LoadpointState[]): void {
    const C = this.api.hap.Characteristic;
    const home = loadpoints.some(
      (lp) => lp.connected && lp.vehicleName === this.vehicle.name,
    );
    this.occupancyService.updateCharacteristic(C.OccupancyDetected, home ? 1 : 0);
  }

  applyVehicleUpdate(vehicle: VehicleState): void {
    this.vehicle = { ...this.vehicle, ...vehicle };
    applyServiceName(
      this.occupancyService,
      this.displayName(),
      this.api.hap.Characteristic,
    );
    const info = this.accessory.getService(this.api.hap.Service.AccessoryInformation);
    if (info) {
      info.updateCharacteristic(this.api.hap.Characteristic.Name, this.displayName());
    }
  }

  get name(): string | undefined {
    return this.vehicle.name;
  }

  dispose(): void {
    // No external listeners attached — managed by the platform.
  }

  // ---------------------------------------------------------------------------

  private displayName(): string {
    return this.vehicle.title ?? this.vehicle.name ?? "Vehicle";
  }

  private configureInformation(): void {
    const Service = this.api.hap.Service;
    const C = this.api.hap.Characteristic;
    const info =
      this.accessory.getService(Service.AccessoryInformation) ??
      this.accessory.addService(Service.AccessoryInformation);
    info
      .setCharacteristic(C.Manufacturer, "EVCC")
      .setCharacteristic(C.Model, "Vehicle")
      .setCharacteristic(C.SerialNumber, this.vehicle.name ?? "vehicle")
      .setCharacteristic(C.Name, this.displayName());
  }

  private ensureService(
    ctor: WithUUID<typeof Service>,
    name: string,
    subtype: string,
  ): Service {
    const services = (
      this.accessory as PlatformAccessory & { services: Service[] }
    ).services;
    const existing = services.find((s) => s.UUID === ctor.UUID && s.subtype === subtype);
    const svc = existing ?? this.accessory.addService(ctor, name, subtype);
    applyServiceName(svc, name, this.api.hap.Characteristic);
    return svc;
  }
}
