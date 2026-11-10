import type { API, PlatformAccessory } from "homebridge";
import type { EvccState } from "../api/types.js";
import { statisticsEntries } from "./extract.js";
import {
  applyValues,
  energyHapTypes,
  ensureEnergyService,
  pruneRetiredServices,
  pruneServices,
  servicesOfType,
} from "./hapTypes.js";

const STAT_PREFIX = "stat:";
export const MISSING_SNAPSHOTS_BEFORE_REMOVAL = 3;

/**
 * Read-only "Charging Statistics" services on the site accessory, one per
 * EVCC `statistics.<period>`, keyed by the period name (stable subtype).
 * Services for periods that stay absent are removed. Site energy (PV, battery, grid, home, aux) is not exposed by this
 * plugin; services with retired site-energy UUIDs are removed from the
 * cached accessory.
 */
export class ChargingStatisticsServices {
  /** Consecutive snapshots in which a period's service had no data, by subtype. */
  private readonly misses = new Map<string, number>();

  constructor(
    private readonly api: API,
    private readonly accessory: PlatformAccessory,
  ) {
    pruneRetiredServices(accessory);
  }

  /**
   * Render the statistics. `snapshot` is true for full REST snapshots; a
   * period missing from a snapshot is only removed after it was missing from
   * MISSING_SNAPSHOTS_BEFORE_REMOVAL consecutive snapshots, so one incomplete
   * payload does not make services (and app bindings) flap.
   */
  apply(state: EvccState, snapshot = false): void {
    const hap = this.api.hap;
    const present = new Set<string>();
    for (const entry of statisticsEntries(state)) {
      const subtype = STAT_PREFIX + entry.period;
      present.add(subtype);
      this.misses.delete(subtype);
      const svc = ensureEnergyService(
        hap,
        this.accessory,
        "ChargingStatistics",
        `Charging Statistics ${entry.period}`,
        subtype,
      );
      applyValues(hap, svc, entry.values);
    }
    const ctor = energyHapTypes(hap).service("ChargingStatistics");
    const keep = new Set(present);
    for (const svc of servicesOfType(this.accessory, ctor)) {
      const subtype = svc.subtype ?? "";
      if (present.has(subtype)) continue;
      const misses = (this.misses.get(subtype) ?? 0) + (snapshot ? 1 : 0);
      this.misses.set(subtype, misses);
      if (misses < MISSING_SNAPSHOTS_BEFORE_REMOVAL) keep.add(subtype);
      else this.misses.delete(subtype);
    }
    pruneServices(hap, this.accessory, "ChargingStatistics", keep);
  }

  /** Remove every custom service from the site accessory. */
  removeAll(): void {
    pruneServices(this.api.hap, this.accessory, "ChargingStatistics", new Set());
  }
}
