import { describe, expect, it } from "vitest";
import {
  applyUpdate,
  asLoadpointArray,
  parseFrame,
  splitPath,
} from "../../src/api/decoders.js";
import type { EvccState } from "../../src/api/types.js";

describe("splitPath", () => {
  it("splits on dots and coerces numeric segments", () => {
    expect(splitPath("loadpoints.0.chargePower")).toEqual(["loadpoints", 0, "chargePower"]);
    expect(splitPath("pvPower")).toEqual(["pvPower"]);
    expect(splitPath("a.b.10")).toEqual(["a", "b", 10]);
  });
});

describe("applyUpdate", () => {
  it("sets a top-level key", () => {
    const state = {} as EvccState;
    const touched = applyUpdate(state, { key: "pvPower", value: 1234 });
    expect((state as Record<string, unknown>).pvPower).toBe(1234);
    expect(touched.size).toBe(0);
  });

  it("creates nested arrays/objects on the fly", () => {
    const state = {} as EvccState;
    applyUpdate(state, { key: "loadpoints.2.chargePower", value: 7000 });
    expect(state.loadpoints?.[2]?.chargePower).toBe(7000);
  });

  it("reports touched loadpoint indexes for nested updates", () => {
    const state = {} as EvccState;
    const touched = applyUpdate(state, { key: "loadpoints.1.connected", value: true });
    expect([...touched]).toEqual([1]);
  });

  it("reports all loadpoints when the array is wholesale-replaced", () => {
    const state = {} as EvccState;
    const touched = applyUpdate(state, {
      key: "loadpoints",
      value: [{ chargePower: 0 }, { chargePower: 1 }, { chargePower: 2 }],
    });
    expect([...touched].sort()).toEqual([0, 1, 2]);
  });

  it("returns an empty set on an empty path", () => {
    const state = {} as EvccState;
    expect(applyUpdate(state, { key: "", value: 1 }).size).toBe(0);
  });

  it("preserves nullish nested holes by overwriting them", () => {
    const state = { loadpoints: [null] } as unknown as EvccState;
    applyUpdate(state, { key: "loadpoints.0.chargePower", value: 99 });
    expect(state.loadpoints?.[0]?.chargePower).toBe(99);
  });
});

describe("parseFrame", () => {
  it("parses a JSON object into one update per key", () => {
    const updates = parseFrame('{"a":1,"b":2}');
    expect(updates).toEqual([
      { key: "a", value: 1 },
      { key: "b", value: 2 },
    ]);
  });

  it("accepts a Buffer", () => {
    const updates = parseFrame(Buffer.from('{"x":42}'));
    expect(updates).toEqual([{ key: "x", value: 42 }]);
  });

  it("returns [] on malformed JSON", () => {
    expect(parseFrame("not-json")).toEqual([]);
  });

  it("returns [] on JSON arrays / primitives", () => {
    expect(parseFrame("[1,2,3]")).toEqual([]);
    expect(parseFrame("null")).toEqual([]);
    expect(parseFrame("42")).toEqual([]);
  });
});

describe("asLoadpointArray", () => {
  it("returns [] for non-arrays", () => {
    expect(asLoadpointArray(undefined)).toEqual([]);
    expect(asLoadpointArray("nope")).toEqual([]);
  });

  it("filters out null/non-object items", () => {
    expect(asLoadpointArray([null, { a: 1 }, "skip", { b: 2 }])).toEqual([{ a: 1 }, { b: 2 }]);
  });
});
