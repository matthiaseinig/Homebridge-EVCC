import { describe, expect, it } from "vitest";
import { parseChargeMode, parsePlanRequest, toRfc3339 } from "../../src/energy/writeValidation.js";

const NOW = 1_900_000_000;

describe("parseChargeMode", () => {
  it("accepts exactly the four EVCC modes", () => {
    for (const m of ["off", "now", "minpv", "pv"]) expect(parseChargeMode(m)).toBe(m);
    for (const bad of ["Off", "smart", " pv", "", 0, undefined, null, {}]) {
      expect(parseChargeMode(bad)).toBeUndefined();
    }
  });
});

describe("parsePlanRequest", () => {
  it("clears with an empty string or 0", () => {
    expect(parsePlanRequest("", NOW)).toEqual({ kind: "clear" });
    expect(parsePlanRequest("0", NOW)).toEqual({ kind: "clear" });
  });

  it("parses soc and a future time", () => {
    expect(parsePlanRequest(`80,${NOW + 1}`, NOW)).toEqual({ kind: "set", soc: 80, time: NOW + 1 });
    expect(parsePlanRequest(`1,${NOW + 1}`, NOW)).toMatchObject({ soc: 1 });
    expect(parsePlanRequest(`100,${NOW + 1}`, NOW)).toMatchObject({ soc: 100 });
  });

  it("rejects everything else", () => {
    for (const bad of [
      `0,${NOW + 1}`,
      `101,${NOW + 1}`,
      `80,${NOW}`,
      "80,4294967296",
      "80,",
      ",123",
      "80,1e10",
      "0x50,1900000001",
      `80 ,${NOW + 1}`,
      "00",
      0,
      null,
      undefined,
    ]) {
      expect(parsePlanRequest(bad, NOW), String(bad)).toBeUndefined();
    }
  });
});

describe("toRfc3339", () => {
  it("formats UTC without fractional seconds", () => {
    expect(toRfc3339(Date.UTC(2030, 0, 2, 6, 30) / 1000)).toBe("2030-01-02T06:30:00Z");
  });
});
