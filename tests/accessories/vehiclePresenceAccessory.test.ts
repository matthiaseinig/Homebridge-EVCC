import { describe, expect, it } from "vitest";
import { VehiclePresenceAccessory } from "../../src/accessories/vehiclePresenceAccessory.js";
import type { LoadpointState } from "../../src/api/types.js";
import {
  MockPlatformAccessory,
  asPlatformAccessory,
  createMockApi,
  createMockLogger,
} from "../helpers/homebridge.js";

function build(initial = { name: "ev1", title: "EV 1" }) {
  const api = createMockApi();
  const log = createMockLogger();
  const acc = new MockPlatformAccessory("Vehicle", "uuid:v1");
  const v = new VehiclePresenceAccessory({
    api,
    log,
    accessory: asPlatformAccessory(acc),
    vehicle: initial,
  });
  return { acc, v };
}

describe("VehiclePresenceAccessory", () => {
  it("creates an OccupancySensor service", () => {
    const { acc } = build();
    const occ = acc.services.find((s) => s.UUID === "OccupancySensor");
    expect(occ).toBeDefined();
    expect(occ!.subtype).toBe("vehicle-presence");
  });

  it("flips occupancy ON when the vehicle is connected at any loadpoint", () => {
    const { acc, v } = build();
    const lps: LoadpointState[] = [
      { vehicleName: "ev2", connected: true },
      { vehicleName: "ev1", connected: true },
    ];
    v.applyLoadpoints(lps);
    const occ = acc.services.find((s) => s.UUID === "OccupancySensor")!;
    expect(occ.getCharacteristic("OccupancyDetected").value).toBe(1);
  });

  it("stays OFF when the vehicle is mentioned but not connected", () => {
    const { acc, v } = build();
    v.applyLoadpoints([{ vehicleName: "ev1", connected: false }]);
    const occ = acc.services.find((s) => s.UUID === "OccupancySensor")!;
    expect(occ.getCharacteristic("OccupancyDetected").value).toBe(0);
  });

  it("renames the service when applyVehicleUpdate provides a new title", () => {
    const { acc, v } = build();
    v.applyVehicleUpdate({ name: "ev1", title: "Tesla" });
    const occ = acc.services.find((s) => s.UUID === "OccupancySensor")!;
    expect(occ.getCharacteristic("Name").value).toBe("Tesla");
  });

  it("falls back to the slug when no title is set", () => {
    const { acc } = build({ name: "ev1", title: undefined as unknown as string });
    const occ = acc.services.find((s) => s.UUID === "OccupancySensor")!;
    expect(occ.getCharacteristic("Name").value).toBe("ev1");
  });

  it("returns the vehicle name via the public accessor", () => {
    const { v } = build();
    expect(v.name).toBe("ev1");
  });

  it("dispose() is callable", () => {
    const { v } = build();
    expect(() => v.dispose()).not.toThrow();
  });
});
