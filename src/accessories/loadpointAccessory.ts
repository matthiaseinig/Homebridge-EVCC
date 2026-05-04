import type { API, Logging, PlatformAccessory, Service, WithUUID } from "homebridge";
import type { EvccClient } from "../api/client.js";
import type { ChargeMode, LoadpointState } from "../api/types.js";
import { clampPercent, powerToLux } from "../util/powerToLux.js";

export type LoadpointModeUi = "outlet" | "switches" | "readonly";

export interface LoadpointAccessoryConfig {
  /** UI shape for mode/enable control. */
  modeUi: LoadpointModeUi;
  /** Default ChargeMode used when toggling the on/off Outlet to ON. */
  defaultMode: ChargeMode;
  /** When true, also expose the assigned vehicle's limitSoc as a second blinds. */
  exposeVehicleLimit: boolean;
  /** Whether write-back to EVCC is allowed (i.e. password configured & login succeeded). */
  writable: boolean;
}

export interface LoadpointAccessoryDeps {
  api: API;
  log: Logging;
  client: EvccClient;
  accessory: PlatformAccessory;
  loadpointId: number; // 0-based for WS/state, 1-based for REST API
  state: LoadpointState;
  config: LoadpointAccessoryConfig;
}

const SUBTYPE_OUTLET = "outlet";
const SUBTYPE_LIMIT_LP = "limit-loadpoint";
const SUBTYPE_LIMIT_VEHICLE = "limit-vehicle";
const SUBTYPE_BATTERY = "vehicle-battery";
const SUBTYPE_POWER = "charge-power";
const SUBTYPE_MODE_NOW = "mode-now";
const SUBTYPE_MODE_PV = "mode-pv";
const SUBTYPE_MODE_MINPV = "mode-minpv";

const MODE_SUBTYPES: Record<ChargeMode, string | null> = {
  off: null,
  now: SUBTYPE_MODE_NOW,
  pv: SUBTYPE_MODE_PV,
  minpv: SUBTYPE_MODE_MINPV,
};

const SWITCH_MODES: ChargeMode[] = ["now", "pv", "minpv"];

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
  private readonly api: API;
  private readonly log: Logging;
  private readonly client: EvccClient;
  private readonly accessory: PlatformAccessory;
  private readonly loadpointId: number;
  private readonly config: LoadpointAccessoryConfig;
  private state: LoadpointState;

  private outletService?: Service;
  private limitLoadpointService?: Service;
  private batteryService?: Service;
  private powerService?: Service;
  private readonly modeSwitches = new Map<ChargeMode, Service>();

  constructor(deps: LoadpointAccessoryDeps) {
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
    if (this.config.exposeVehicleLimit) this.configureLimitVehicle();
    this.configureVehicleBattery();
    this.configurePower();
    if (this.config.modeUi === "switches") this.configureModeSwitches();

    this.applyState(this.state);
  }

  /** Re-render every service from a fresh loadpoint state. */
  applyState(state: LoadpointState): void {
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
      this.batteryService.updateCharacteristic(
        C.ChargingState,
        this.state.charging ? 1 : 0, // 1 = CHARGING, 0 = NOT_CHARGING
      );
      this.batteryService.updateCharacteristic(
        C.StatusLowBattery,
        clampPercent(this.state.vehicleSoc) < 20 ? 1 : 0,
      );
    }

    if (this.powerService) {
      this.powerService.updateCharacteristic(
        C.CurrentAmbientLightLevel,
        powerToLux(this.state.chargePower),
      );
    }

    for (const [mode, svc] of this.modeSwitches) {
      svc.updateCharacteristic(C.On, this.state.mode === mode);
    }
  }

  /** Apply a single dotted-key WS update that targets this loadpoint. */
  applyPartial(key: string, value: unknown): void {
    // key is the segment after "loadpoints.<n>." — e.g. "chargePower"
    (this.state as Record<string, unknown>)[key] = value;
    this.applyState(this.state);
  }

  dispose(): void {
    // No long-lived listeners to detach — the platform owns the client subscription.
  }

  // ---------------------------------------------------------------------------
  // Service builders
  // ---------------------------------------------------------------------------

  private configureInformation(): void {
    const Service = this.api.hap.Service;
    const C = this.api.hap.Characteristic;
    const info =
      this.accessory.getService(Service.AccessoryInformation) ??
      this.accessory.addService(Service.AccessoryInformation);
    info
      .setCharacteristic(C.Manufacturer, "EVCC")
      .setCharacteristic(C.Model, "Loadpoint")
      .setCharacteristic(C.SerialNumber, `lp-${this.loadpointId}`)
      .setCharacteristic(C.Name, this.title());
  }

  private configureOutlet(): void {
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
        const target: ChargeMode = value ? this.config.defaultMode : "off";
        await this.safeSetMode(target);
      });
    }
  }

  private configureLimitLoadpoint(): void {
    const Service = this.api.hap.Service;
    const C = this.api.hap.Characteristic;
    const svc = this.ensureService(
      Service.WindowCovering,
      `${this.title()} Charge Limit`,
      SUBTYPE_LIMIT_LP,
    );
    this.limitLoadpointService = svc;

    if (this.canWrite()) {
      svc.getCharacteristic(C.TargetPosition).onSet(async (value) => {
        await this.safeSetLoadpointLimit(Number(value));
      });
    }
  }

  private configureLimitVehicle(): void {
    const Service = this.api.hap.Service;
    const C = this.api.hap.Characteristic;
    const svc = this.ensureService(
      Service.WindowCovering,
      `${this.title()} Vehicle Limit`,
      SUBTYPE_LIMIT_VEHICLE,
    );

    if (this.canWrite()) {
      svc.getCharacteristic(C.TargetPosition).onSet(async (value) => {
        if (!this.state.vehicleName) return;
        await this.safeSetVehicleLimit(this.state.vehicleName, Number(value));
      });
    }
  }

  private configureVehicleBattery(): void {
    this.batteryService = this.ensureService(
      this.api.hap.Service.Battery,
      `${this.title()} Vehicle`,
      SUBTYPE_BATTERY,
    );
  }

  private configurePower(): void {
    this.powerService = this.ensureService(
      this.api.hap.Service.LightSensor,
      `${this.title()} Power`,
      SUBTYPE_POWER,
    );
  }

  private configureModeSwitches(): void {
    const Service = this.api.hap.Service;
    const C = this.api.hap.Characteristic;
    for (const mode of SWITCH_MODES) {
      const subtype = MODE_SUBTYPES[mode];
      if (!subtype) continue;
      const svc = this.ensureService(Service.Switch, this.modeLabel(mode), subtype);
      this.modeSwitches.set(mode, svc);
      if (this.canWrite()) {
        svc.getCharacteristic(C.On).onSet(async (value) => {
          if (value) {
            await this.safeSetMode(mode);
          } else if (this.state.mode === mode) {
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

  private title(): string {
    return this.state.title ?? `Loadpoint ${this.loadpointId + 1}`;
  }

  private modeLabel(mode: ChargeMode): string {
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

  private canWrite(): boolean {
    return this.config.writable && this.config.modeUi !== "readonly";
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
    const C = this.api.hap.Characteristic;
    svc.setCharacteristic(C.Name, name);
    if (C.ConfiguredName) {
      try {
        svc.setCharacteristic(C.ConfiguredName, name);
      } catch {
        // Characteristic.ConfiguredName isn't on every HAP version — fine to skip.
      }
    }
    return svc;
  }

  private async safeSetMode(mode: ChargeMode): Promise<void> {
    try {
      // EVCC REST API uses 1-based loadpoint IDs.
      await this.client.setLoadpointMode(this.loadpointId + 1, mode);
    } catch (err) {
      this.log.warn(
        "Failed to set loadpoint %d mode=%s: %s",
        this.loadpointId + 1,
        mode,
        (err as Error).message,
      );
    }
  }

  private async safeSetLoadpointLimit(soc: number): Promise<void> {
    try {
      await this.client.setLoadpointLimitSoc(this.loadpointId + 1, soc);
    } catch (err) {
      this.log.warn(
        "Failed to set loadpoint %d limitSoc=%d: %s",
        this.loadpointId + 1,
        soc,
        (err as Error).message,
      );
    }
  }

  private async safeSetVehicleLimit(name: string, soc: number): Promise<void> {
    try {
      await this.client.setVehicleLimitSoc(name, soc);
    } catch (err) {
      this.log.warn(
        "Failed to set vehicle %s limitSoc=%d: %s",
        name,
        soc,
        (err as Error).message,
      );
    }
  }
}
