import type { API, PlatformAccessory } from "homebridge";
import type { EvccState } from "../api/types.js";
import { statisticsEntries } from "./extract.js";
import { ServiceSet } from "./serviceSet.js";

/**
 * Read-only "Charging Statistics" services on the site accessory, one per
 * EVCC `statistics.<period>`, keyed by the period name.
 */
export class ChargingStatisticsServices {
  private readonly set: ServiceSet;

  constructor(api: API, accessory: PlatformAccessory) {
    this.set = new ServiceSet(api, accessory, "ChargingStatistics");
  }

  apply(state: EvccState, snapshot = false): void {
    this.set.sync(
      statisticsEntries(state).map((e) => ({
        subtype: `stat:${e.period}`,
        label: `Charging Statistics ${e.period}`,
        values: e.values,
      })),
      snapshot,
    );
  }

  removeAll(): void {
    this.set.removeAll();
  }
}
