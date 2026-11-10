import type { API, PlatformAccessory } from "homebridge";
import type { LoadpointSummary } from "../sessions/summary.js";
import { applyValues, ensureEnergyService, pruneServices } from "./hapTypes.js";

export const SUBTYPE_CHARGING_HISTORY = "charging-history";

/**
 * Read-only "Charging History" service on a loadpoint accessory: summaries of
 * the plugin's copy of EVCC's session log for that loadpoint.
 */
export class ChargingHistoryService {
  constructor(
    private readonly api: API,
    private readonly accessory: PlatformAccessory,
  ) {}

  apply(title: string, summary: LoadpointSummary, updatedSeconds: number): void {
    const svc = ensureEnergyService(
      this.api.hap,
      this.accessory,
      "ChargingHistory",
      `${title} Charging History`,
      SUBTYPE_CHARGING_HISTORY,
    );
    applyValues(this.api.hap, svc, {
      ChargedToday: summary.todayKWh,
      ChargedMonth: summary.monthKWh,
      SolarShareMonth: summary.monthSolarPercentage,
      LastSessionEnergy: summary.lastSessionKWh,
      LastSessionEnd: summary.lastSessionEnd,
      SessionsUpdated: updatedSeconds,
    });
  }

  remove(): void {
    pruneServices(this.api.hap, this.accessory, "ChargingHistory", new Set());
  }
}
