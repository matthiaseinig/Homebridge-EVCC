import { describe, expect, it } from "vitest";
import {
  HOMEKIT_LUX_MAX,
  HOMEKIT_LUX_MIN,
  clampPercent,
  powerToLux,
} from "../../src/util/powerToLux.js";

describe("powerToLux", () => {
  it("returns the floor for null, undefined, NaN", () => {
    expect(powerToLux(undefined)).toBe(HOMEKIT_LUX_MIN);
    expect(powerToLux(null)).toBe(HOMEKIT_LUX_MIN);
    expect(powerToLux(NaN)).toBe(HOMEKIT_LUX_MIN);
  });

  it("returns the floor for sub-min values", () => {
    expect(powerToLux(0)).toBe(HOMEKIT_LUX_MIN);
    expect(powerToLux(0.00005)).toBe(HOMEKIT_LUX_MIN);
  });

  it("absolutes negative values (e.g. grid feed-in)", () => {
    expect(powerToLux(-1234)).toBe(1234);
  });

  it("passes through in-range values", () => {
    expect(powerToLux(2500)).toBe(2500);
  });

  it("clamps to the lux ceiling", () => {
    expect(powerToLux(HOMEKIT_LUX_MAX + 1)).toBe(HOMEKIT_LUX_MAX);
  });
});

describe("clampPercent", () => {
  it("returns 0 for null/undefined/NaN", () => {
    expect(clampPercent(undefined)).toBe(0);
    expect(clampPercent(null)).toBe(0);
    expect(clampPercent(NaN)).toBe(0);
  });

  it("clamps below 0 to 0", () => {
    expect(clampPercent(-5)).toBe(0);
  });

  it("clamps above 100 to 100", () => {
    expect(clampPercent(150)).toBe(100);
  });

  it("rounds to integer in range", () => {
    expect(clampPercent(42.7)).toBe(43);
    expect(clampPercent(99.4)).toBe(99);
  });
});
