/**
 * Issue #33: the charge limit must not be a WindowCovering by default, so an
 * Apple Home scene or Siri request such as "close all blinds" can never change
 * the car's charge limit. The app writes the limit through the custom
 * `Charge Limit` characteristic on the Loadpoint Energy service instead.
 */
import { describe, expect, it, vi } from "vitest";
import {
  LoadpointAccessory,
  type LoadpointAccessoryConfig,
} from "../../src/accessories/loadpointAccessory.js";
import type { EvccClient } from "../../src/api/client.js";
import type { LoadpointState } from "../../src/api/types.js";
import { CHARS, SERVICES } from "../../src/energy/definitions.js";
import {
  MockHAPStatus,
  MockPlatformAccessory,
  MockService,
  asPlatformAccessory,
  createMockApi,
  createMockLogger,
} from "../helpers/homebridge.js";

function makeClient(): EvccClient {
  return {
    setLoadpointMode: vi.fn(async () => undefined),
    setLoadpointLimitSoc: vi.fn(async () => undefined),
    setVehicleLimitSoc: vi.fn(async () => undefined),
    setVehiclePlanSoc: vi.fn(async () => undefined),
    deleteVehiclePlanSoc: vi.fn(async () => undefined),
  } as unknown as EvccClient;
}

function build(
  state: LoadpointState,
  cfg: Partial<LoadpointAccessoryConfig> = {},
  existing?: MockPlatformAccessory,
) {
  const log = createMockLogger();
  const client = makeClient();
  const acc = existing ?? new MockPlatformAccessory("LP", "uuid:lp");
  const lp = new LoadpointAccessory({
    api: createMockApi(),
    log,
    client,
    accessory: asPlatformAccessory(acc),
    loadpointId: 0,
    state,
    config: {
      modeUi: "outlet",
      defaultMode: "pv",
      exposeVehicleLimit: false,
      writable: true,
      ...cfg,
    },
    now: () => 1_900_000_000_000,
  });
  return { acc, lp, client, log };
}

/** What Apple Home does for "close all blinds": TargetPosition 0 on every WindowCovering it can see. */
async function closeAllBlinds(acc: MockPlatformAccessory): Promise<number> {
  let written = 0;
  for (const svc of acc.services.filter((s) => s.UUID === "WindowCovering")) {
    const target = svc.getCharacteristic("TargetPosition");
    target.value = 0;
    await target.onSetHandler?.(0);
    written++;
  }
  return written;
}

const coverings = (acc: MockPlatformAccessory) =>
  acc.services.filter((s) => s.UUID === "WindowCovering");
const energySvc = (acc: MockPlatformAccessory) =>
  acc.services.find((s) => s.UUID === SERVICES.LoadpointEnergy.uuid)!;

describe("charge limit is never a window covering by default (issue #33)", () => {
  it("exposes no WindowCovering service, also with the vehicle limit option on", () => {
    expect(coverings(build({ title: "Garage", limitSoc: 80 }).acc)).toEqual([]);
    expect(coverings(build({ title: "Garage" }, { exposeVehicleLimit: true }).acc)).toEqual([]);
  });

  it("a 'close all blinds' scene leaves the loadpoint and vehicle limits unchanged", async () => {
    const { acc, client } = build(
      { title: "Garage", limitSoc: 80, vehicleName: "ev1" },
      { exposeVehicleLimit: true },
    );
    await closeAllBlinds(acc);
    expect(client.setLoadpointLimitSoc).not.toHaveBeenCalled();
    expect(client.setVehicleLimitSoc).not.toHaveBeenCalled();
    expect(energySvc(acc).getCharacteristic(CHARS.ChargeLimit.uuid).value).toBe(80);
  });

  it("removes limit window coverings restored from the Homebridge cache", async () => {
    const acc = new MockPlatformAccessory("LP", "uuid:lp");
    acc.services.push(
      new MockService("WindowCovering", "Garage Charge Limit", "limit-loadpoint"),
      new MockService("WindowCovering", "Garage Vehicle Limit", "limit-vehicle"),
    );
    const { client } = build(
      { title: "Garage", limitSoc: 80, vehicleName: "ev1" },
      { exposeVehicleLimit: true },
      acc,
    );
    expect(coverings(acc)).toEqual([]);
    expect(await closeAllBlinds(acc)).toBe(0);
    expect(client.setLoadpointLimitSoc).not.toHaveBeenCalled();
    expect(client.setVehicleLimitSoc).not.toHaveBeenCalled();
  });

  it("warns that the vehicle limit needs the legacy window covering option", () => {
    const { log } = build({ title: "Garage" }, { exposeVehicleLimit: true });
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining("limitWindowCovering"), "Garage");
  });

  it("keeps the window coverings only behind the legacy option", async () => {
    const { acc, client } = build(
      { title: "Garage", limitSoc: 80, vehicleName: "ev1" },
      { exposeVehicleLimit: true, limitWindowCovering: true },
    );
    expect(
      coverings(acc)
        .map((s) => s.subtype)
        .sort(),
    ).toEqual(["limit-loadpoint", "limit-vehicle"]);
    // With the legacy option, the old (unsafe) behaviour is back on purpose.
    await closeAllBlinds(acc);
    expect(client.setLoadpointLimitSoc).toHaveBeenCalledWith(1, 0);
  });

  it("removes a legacy window covering when the option is switched off again", () => {
    const acc = new MockPlatformAccessory("LP", "uuid:lp");
    build({ title: "Garage" }, { limitWindowCovering: true }, acc);
    expect(coverings(acc)).toHaveLength(1);
    build({ title: "Garage" }, {}, acc);
    expect(coverings(acc)).toEqual([]);
  });
});

describe("Charge Limit characteristic on the Loadpoint Energy service", () => {
  const write = (acc: MockPlatformAccessory, value: unknown) =>
    energySvc(acc).getCharacteristic(CHARS.ChargeLimit.uuid).onSetHandler!(value);
  const status = (code: number) => ({ hapStatus: code });

  it("reads EVCC's limitSoc and follows websocket updates", () => {
    const { acc, lp } = build({ title: "Garage", limitSoc: 80 });
    expect(energySvc(acc).getCharacteristic(CHARS.ChargeLimit.uuid).value).toBe(80);
    lp.applyPartial("limitSoc", 90);
    expect(energySvc(acc).getCharacteristic(CHARS.ChargeLimit.uuid).value).toBe(90);
  });

  it("forwards an integer 0 .. 100 to the loadpoint limitsoc endpoint (1-based id)", async () => {
    const { acc, client } = build({ title: "Garage", limitSoc: 80 });
    for (const soc of [0, 1, 70, 100]) {
      await write(acc, soc);
      expect(client.setLoadpointLimitSoc).toHaveBeenLastCalledWith(1, soc);
    }
  });

  it("rejects anything that is not an integer 0 .. 100 before EVCC is called", async () => {
    const { acc, client } = build({ title: "Garage" });
    for (const bad of [
      -1,
      101,
      70.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      "70",
      true,
      null,
      undefined,
    ]) {
      await expect(write(acc, bad)).rejects.toMatchObject(
        status(MockHAPStatus.INVALID_VALUE_IN_REQUEST),
      );
    }
    expect(client.setLoadpointLimitSoc).not.toHaveBeenCalled();
  });

  it("refuses writes without the admin password or in readonly mode", async () => {
    for (const cfg of [{ writable: false }, { modeUi: "readonly" as const }]) {
      const { acc, client } = build({ title: "Garage" }, cfg);
      await expect(write(acc, 70)).rejects.toMatchObject(
        status(MockHAPStatus.INSUFFICIENT_PRIVILEGES),
      );
      expect(client.setLoadpointLimitSoc).not.toHaveBeenCalled();
    }
  });

  it("returns a communication failure when EVCC rejects the write", async () => {
    const { acc, client, log } = build({ title: "Garage" });
    (client.setLoadpointLimitSoc as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("ouch"),
    );
    await expect(write(acc, 70)).rejects.toMatchObject(
      status(MockHAPStatus.SERVICE_COMMUNICATION_FAILURE),
    );
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining("limitSoc"), 1, 70, "ouch");
  });
});
