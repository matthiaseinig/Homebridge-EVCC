import type { API, Logging, PlatformAccessory, Service, WithUUID } from "homebridge";
import type { EvccClient } from "../api/client.js";
import type { BatteryMode, EvccState } from "../api/types.js";
import { ChargingStatisticsServices } from "../energy/chargingStatistics.js";
import { SiteEnergyServices } from "../energy/siteEnergy.js";
import { applyServiceName } from "../util/applyServiceName.js";
import { clampPercent, powerToLux } from "../util/powerToLux.js";

export interface SiteAccessoryDeps {
  api: API;
  log: Logging;
  client: EvccClient;
  accessory: PlatformAccessory;
  state: EvccState;
  /** Whether write-back to EVCC is allowed. Controls the battery-mode switches. */
  writable: boolean;
  /** Expose the read-only custom site energy and charging statistics services (docs/zuhause-contract.md). Default true. */
  energy?: boolean;
  /** Clock for the Last Update characteristic; injectable for tests. */
  now?: () => number;
}

const SUBTYPE_BATTERY = "home-battery";
const SUBTYPE_PV = "pv-power";
const SUBTYPE_GRID = "grid-power";
const SUBTYPE_GRID_DIR = "grid-direction";
const SUBTYPE_HOME = "home-power";
const SUBTYPE_MODE_NORMAL = "battery-mode-normal";
const SUBTYPE_MODE_HOLD = "battery-mode-hold";
const SUBTYPE_MODE_CHARGE = "battery-mode-charge";

const BATTERY_MODE_SUBTYPES: Record<Exclude<BatteryMode, "unknown">, string> = {
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
 *   - Custom site energy services (Energy Site, PV Array, Aux Meter) and
 *     "Charging Statistics" services, read-only, unless disabled
 *     (see SiteEnergyServices, ChargingStatisticsServices)
 */
export class SiteAccessory {
  private readonly api: API;
  private readonly log: Logging;
  private readonly client: EvccClient;
  private readonly accessory: PlatformAccessory;
  private readonly writable: boolean;
  private state: EvccState;

  private batteryService?: Service;
  private pvService?: Service;
  private gridService?: Service;
  private gridDirectionService?: Service;
  private homeService?: Service;
  private readonly modeSwitches = new Map<Exclude<BatteryMode, "unknown">, Service>();
  private readonly energy: SiteEnergyServices;
  private readonly statistics: ChargingStatisticsServices;
  private readonly energyEnabled: boolean;

  constructor(deps: SiteAccessoryDeps) {
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
    if (this.writable) this.configureBatteryModeSwitches();

    this.energyEnabled = deps.energy ?? true;
    this.energy = new SiteEnergyServices(this.api, this.accessory, deps.now);
    this.statistics = new ChargingStatisticsServices(this.api, this.accessory);
    if (!this.energyEnabled) {
      this.energy.removeAll();
      this.statistics.removeAll();
    }

    // The platform constructs this accessory from a full REST snapshot.
    this.applyState(this.state, true);
  }

  /** Re-render from `state`; `snapshot` is true for a full REST snapshot. */
  applyState(state: EvccState, snapshot = false): void {
    this.state = state;
    const C = this.api.hap.Characteristic;
    const battery = state.battery ?? {};
    // siteTitle can change post-startup (rare, but happens on EVCC config reload).
    const info = this.accessory.getService(this.api.hap.Service.AccessoryInformation);
    if (info) info.updateCharacteristic(C.Name, state.siteTitle ?? "EVCC");

    if (this.batteryService) {
      this.batteryService.updateCharacteristic(C.BatteryLevel, clampPercent(battery.soc));
      // ChargingState: 0 = NOT_CHARGING, 1 = CHARGING (positive battery.power = discharging,
      // so we charge when power < 0). 2 = NOT_CHARGEABLE; we don't use it.
      const power = typeof battery.power === "number" ? battery.power : 0;
      this.batteryService.updateCharacteristic(C.ChargingState, power < 0 ? 1 : 0);
      this.batteryService.updateCharacteristic(
        C.StatusLowBattery,
        clampPercent(battery.soc) < 20 ? 1 : 0,
      );
    }

    if (this.pvService) {
      this.pvService.updateCharacteristic(
        C.CurrentAmbientLightLevel,
        powerToLux(state.pvPower as number | undefined),
      );
    }

    if (this.gridService) {
      const gridPower = state.grid && typeof (state.grid as { power?: number }).power === "number"
        ? (state.grid as { power: number }).power
        : 0;
      this.gridService.updateCharacteristic(C.CurrentAmbientLightLevel, powerToLux(gridPower));
      if (this.gridDirectionService) {
        // ContactSensor: 0 = CONTACT_DETECTED ("closed", we use for export),
        //                1 = CONTACT_NOT_DETECTED ("open", we use for import).
        this.gridDirectionService.updateCharacteristic(
          C.ContactSensorState,
          gridPower < 0 ? 0 : 1,
        );
      }
    }

    if (this.homeService) {
      this.homeService.updateCharacteristic(
        C.CurrentAmbientLightLevel,
        powerToLux(state.homePower as number | undefined),
      );
    }

    const mode = state.batteryMode;
    for (const [m, svc] of this.modeSwitches) {
      svc.updateCharacteristic(C.On, mode === m);
    }

    if (this.energyEnabled) {
      this.energy.apply(state, snapshot);
      this.statistics.apply(state, snapshot);
    }
  }

  /** EVCC data arrived that does not touch site values (a loadpoint frame): move Last Update. */
  touch(): void {
    if (this.energyEnabled) this.energy.touch();
  }

  dispose(): void {
    // Nothing to detach.
  }

  // ---------------------------------------------------------------------------

  private configureInformation(): void {
    const Service = this.api.hap.Service;
    const C = this.api.hap.Characteristic;
    const info =
      this.accessory.getService(Service.AccessoryInformation) ??
      this.accessory.addService(Service.AccessoryInformation);
    info
      .setCharacteristic(C.Manufacturer, "EVCC")
      .setCharacteristic(C.Model, "Site")
      .setCharacteristic(C.SerialNumber, "evcc-site")
      .setCharacteristic(C.Name, this.state.siteTitle ?? "EVCC");
  }

  private configureBattery(): void {
    this.batteryService = this.ensureService(
      this.api.hap.Service.Battery,
      "Home Battery",
      SUBTYPE_BATTERY,
    );
  }

  private configurePv(): void {
    this.pvService = this.ensureService(
      this.api.hap.Service.LightSensor,
      "PV Production",
      SUBTYPE_PV,
    );
  }

  private configureGrid(): void {
    this.gridService = this.ensureService(
      this.api.hap.Service.LightSensor,
      "Grid Power",
      SUBTYPE_GRID,
    );
    this.gridDirectionService = this.ensureService(
      this.api.hap.Service.ContactSensor,
      "Grid Direction",
      SUBTYPE_GRID_DIR,
    );
  }

  private configureHome(): void {
    this.homeService = this.ensureService(
      this.api.hap.Service.LightSensor,
      "Home Consumption",
      SUBTYPE_HOME,
    );
  }

  private configureBatteryModeSwitches(): void {
    const Service = this.api.hap.Service;
    const C = this.api.hap.Characteristic;
    for (const mode of Object.keys(BATTERY_MODE_SUBTYPES) as Array<
      Exclude<BatteryMode, "unknown">
    >) {
      const svc = this.ensureService(Service.Switch, `Battery ${mode}`, BATTERY_MODE_SUBTYPES[mode]);
      this.modeSwitches.set(mode, svc);
      svc.getCharacteristic(C.On).onSet(async (value) => {
        if (!value) return;
        try {
          await this.client.setBatteryMode(mode);
        } catch (err) {
          this.log.warn("Failed to set battery mode %s: %s", mode, (err as Error).message);
          throw new this.api.hap.HapStatusError(
            this.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE,
          );
        }
      });
    }
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
