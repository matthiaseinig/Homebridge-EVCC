/**
 * Renders the tables of docs/app-contract.md from src/energy/definitions.ts.
 * The contract test compares the document with this rendering row by row, so
 * any drift in UUID, name, format, unit, range, resolution, sign note, source
 * or service membership fails the build.
 */
import {
  CHARGING_SERVICE_KEYS,
  CHARS,
  SERVICES,
  SITE_SERVICE_KEYS,
  type CharDef,
  type CharKey,
} from "../../src/energy/definitions.js";

export const CONTROL_TAG_KEYS: readonly CharKey[] = ["ControlRole", "ControlEnabled"];

const fmtNumber = (n: number): string => n.toLocaleString("en-US").replace(/,/g, " ");

function range(c: CharDef): string {
  if (c.format === "bool") return "true / false";
  if (c.format === "string") return `max ${c.maxLen ?? 64} chars`;
  return `${fmtNumber(c.min ?? 0)} .. ${fmtNumber(c.max ?? 0)}`;
}

function resolution(c: CharDef): string {
  if (c.format === "uint32") return "1";
  if (c.format !== "float") return "";
  const decimals = c.decimals ?? 3;
  return decimals > 0 ? String(10 ** -decimals) : "1";
}

export function charRow(key: CharKey): string {
  const c: CharDef = CHARS[key];
  const access = c.writable ? "read, write, notify" : "read, notify";
  return `| ${c.name} (\`${key}\`) | \`${c.uuid}\` | ${c.format} | ${access} | ${c.unit ?? ""} | ${range(c)} | ${resolution(c)} | ${c.sign ?? ""} | ${c.source} |`;
}

const CHAR_HEADER = [
  "| Characteristic | UUID | Format | Access | Unit | Range | Resolution | Sign or domain | EVCC source |",
  "|---|---|---|---|---|---|---|---|---|",
];

export function serviceBlock(key: keyof typeof SERVICES): string {
  const s = SERVICES[key];
  return [`### ${s.name} (\`${key}\`)`, "", ...CHAR_HEADER, ...s.chars.map(charRow)].join("\n");
}

export function controlTagBlock(): string {
  return ["### Control tags", "", ...CHAR_HEADER, ...CONTROL_TAG_KEYS.map(charRow)].join("\n");
}

export function serviceTable(): string {
  const row = (key: keyof typeof SERVICES, group: string): string =>
    `| ${SERVICES[key].name} (\`${key}\`) | \`${SERVICES[key].uuid}\` | ${group} |`;
  return [
    "| Service | UUID | Section |",
    "|---|---|---|",
    ...SITE_SERVICE_KEYS.map((k) => row(k, "site energy")),
    ...CHARGING_SERVICE_KEYS.map((k) => row(k, "charging")),
  ].join("\n");
}

/** Every generated block, in document order. */
export function allBlocks(): string[] {
  return [
    serviceTable(),
    ...SITE_SERVICE_KEYS.map(serviceBlock),
    ...CHARGING_SERVICE_KEYS.map(serviceBlock),
    controlTagBlock(),
  ];
}
