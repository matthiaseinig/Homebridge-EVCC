import { describe, expect, it } from "vitest";
import type { LoadpointState } from "../../src/api/types.js";
import {
  alwaysChargeActive,
  alwaysChargeWritable,
  hasAlwaysChargeApi,
  legacySwitchMode,
  parseAlwaysCharge,
  planModeWrite,
} from "../../src/energy/alwaysCharge.js";
import { loadpointValues } from "../../src/energy/extract.js";

// EVCC 0.319 publishes `alwaysCharge`; older EVCC does not.
const NEW_OFF: LoadpointState = { mode: "smart", alwaysCharge: "off" };
const NEW_ON: LoadpointState = { mode: "smart", alwaysCharge: "on" };
const NEW_ONCE: LoadpointState = { mode: "smart", alwaysCharge: "once" };
const SWITCH: LoadpointState = { ...NEW_OFF, chargerFeatureSwitchDevice: true };

describe("always charge", () => {
  it("detects the EVCC 0.319 API by the published field", () => {
    expect(hasAlwaysChargeApi(NEW_OFF)).toBe(true);
    expect(hasAlwaysChargeApi({ mode: "pv" })).toBe(false);
    expect(alwaysChargeWritable(NEW_OFF)).toBe(true);
    expect(alwaysChargeWritable(SWITCH)).toBe(false);
    expect(alwaysChargeWritable({ mode: "minpv" })).toBe(false);
  });

  it("reads on and once as active, off as inactive", () => {
    expect(alwaysChargeActive(NEW_ON)).toBe(true);
    expect(alwaysChargeActive(NEW_ONCE)).toBe(true);
    expect(alwaysChargeActive(NEW_OFF)).toBe(false);
  });

  it("derives the value from legacy modes on older EVCC", () => {
    expect(alwaysChargeActive({ mode: "minpv" })).toBe(true);
    expect(alwaysChargeActive({ mode: "pv" })).toBe(false);
    expect(alwaysChargeActive({ mode: "now" })).toBeUndefined();
    expect(alwaysChargeActive({})).toBeUndefined();
  });

  it("maps legacy mode writes to smart plus always charge on EVCC 0.319", () => {
    expect(planModeWrite("pv", NEW_ON)).toEqual({ mode: "smart", alwaysCharge: "off" });
    expect(planModeWrite("minpv", NEW_OFF)).toEqual({ mode: "smart", alwaysCharge: "on" });
    for (const mode of ["off", "now", "smart"] as const) {
      expect(planModeWrite(mode, NEW_ON)).toEqual({ mode });
    }
  });

  it("does not touch always charge on switch-socket chargers", () => {
    expect(planModeWrite("minpv", SWITCH)).toEqual({ mode: "smart" });
    expect(planModeWrite("pv", SWITCH)).toEqual({ mode: "smart" });
  });

  it("forwards legacy modes unchanged to older EVCC", () => {
    expect(planModeWrite("pv", { mode: "now" })).toEqual({ mode: "pv" });
    expect(planModeWrite("minpv", {})).toEqual({ mode: "minpv" });
  });

  it("shows the legacy switch mode for smart", () => {
    expect(legacySwitchMode(NEW_ON)).toBe("minpv");
    expect(legacySwitchMode(NEW_ONCE)).toBe("minpv");
    expect(legacySwitchMode(NEW_OFF)).toBe("pv");
    expect(legacySwitchMode({ mode: "now", alwaysCharge: "on" })).toBe("now");
    expect(legacySwitchMode({ mode: "smart" })).toBe("smart");
    expect(legacySwitchMode({ mode: "pv" })).toBe("pv");
  });

  it("parses writes strictly", () => {
    expect(parseAlwaysCharge(true)).toBe(true);
    expect(parseAlwaysCharge(false)).toBe(false);
    expect(parseAlwaysCharge(1)).toBe(true);
    expect(parseAlwaysCharge(0)).toBe(false);
    for (const bad of ["on", "true", 2, null, undefined, {}]) {
      expect(parseAlwaysCharge(bad)).toBeUndefined();
    }
  });

  it("exposes Always Charge and Min Current in the loadpoint values", () => {
    expect(loadpointValues({ ...NEW_ON, effectiveMinCurrent: 7, minCurrent: 6 }, 0)).toMatchObject({
      AlwaysCharge: true,
      MinCurrent: 7,
    });
    expect(loadpointValues({ ...NEW_OFF, minCurrent: 6 }, 0)).toMatchObject({
      AlwaysCharge: false,
      MinCurrent: 6,
    });
    expect(loadpointValues({ mode: "now" }, 0).MinCurrent).toBeUndefined();
  });
});
