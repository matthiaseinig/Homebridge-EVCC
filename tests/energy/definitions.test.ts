import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CHARS, SERVICES, UUID_SUFFIX } from "../../src/energy/definitions.js";

const UUID_RE = /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/;
const contract = readFileSync(join(__dirname, "../../docs/zuhause-contract.md"), "utf-8");

describe("energy definitions", () => {
  const all = [...Object.values(CHARS), ...Object.values(SERVICES)].map((d) => d.uuid as string);

  it("uses well-formed, unique, upper-case UUIDs with the shared suffix", () => {
    for (const uuid of all) {
      expect(uuid).toMatch(UUID_RE);
      expect(uuid.endsWith(UUID_SUFFIX)).toBe(true);
    }
    expect(new Set(all).size).toBe(all.length);
  });

  it("separates characteristic and service UUID prefixes", () => {
    for (const c of Object.values(CHARS)) expect(c.uuid.startsWith("E5C0")).toBe(true);
    for (const s of Object.values(SERVICES)) expect(s.uuid.startsWith("E5C1")).toBe(true);
  });

  it("lists each characteristic at most once per service", () => {
    for (const s of Object.values(SERVICES)) {
      expect(new Set(s.chars).size).toBe(s.chars.length);
    }
  });

  it("uses every characteristic in at least one service", () => {
    const used = new Set(Object.values(SERVICES).flatMap((s) => [...s.chars]));
    expect(Object.keys(CHARS).filter((k) => !used.has(k as keyof typeof CHARS))).toEqual([]);
  });

  it("documents every UUID together with its name in docs/zuhause-contract.md", () => {
    for (const [key, c] of Object.entries(CHARS)) {
      expect(contract, key).toContain(`| ${c.name} (\`${key}\`) | \`${c.uuid}\``);
    }
    for (const s of Object.values(SERVICES)) {
      expect(contract, s.name).toContain(`| ${s.name} | \`${s.uuid}\``);
    }
  });

  it("keeps the contract free of em and en dashes", () => {
    expect(contract).not.toMatch(new RegExp("[\\u2013\\u2014]"));
  });
});
