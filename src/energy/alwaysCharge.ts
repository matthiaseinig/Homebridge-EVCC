import type { AlwaysChargeWrite, ChargeMode, LoadpointState } from "../api/types.js";

/**
 * EVCC 0.319 has three charge modes, `off`, `smart` and `now`. The former
 * `pv` and `minpv` modes became `smart` plus the loadpoint's "always charge"
 * setting (`alwaysCharge`: `off`, `on`, or `once` until the vehicle
 * disconnects; source: `api/chargemodestatus.go` and `core/loadpoint_api.go`
 * in evcc-io/evcc 0.319.0). Older EVCC versions publish no `alwaysCharge`
 * field and still use `pv` and `minpv` as real modes.
 */

/** Whether this EVCC instance publishes the always charge setting (0.319 and later). */
export function hasAlwaysChargeApi(lp: LoadpointState): boolean {
  return typeof lp.alwaysCharge === "string";
}

/**
 * Whether always charge can be written at this loadpoint. EVCC rejects it for
 * switch-socket chargers, which cannot hold a minimum current.
 */
export function alwaysChargeWritable(lp: LoadpointState): boolean {
  return hasAlwaysChargeApi(lp) && lp.chargerFeatureSwitchDevice !== true;
}

/**
 * Read value of the Always Charge characteristic: `on` and `once` are active.
 * On older EVCC the legacy modes carry the same meaning (`minpv` = always,
 * `pv` = solar only). Undefined when neither tells.
 */
export function alwaysChargeActive(lp: LoadpointState): boolean | undefined {
  switch (lp.alwaysCharge) {
    case "on":
    case "once":
      return true;
    case "off":
      return false;
  }
  if (lp.mode === "minpv") return true;
  if (lp.mode === "pv") return false;
  return undefined;
}

/** The EVCC calls for a Charge Mode write, in order: always charge first, then the mode. */
export interface ModeWritePlan {
  readonly alwaysCharge?: AlwaysChargeWrite;
  readonly mode: ChargeMode;
}

/**
 * Map a Charge Mode write onto the EVCC API of this instance. On EVCC with
 * always charge, the deprecated `pv` becomes `smart` with always charge off
 * and `minpv` becomes `smart` with always charge on (the same mapping EVCC
 * applies in `ChargeMode.Normalize`; switch-socket chargers get no always
 * charge, as in EVCC's `normalizeMode`). Older EVCC gets the mode unchanged.
 */
export function planModeWrite(mode: ChargeMode, lp: LoadpointState): ModeWritePlan {
  if (!hasAlwaysChargeApi(lp) || (mode !== "pv" && mode !== "minpv")) return { mode };
  if (!alwaysChargeWritable(lp)) return { mode: "smart" };
  return { mode: "smart", alwaysCharge: mode === "minpv" ? "on" : "off" };
}

/**
 * The mode the legacy mode switches (Now, PV, Min+PV) show as active. On EVCC
 * with always charge, `smart` reads as `minpv` while always charge is active
 * and as `pv` otherwise.
 */
export function legacySwitchMode(lp: LoadpointState): ChargeMode | undefined {
  if (lp.mode !== "smart" || !hasAlwaysChargeApi(lp)) return lp.mode;
  return alwaysChargeActive(lp) ? "minpv" : "pv";
}

/** Strictly parse an Always Charge write: a boolean (HAP may also send 1 or 0). */
export function parseAlwaysCharge(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (value === 1 || value === 0) return value === 1;
  return undefined;
}
