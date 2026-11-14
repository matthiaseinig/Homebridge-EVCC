import type { API, PlatformAccessory } from "homebridge";
import type { CharValues, ServiceKey } from "./definitions.js";
import {
  applyValues,
  energyHapTypes,
  ensureEnergyService,
  pruneServices,
  servicesOfType,
} from "./hapTypes.js";

/** One service instance of a repeated custom service type. */
export interface ServiceEntry {
  /** Stable HAP subtype (derived from an EVCC name, never from an array index). */
  subtype: string;
  /** Display name. */
  label: string;
  values: CharValues;
}

/**
 * A service instance whose entry is missing from this many consecutive REST
 * snapshots is removed. Websocket-driven renders never count, so one
 * incomplete payload does not make services (and app bindings) flap.
 */
export const MISSING_SNAPSHOTS_BEFORE_REMOVAL = 3;

/** Keeps one service per entry for a repeated custom service type on one accessory. */
export class ServiceSet {
  private readonly misses = new Map<string, number>();

  constructor(
    private readonly api: API,
    private readonly accessory: PlatformAccessory,
    private readonly key: ServiceKey,
  ) {}

  /** Render `entries`; `snapshot` is true for a full REST snapshot. */
  sync(entries: readonly ServiceEntry[], snapshot: boolean): void {
    const hap = this.api.hap;
    const present = new Set<string>();
    for (const entry of entries) {
      present.add(entry.subtype);
      this.misses.delete(entry.subtype);
      const svc = ensureEnergyService(hap, this.accessory, this.key, entry.label, entry.subtype);
      applyValues(hap, svc, entry.values);
    }
    const keep = new Set(present);
    const ctor = energyHapTypes(hap).service(this.key);
    for (const svc of servicesOfType(this.accessory, ctor)) {
      const subtype = svc.subtype ?? "";
      if (present.has(subtype)) continue;
      const misses = (this.misses.get(subtype) ?? 0) + (snapshot ? 1 : 0);
      if (misses < MISSING_SNAPSHOTS_BEFORE_REMOVAL) {
        this.misses.set(subtype, misses);
        keep.add(subtype);
      } else {
        this.misses.delete(subtype);
      }
    }
    pruneServices(hap, this.accessory, this.key, keep);
  }

  removeAll(): void {
    this.misses.clear();
    pruneServices(this.api.hap, this.accessory, this.key, new Set());
  }
}
