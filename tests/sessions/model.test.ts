import { describe, expect, it } from "vitest";
import {
  compareSessions,
  durationSeconds,
  normalizeSession,
  normalizeSessions,
} from "../../src/sessions/model.js";
import { rawSession } from "./fixtures.js";

describe("normalizeSession", () => {
  it("maps an EVCC session", () => {
    expect(normalizeSession(rawSession())).toEqual({
      key: "id:1",
      created: Date.parse("2026-03-10T08:00:00Z"),
      finished: Date.parse("2026-03-10T10:00:00Z"),
      loadpoint: "Garage",
      vehicle: "Car A",
      chargedKWh: 10,
      solarPercentage: 50,
      price: 2.5,
      pricePerKWh: 0.25,
      co2PerKWh: 120,
      chargeDurationSeconds: 7200,
      odometer: 12000.5,
    });
  });

  it("falls back to start time and loadpoint as key without an id", () => {
    const s = normalizeSession(rawSession({ id: undefined }));
    expect(s?.key).toBe(`${Date.parse("2026-03-10T08:00:00Z")}:Garage`);
  });

  it("treats Go's zero time and an end before the start as running", () => {
    expect(normalizeSession(rawSession({ finished: "0001-01-01T00:00:00Z" }))?.finished).toBeNull();
    expect(normalizeSession(rawSession({ finished: "2026-03-10T07:00:00Z" }))?.finished).toBeNull();
    expect(normalizeSession(rawSession({ finished: undefined }))?.finished).toBeNull();
  });

  it("clamps and defaults odd values", () => {
    const s = normalizeSession(
      rawSession({
        chargedEnergy: -3,
        solarPercentage: 140,
        price: null,
        pricePerKWh: "x",
        co2PerKWh: undefined,
        odometer: null,
        vehicle: 5,
        loadpoint: "L".repeat(300),
      }),
    );
    expect(s).toMatchObject({
      chargedKWh: 0,
      solarPercentage: 100,
      price: null,
      pricePerKWh: null,
      co2PerKWh: null,
      odometer: null,
      vehicle: "",
    });
    expect(s?.loadpoint).toHaveLength(128);
    expect(normalizeSession(rawSession({ solarPercentage: -1 }))?.solarPercentage).toBe(0);
    expect(normalizeSession(rawSession({ solarPercentage: undefined }))?.solarPercentage).toBe(0);
  });

  it("rejects entries without a usable start", () => {
    expect(normalizeSession(null)).toBeUndefined();
    expect(normalizeSession([])).toBeUndefined();
    expect(normalizeSession("x")).toBeUndefined();
    expect(normalizeSession(rawSession({ created: "nope" }))).toBeUndefined();
    expect(normalizeSession(rawSession({ created: 5 }))).toBeUndefined();
    expect(normalizeSessions([rawSession(), null, rawSession({ created: "" })])).toHaveLength(1);
  });
});

describe("durationSeconds", () => {
  it("converts nanoseconds and accepts seconds", () => {
    expect(durationSeconds(5_400_000_000_000)).toBe(5400);
    expect(durationSeconds(5400)).toBe(5400);
    expect(durationSeconds(0)).toBe(0);
    expect(durationSeconds(-5)).toBe(0);
    expect(durationSeconds("5")).toBe(0);
    expect(durationSeconds(undefined)).toBe(0);
  });
});

describe("compareSessions", () => {
  it("orders by start, then key", () => {
    const a = normalizeSession(rawSession({ id: 1 }))!;
    const b = normalizeSession(rawSession({ id: 2 }))!;
    const c = normalizeSession(rawSession({ id: 3, created: "2026-03-11T08:00:00Z" }))!;
    expect([c, b, a].sort(compareSessions).map((s) => s.key)).toEqual(["id:1", "id:2", "id:3"]);
    expect(compareSessions(a, a)).toBe(0);
    expect(compareSessions(b, a)).toBe(1);
  });
});
