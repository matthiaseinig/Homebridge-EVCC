import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CHARGING_SERVICE_KEYS,
  CHARS,
  CONTROL_ROLES,
  SERVICES,
  SITE_SERVICE_KEYS,
  UUID_SUFFIX,
  type CharKey,
} from "../../src/energy/definitions.js";
import { CONTROL_TAG_KEYS, allBlocks } from "./contractTable.js";

const UUID_RE = /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/;
const FULL_UUID_IN_LINE = /E5C[01][0-9A-F]{4}-8B93-4652-90CD-F02EAF5356EA/;
const contractPath = join(__dirname, "../../docs/app-contract.md");

/** Lines of `text` that contain one of this plugin's full UUIDs. */
function uuidLines(text: string): string[] {
  return text.split("\n").filter((l) => FULL_UUID_IN_LINE.test(l));
}

/** The contract check, exported for the mutation tests below. */
export function contractProblems(doc: string): string[] {
  const problems: string[] = [];
  for (const block of allBlocks()) {
    if (!doc.includes(block)) problems.push(`missing or different block:\n${block}`);
  }
  const expected = new Set(allBlocks().flatMap(uuidLines));
  for (const line of uuidLines(doc)) {
    if (!expected.has(line)) problems.push(`stale or unexpected row: ${line}`);
  }
  return problems;
}

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

  it("assigns every service to exactly one contract section", () => {
    const sections = [...SITE_SERVICE_KEYS, ...CHARGING_SERVICE_KEYS];
    expect([...sections].sort()).toEqual(Object.keys(SERVICES).sort());
  });

  it("makes only Charge Mode, Set Plan and Charge Limit writable", () => {
    const writable = (Object.keys(CHARS) as CharKey[]).filter(
      (k) => (CHARS[k] as { writable?: boolean }).writable,
    );
    expect(writable.sort()).toEqual(["ChargeLimit", "ChargeMode", "SetPlan"]);
  });

  it("lists each characteristic at most once per service", () => {
    for (const s of Object.values(SERVICES)) {
      expect(new Set(s.chars).size).toBe(s.chars.length);
    }
  });

  it("uses every characteristic in a service or as a control tag", () => {
    const used = new Set<CharKey>([
      ...Object.values(SERVICES).flatMap((s) => [...s.chars]),
      ...CONTROL_TAG_KEYS,
    ]);
    expect((Object.keys(CHARS) as CharKey[]).filter((k) => !used.has(k))).toEqual([]);
  });

  it("documents every control role value", () => {
    const doc = readFileSync(contractPath, "utf-8");
    for (const role of Object.values(CONTROL_ROLES)) expect(doc).toContain(`\`${role}\``);
  });

  it("matches docs/app-contract.md row by row (no missing, different or stale rows)", () => {
    expect(contractProblems(readFileSync(contractPath, "utf-8"))).toEqual([]);
  });

  it("detects a changed unit in a row", () => {
    const doc = readFileSync(contractPath, "utf-8").replace(
      `| \`${CHARS.ChargePower.uuid}\` | float | read, notify | W |`,
      `| \`${CHARS.ChargePower.uuid}\` | float | read, notify | kW |`,
    );
    expect(contractProblems(doc).length).toBeGreaterThan(0);
  });

  it("detects a stale row for a characteristic that is not defined", () => {
    const stale =
      "| Old Thing (`OldThing`) | `E5C000FF-8B93-4652-90CD-F02EAF5356EA` | float | read, notify | W | x | x | x | x |";
    const doc = readFileSync(contractPath, "utf-8") + "\n" + stale + "\n";
    expect(contractProblems(doc)).toEqual([`stale or unexpected row: ${stale}`]);
  });

  it("keeps the contract free of em and en dashes", () => {
    expect(readFileSync(contractPath, "utf-8")).not.toMatch(new RegExp("[\\u2013\\u2014]"));
  });
});
