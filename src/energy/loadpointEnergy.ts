import type { API, PlatformAccessory } from "homebridge";
import type { LoadpointState } from "../api/types.js";
import { loadpointValues } from "./extract.js";
import { applyValues, ensureEnergyService, pruneServices } from "./hapTypes.js";

export const SUBTYPE_LOADPOINT_ENERGY = "loadpoint-energy";

/** Read-only custom "Loadpoint Energy" service on a loadpoint accessory. */
export class LoadpointEnergyService {
  constructor(
    private readonly api: API,
    private readonly accessory: PlatformAccessory,
  ) {}

  apply(state: LoadpointState, title: string): void {
    const svc = ensureEnergyService(
      this.api.hap,
      this.accessory,
      "LoadpointEnergy",
      `${title} Energy`,
      SUBTYPE_LOADPOINT_ENERGY,
    );
    applyValues(this.api.hap, svc, loadpointValues(state));
  }

  remove(): void {
    pruneServices(this.api.hap, this.accessory, "LoadpointEnergy", new Set());
  }
}
