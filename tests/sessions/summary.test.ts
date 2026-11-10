import { describe, expect, it } from "vitest";
import { normalizeSessions } from "../../src/sessions/model.js";
import {
  bucketKey,
  loadpointSummary,
  localDay,
  solarShare,
  startOfLocalDay,
  startOfLocalMonth,
  summarize,
} from "../../src/sessions/summary.js";
import { rawSession } from "./fixtures.js";

const local = (y: number, m: number, d: number, h = 12): string =>
  new Date(y, m - 1, d, h).toISOString();

const sessions = normalizeSessions([
  rawSession({
    id: 1,
    created: local(2025, 12, 30),
    finished: local(2025, 12, 30, 14),
    chargedEnergy: 20,
    solarPercentage: 100,
    price: 4,
  }),
  rawSession({
    id: 2,
    created: local(2026, 3, 2),
    finished: local(2026, 3, 2, 14),
    chargedEnergy: 10,
    solarPercentage: 0,
    price: 3,
  }),
  rawSession({
    id: 3,
    created: local(2026, 3, 10, 8),
    finished: local(2026, 3, 10, 10),
    chargedEnergy: 30,
    solarPercentage: 100,
    price: null,
  }),
  rawSession({
    id: 4,
    created: local(2026, 3, 10, 18),
    finished: null,
    chargedEnergy: 5,
    solarPercentage: 40,
    price: 1,
  }),
]);

describe("summarize", () => {
  it("groups by month in local time", () => {
    const months = summarize(sessions, "month");
    expect(months.map((m) => m.period)).toEqual(["2025-12", "2026-03"]);
    expect(months[1]).toMatchObject({
      sessions: 3,
      chargedKWh: 45,
      cost: 4,
      avgPricePerKWh: 0.2667,
      chargeDurationSeconds: 21600,
    });
    expect(months[1].solarPercentage).toBe(71.1);
  });

  it("groups by year and reports no cost without prices", () => {
    const years = summarize(sessions, "year");
    expect(years.map((y) => y.period)).toEqual(["2025", "2026"]);
    const unpriced = summarize(normalizeSessions([rawSession({ price: null })]), "year")[0];
    expect(unpriced).toMatchObject({ cost: null, avgPricePerKWh: null });
    expect(summarize([], "month")).toEqual([]);
  });
});

describe("helpers", () => {
  it("computes keys and local boundaries", () => {
    const t = new Date(2026, 2, 10, 15, 30).getTime();
    expect(bucketKey(t, "month")).toBe("2026-03");
    expect(bucketKey(t, "year")).toBe("2026");
    expect(localDay(t)).toBe("2026-03-10");
    expect(startOfLocalDay(t)).toBe(new Date(2026, 2, 10).getTime());
    expect(startOfLocalMonth(t)).toBe(new Date(2026, 2, 1).getTime());
  });

  it("weights the solar share by energy", () => {
    expect(solarShare([])).toBe(0);
    expect(solarShare(normalizeSessions([rawSession({ chargedEnergy: 0 })]))).toBe(0);
    expect(solarShare(sessions.slice(1, 3))).toBe(75);
  });
});

describe("loadpointSummary", () => {
  const now = new Date(2026, 2, 10, 20).getTime();

  it("summarises today, this month and the last finished session", () => {
    expect(loadpointSummary(sessions, now)).toEqual({
      todayKWh: 35,
      monthKWh: 45,
      monthSolarPercentage: (32 / 45) * 100,
      lastSessionKWh: 30,
      lastSessionEnd: Math.floor(new Date(2026, 2, 10, 10).getTime() / 1000),
    });
  });

  it("is all zero without sessions or finished sessions", () => {
    expect(loadpointSummary([], now)).toEqual({
      todayKWh: 0,
      monthKWh: 0,
      monthSolarPercentage: 0,
      lastSessionKWh: 0,
      lastSessionEnd: 0,
    });
    expect(loadpointSummary(sessions.slice(3), now).lastSessionEnd).toBe(0);
  });

  it("rolls over at local midnight", () => {
    const nextDay = new Date(2026, 2, 11, 0, 5).getTime();
    expect(loadpointSummary(sessions, nextDay).todayKWh).toBe(0);
    expect(loadpointSummary(sessions, nextDay).monthKWh).toBe(45);
  });
});
