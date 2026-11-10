import { describe, expect, it } from "vitest";
import { CHARS } from "../../src/energy/definitions.js";
import { sanitize, shareToPercent, toEpochSeconds, whToKwh } from "../../src/energy/sanitize.js";

describe("sanitize", () => {
  it("rounds power to 0.1 W and keeps the sign", () => {
    expect(sanitize(CHARS.GridPower, -1250.06)).toBe(-1250.1);
    expect(sanitize(CHARS.GridPower, 3050.44)).toBe(3050.4);
  });

  it("clamps to the declared range", () => {
    expect(sanitize(CHARS.GridPower, 5_000_000)).toBe(1_000_000);
    expect(sanitize(CHARS.GridPower, -5_000_000)).toBe(-1_000_000);
    expect(sanitize(CHARS.BatterySoc, 104)).toBe(100);
    expect(sanitize(CHARS.PvEnergyTotal, -3)).toBe(0);
  });

  it("rounds energy to Wh resolution and percentages to 0.1", () => {
    expect(sanitize(CHARS.PvEnergyTotal, 1234.56789)).toBe(1234.568);
    expect(sanitize(CHARS.BatterySoc, 55.55)).toBe(55.6);
  });

  it("uses neutral defaults for values EVCC did not report", () => {
    expect(sanitize(CHARS.GridPower, undefined)).toBe(0);
    expect(sanitize(CHARS.GridPower, Number.NaN)).toBe(0);
    expect(sanitize(CHARS.GridPower, null)).toBe(0);
    expect(sanitize(CHARS.BatteryConfigured, undefined)).toBe(false);
    expect(sanitize(CHARS.ChargeMode, undefined)).toBe("");
    expect(sanitize(CHARS.PlanTime, undefined)).toBe(0);
  });

  it("never yields negative zero", () => {
    expect(Object.is(sanitize(CHARS.GridPower, -0.01), 0)).toBe(true);
  });

  it("rounds uint32 values to integers", () => {
    expect(sanitize(CHARS.LastUpdate, 1_900_000_000.7)).toBe(1_900_000_001);
  });

  it("only treats literal true as true", () => {
    expect(sanitize(CHARS.Charging, true)).toBe(true);
    expect(sanitize(CHARS.Charging, 1)).toBe(false);
    expect(sanitize(CHARS.Charging, "true")).toBe(false);
  });

  it("truncates strings to maxLen and drops non-strings", () => {
    expect(sanitize(CHARS.VehicleTitle, "x".repeat(100))).toHaveLength(64);
    expect(sanitize(CHARS.Currency, "TOOLONGCURRENCY")).toBe("TOOLONGC");
    expect(sanitize(CHARS.ChargeMode, 3)).toBe("");
  });

  it("uses three decimals when a float definition declares none", () => {
    const def = { uuid: "x", name: "x", format: "float" } as const;
    expect(sanitize(def, 1.23456)).toBe(1.235);
  });
});

describe("conversions", () => {
  it("toEpochSeconds parses RFC 3339 and rejects junk", () => {
    expect(toEpochSeconds("2030-01-02T06:30:00Z")).toBe(Date.UTC(2030, 0, 2, 6, 30) / 1000);
    expect(toEpochSeconds("2030-01-02T07:30:00+01:00")).toBe(Date.UTC(2030, 0, 2, 6, 30) / 1000);
    expect(toEpochSeconds(null)).toBe(0);
    expect(toEpochSeconds(12)).toBe(0);
    expect(toEpochSeconds("not a date")).toBe(0);
    expect(toEpochSeconds("1960-01-01T00:00:00Z")).toBe(0);
  });

  it("whToKwh and shareToPercent pass undefined through", () => {
    expect(whToKwh(5432)).toBe(5.432);
    expect(whToKwh("5")).toBeUndefined();
    expect(shareToPercent(0.5)).toBe(50);
    expect(shareToPercent(undefined)).toBeUndefined();
  });
});
