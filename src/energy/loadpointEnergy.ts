import type { API, PlatformAccessory, Service } from "homebridge";
import type { LoadpointState } from "../api/types.js";
import { loadpointValues } from "./extract.js";
import { applyValues, ensureEnergyService, pruneServices } from "./hapTypes.js";

export const SUBTYPE_LOADPOINT_ENERGY = "loadpoint-energy";

/**
 * Custom "Loadpoint Energy" service on a loadpoint accessory. Read-only
 * except Charge Mode and Set Plan, whose write handlers the loadpoint
 * accessory registers.
 */
export class LoadpointEnergyService {
  constructor(
    private readonly api: API,
    private readonly accessory: PlatformAccessory,
    private readonly now: () => number = Date.now,
  ) {}

  /** Find or create the service. */
  ensure(title: string): Service {
    return ensureEnergyService(
      this.api.hap,
      this.accessory,
      "LoadpointEnergy",
      `${title} Energy`,
      SUBTYPE_LOADPOINT_ENERGY,
    );
  }

  apply(state: LoadpointState, title: string): void {
    const svc = this.ensure(title);
    applyValues(this.api.hap, svc, loadpointValues(state, Math.floor(this.now() / 1000)));
  }

  remove(): void {
    pruneServices(this.api.hap, this.accessory, "LoadpointEnergy", new Set());
  }
}
