import type { API, PlatformAccessory } from "homebridge";
import type { EvccState } from "../api/types.js";
import type { ServiceKey } from "./definitions.js";
import { auxMeterEntries, pvArrayEntries, siteValues, statisticsEntries } from "./extract.js";
import { applyValues, ensureEnergyService, pruneServices } from "./hapTypes.js";

export const SUBTYPE_ENERGY_SITE = "energy-site";
const STAT_PREFIX = "stat:";

/**
 * Custom energy services on the site accessory:
 *
 *   - Energy Site           (one)              totals, grid, phases, battery, home, aux, tariffs
 *   - PV Array              (one per pv[])     per-array power and energy
 *   - Aux Meter             (one per aux[])    per-consumer power
 *   - Charging Statistics   (one per period)   statistics.<period>
 *
 * Read-only. Per-meter services follow the EVCC configuration: services for
 * meters that disappear from the state are removed.
 */
export class SiteEnergyServices {
  constructor(
    private readonly api: API,
    private readonly accessory: PlatformAccessory,
    private readonly now: () => number = Date.now,
  ) {}

  apply(state: EvccState): void {
    const hap = this.api.hap;
    const site = ensureEnergyService(
      hap,
      this.accessory,
      "EnergySite",
      "Energy Site",
      SUBTYPE_ENERGY_SITE,
    );
    applyValues(hap, site, siteValues(state, Math.floor(this.now() / 1000)));

    this.syncMeters("PvArray", pvArrayEntries(state));
    this.syncMeters("AuxMeter", auxMeterEntries(state));

    const stats = statisticsEntries(state);
    const keep = new Set<string>();
    for (const entry of stats) {
      const subtype = STAT_PREFIX + entry.period;
      keep.add(subtype);
      const svc = ensureEnergyService(
        hap,
        this.accessory,
        "ChargingStatistics",
        `Charging Statistics ${entry.period}`,
        subtype,
      );
      applyValues(hap, svc, entry.values);
    }
    pruneServices(hap, this.accessory, "ChargingStatistics", keep);
  }

  /** Remove every custom energy service from the site accessory. */
  removeAll(): void {
    const none = new Set<string>();
    for (const key of ["EnergySite", "PvArray", "AuxMeter", "ChargingStatistics"] as const) {
      pruneServices(this.api.hap, this.accessory, key, none);
    }
  }

  private syncMeters(
    key: Extract<ServiceKey, "PvArray" | "AuxMeter">,
    entries: ReturnType<typeof pvArrayEntries>,
  ): void {
    const hap = this.api.hap;
    const keep = new Set<string>();
    for (const entry of entries) {
      keep.add(entry.key);
      const svc = ensureEnergyService(hap, this.accessory, key, entry.label, entry.key);
      applyValues(hap, svc, entry.values);
    }
    pruneServices(hap, this.accessory, key, keep);
  }
}
