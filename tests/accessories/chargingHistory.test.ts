import { describe, expect, it } from "vitest";
import {
  LoadpointAccessory,
  type LoadpointAccessoryConfig,
} from "../../src/accessories/loadpointAccessory.js";
import type { EvccClient } from "../../src/api/client.js";
import { CHARS, SERVICES } from "../../src/energy/definitions.js";
import type { LoadpointSummary } from "../../src/sessions/summary.js";
import {
  MockPlatformAccessory,
  MockService,
  asPlatformAccessory,
  createMockApi,
  createMockLogger,
} from "../helpers/homebridge.js";

const SUMMARY: LoadpointSummary = {
  todayKWh: 12.3456,
  monthKWh: 150.5,
  monthSolarPercentage: 61.234,
  lastSessionKWh: 8.2,
  lastSessionEnd: 1_800_000_000,
};

function build(cfg: Partial<LoadpointAccessoryConfig> = {}, existing?: MockPlatformAccessory) {
  const acc = existing ?? new MockPlatformAccessory("LP", "uuid:lp");
  const lp = new LoadpointAccessory({
    api: createMockApi(),
    log: createMockLogger(),
    client: {} as unknown as EvccClient,
    accessory: asPlatformAccessory(acc),
    loadpointId: 0,
    state: { title: "Garage" },
    config: {
      modeUi: "outlet",
      defaultMode: "pv",
      exposeVehicleLimit: false,
      writable: false,
      ...cfg,
    },
  });
  return { acc, lp };
}

const history = (acc: MockPlatformAccessory) =>
  acc.services.find((s) => s.UUID === SERVICES.ChargingHistory.uuid);

describe("Charging History service", () => {
  it("is added with the summary values (rounded to the contract resolution)", () => {
    const { acc, lp } = build({ sessions: true });
    expect(lp.loadpointTitle()).toBe("Garage");
    lp.applySessions(SUMMARY, 1_800_000_100);
    const svc = history(acc)!;
    expect(svc.subtype).toBe("charging-history");
    const v = (k: keyof typeof CHARS) => svc.charMap.get(CHARS[k].uuid)?.value;
    expect(v("ChargedToday")).toBe(12.346);
    expect(v("ChargedMonth")).toBe(150.5);
    expect(v("SolarShareMonth")).toBe(61.2);
    expect(v("LastSessionEnergy")).toBe(8.2);
    expect(v("LastSessionEnd")).toBe(1_800_000_000);
    expect(v("SessionsUpdated")).toBe(1_800_000_100);
  });

  it("carries every declared characteristic with read and notify only", () => {
    const { acc, lp } = build({ sessions: true });
    lp.applySessions(SUMMARY, 0);
    const svc = history(acc)!;
    for (const k of SERVICES.ChargingHistory.chars) {
      const c = svc.charMap.get(CHARS[k].uuid);
      expect(c, k).toBeDefined();
      expect((c!.props as { perms: string[] }).perms).toEqual(["pr", "ev"]);
    }
    expect(CHARS.ChargedToday.uuid.startsWith("E5C0")).toBe(true);
    expect(SERVICES.ChargingHistory.uuid.startsWith("E5C1")).toBe(true);
  });

  it("is absent unless sessions are enabled and removes a cached copy", () => {
    const off = build({});
    off.lp.applySessions(SUMMARY, 1);
    expect(history(off.acc)).toBeUndefined();

    const cached = new MockPlatformAccessory("LP", "uuid:lp");
    cached.services.push(new MockService(SERVICES.ChargingHistory.uuid, "x", "charging-history"));
    build({ sessions: false }, cached);
    expect(history(cached)).toBeUndefined();
  });

  it("is absent and removed when the energy characteristics are hidden", () => {
    const cached = new MockPlatformAccessory("LP", "uuid:lp");
    cached.services.push(new MockService(SERVICES.ChargingHistory.uuid, "x", "charging-history"));
    const { lp } = build({ sessions: true, energy: false }, cached);
    lp.applySessions(SUMMARY, 1);
    expect(history(cached)).toBeUndefined();
  });

  it("updates in place on the next summary", () => {
    const { acc, lp } = build({ sessions: true });
    lp.applySessions(SUMMARY, 1);
    lp.applySessions({ ...SUMMARY, todayKWh: 20 }, 2);
    expect(acc.services.filter((s) => s.UUID === SERVICES.ChargingHistory.uuid)).toHaveLength(1);
    expect(history(acc)!.charMap.get(CHARS.ChargedToday.uuid)?.value).toBe(20);
  });
});
