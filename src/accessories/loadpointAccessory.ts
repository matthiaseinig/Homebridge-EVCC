import type { API, Logging, PlatformAccessory, Service, WithUUID } from "homebridge";
import type { EvccClient } from "../api/client.js";
import type { ChargeMode, LoadpointState } from "../api/types.js";
import { CONTROL_ROLES } from "../energy/definitions.js";
import { parseChargeMode, parsePlanRequest, toRfc3339 } from "../energy/writeValidation.js";
import {
  energyHapTypes,
  ensureCustomCharacteristic,
  removeCustomCharacteristic,
} from "../energy/hapTypes.js";
import { ChargingHistoryService } from "../energy/chargingHistory.js";
import { LoadpointEnergyService } from "../energy/loadpointEnergy.js";
import type { LoadpointSummary } from "../sessions/summary.js";
import { applyServiceName } from "../util/applyServiceName.js";
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
  /** Expose the read-only custom Loadpoint Energy service (docs/zuhause-contract.md). Default true. */
  energy?: boolean;
  /** Expose the Charging History service (needs `energy`). The platform sets it unless `sessions.enabled` is false, so the default is true. */
  sessions?: boolean;
}

export interface LoadpointAccessoryDeps {
  api: API;
  log: Logging;
  client: EvccClient;
  accessory: PlatformAccessory;
  loadpointId: number; // 0-based for WS/state, 1-based for REST API
  state: LoadpointState;
  config: LoadpointAccessoryConfig;
  /** Clock for the Last Update characteristic; injectable for tests. */
  now?: () => number;
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

const MODE_ROLES: Record<string, string> = {
  now: CONTROL_ROLES.modeNow,
  pv: CONTROL_ROLES.modePv,
  minpv: CONTROL_ROLES.modeMinPv,
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
 * service names (docs/zuhause-contract.md).
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
  private limitVehicleService?: Service;
  private batteryService?: Service;
  private powerService?: Service;
  private readonly modeSwitches = new Map<ChargeMode, Service>();
  private readonly energy: LoadpointEnergyService;
  private readonly history: ChargingHistoryService;
  private chargingService?: Service;
  private readonly now: () => number;
  private readonly energyEnabled: boolean;

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

    this.energyEnabled = this.config.energy ?? true;
    this.now = deps.now ?? Date.now;
    this.energy = new LoadpointEnergyService(this.api, this.accessory, this.now);
    if (this.energyEnabled) {
      this.chargingService = this.energy.ensure(this.title());
      this.configureChargingWrites(this.chargingService);
    } else {
      this.energy.remove();
    }
    this.history = new ChargingHistoryService(this.api, this.accessory);
    if (!this.energyEnabled || !this.config.sessions) this.history.remove();
    this.syncControlRoles();

    this.applyState(this.state);
  }

  /** Loadpoint title as EVCC reports it; the session log refers to loadpoints by it. */
  loadpointTitle(): string {
    return this.title();
  }

  /** Render the Charging History service; ignored unless history is enabled. */
  applySessions(summary: LoadpointSummary, updatedSeconds: number): void {
    if (!this.energyEnabled || !this.config.sessions) return;
    this.history.apply(this.title(), summary, updatedSeconds);
  }

  /** Re-render every service from a fresh loadpoint state. */
  applyState(state: LoadpointState): void {
    this.state = { ...this.state, ...state };
    const C = this.api.hap.Characteristic;
    // Title can arrive late (after WS reconnect) — keep AccessoryInformation in sync.
    this.refreshInformationName();

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

    if (this.energyEnabled) this.energy.apply(this.state, this.title());
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

  private refreshInformationName(): void {
    const info = this.accessory.getService(this.api.hap.Service.AccessoryInformation);
    if (info) info.updateCharacteristic(this.api.hap.Characteristic.Name, this.title());
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
    this.limitVehicleService = svc;

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

  /** Tag each control service with its role and whether writes reach EVCC. */
  private syncControlRoles(): void {
    const controls: Array<[Service | undefined, string, boolean]> = [
      [this.chargingService, CONTROL_ROLES.charging, this.canWrite()],
      [
        this.outletService,
        CONTROL_ROLES.outlet,
        this.canWrite() && this.config.modeUi !== "switches",
      ],
      [this.limitLoadpointService, CONTROL_ROLES.limitLoadpoint, this.canWrite()],
      [this.limitVehicleService, CONTROL_ROLES.limitVehicle, this.canWrite()],
      ...[...this.modeSwitches].map(([mode, svc]): [Service, string, boolean] => [
        svc,
        MODE_ROLES[mode],
        this.canWrite(),
      ]),
    ];
    const hap = this.api.hap;
    for (const [svc, role, enabled] of controls) {
      if (!svc) continue;
      if (this.energyEnabled) {
        ensureCustomCharacteristic(hap, svc, "ControlRole").updateValue(role);
        ensureCustomCharacteristic(hap, svc, "ControlEnabled").updateValue(enabled);
      } else {
        removeCustomCharacteristic(svc, "ControlRole");
        removeCustomCharacteristic(svc, "ControlEnabled");
      }
    }
  }

  private canWrite(): boolean {
    return this.config.writable && this.config.modeUi !== "readonly";
  }

  private ensureService(ctor: WithUUID<typeof Service>, name: string, subtype: string): Service {
    const services = (this.accessory as PlatformAccessory & { services: Service[] }).services;
    const existing = services.find((s) => s.UUID === ctor.UUID && s.subtype === subtype);
    const svc = existing ?? this.accessory.addService(ctor, name, subtype);
    applyServiceName(svc, name, this.api.hap.Characteristic);
    return svc;
  }

  /** Charge Mode and Set Plan on the Loadpoint Energy service accept writes (validated strictly). */
  private configureChargingWrites(svc: Service): void {
    const types = energyHapTypes(this.api.hap);
    svc.getCharacteristic(types.char("ChargeMode")).onSet(async (value) => {
      this.requireWritable();
      const mode = parseChargeMode(value);
      if (!mode) throw this.hapError("INVALID_VALUE_IN_REQUEST");
      await this.safeSetMode(mode);
    });
    svc.getCharacteristic(types.char("SetPlan")).onSet(async (value) => {
      this.requireWritable();
      const request = parsePlanRequest(value, Math.floor(this.now() / 1000));
      if (!request) throw this.hapError("INVALID_VALUE_IN_REQUEST");
      // EVCC keeps SoC plans per vehicle; the plan goes to the vehicle at this loadpoint.
      const vehicle = this.state.vehicleName;
      if (!vehicle) throw this.hapError("NOT_ALLOWED_IN_CURRENT_STATE");
      try {
        if (request.kind === "clear") await this.client.deleteVehiclePlanSoc(vehicle);
        else await this.client.setVehiclePlanSoc(vehicle, request.soc, toRfc3339(request.time));
      } catch (err) {
        this.log.warn("Failed to set plan for vehicle %s: %s", vehicle, (err as Error).message);
        throw this.hapError("SERVICE_COMMUNICATION_FAILURE");
      }
    });
  }

  private requireWritable(): void {
    if (!this.canWrite()) throw this.hapError("INSUFFICIENT_PRIVILEGES");
  }

  private hapError(
    status:
      | "SERVICE_COMMUNICATION_FAILURE"
      | "INVALID_VALUE_IN_REQUEST"
      | "NOT_ALLOWED_IN_CURRENT_STATE"
      | "INSUFFICIENT_PRIVILEGES",
  ): Error {
    const hap = this.api.hap;
    const code = {
      SERVICE_COMMUNICATION_FAILURE: hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE,
      INVALID_VALUE_IN_REQUEST: hap.HAPStatus.INVALID_VALUE_IN_REQUEST,
      NOT_ALLOWED_IN_CURRENT_STATE: hap.HAPStatus.NOT_ALLOWED_IN_CURRENT_STATE,
      INSUFFICIENT_PRIVILEGES: hap.HAPStatus.INSUFFICIENT_PRIVILEGES,
    }[status];
    return new this.api.hap.HapStatusError(code);
  }

  /** Forward a mode change; an EVCC failure becomes a HAP communication error. */
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
      throw this.hapError("SERVICE_COMMUNICATION_FAILURE");
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
      throw this.hapError("SERVICE_COMMUNICATION_FAILURE");
    }
  }

  private async safeSetVehicleLimit(name: string, soc: number): Promise<void> {
    try {
      await this.client.setVehicleLimitSoc(name, soc);
    } catch (err) {
      this.log.warn("Failed to set vehicle %s limitSoc=%d: %s", name, soc, (err as Error).message);
      throw this.hapError("SERVICE_COMMUNICATION_FAILURE");
    }
  }
}
