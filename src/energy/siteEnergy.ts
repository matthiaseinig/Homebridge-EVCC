import type { API, PlatformAccessory, Service } from "homebridge";
import type { EvccState } from "../api/types.js";
import { auxMeterEntries, pvArrayEntries, siteValues } from "./extract.js";
import { applyValues, energyHapTypes, ensureEnergyService, pruneServices } from "./hapTypes.js";
import { ServiceSet } from "./serviceSet.js";

export const SUBTYPE_ENERGY_SITE = "energy-site";

/**
 * Read-only site energy services on the site accessory:
 *
 *   - Energy Site   (one)              totals, grid, phases, battery, home, aux, tariffs
 *   - PV Array      (one per pv[])     per-array power and energy, keyed by meter name
 *   - Aux Meter     (one per aux[])    per-consumer power, keyed by meter name
 */
export class SiteEnergyServices {
  private readonly pv: ServiceSet;
  private readonly aux: ServiceSet;
  private site?: Service;

  constructor(
    private readonly api: API,
    private readonly accessory: PlatformAccessory,
    private readonly now: () => number = Date.now,
  ) {
    this.pv = new ServiceSet(api, accessory, "PvArray");
    this.aux = new ServiceSet(api, accessory, "AuxMeter");
  }

  /** Render `state`; `snapshot` is true for a full REST snapshot. */
  apply(state: EvccState, snapshot = false): void {
    const hap = this.api.hap;
    this.site = ensureEnergyService(
      hap,
      this.accessory,
      "EnergySite",
      "Energy Site",
      SUBTYPE_ENERGY_SITE,
    );
    applyValues(hap, this.site, siteValues(state, this.nowSeconds()));
    this.pv.sync(pvArrayEntries(state), snapshot);
    this.aux.sync(auxMeterEntries(state), snapshot);
  }

  /** Move Last Update for EVCC data that does not change site values (loadpoint frames). */
  touch(): void {
    if (!this.site) return;
    this.site.updateCharacteristic(
      energyHapTypes(this.api.hap).char("LastUpdate"),
      this.nowSeconds(),
    );
  }

  removeAll(): void {
    pruneServices(this.api.hap, this.accessory, "EnergySite", new Set());
    this.pv.removeAll();
    this.aux.removeAll();
    this.site = undefined;
  }

  private nowSeconds(): number {
    return Math.floor(this.now() / 1000);
  }
}
