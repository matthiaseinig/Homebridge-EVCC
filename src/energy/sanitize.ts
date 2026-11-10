import type { CharDef, RawValue } from "./definitions.js";

/**
 * Coerce a raw EVCC value into something HAP accepts for `def` without
 * warnings: numbers are rounded to the declared decimals and clamped to the
 * declared range, strings are truncated to `maxLen`. A value EVCC did not
 * report becomes the neutral default (0, false or ""), as documented in the
 * contract.
 */
export function sanitize(def: CharDef, raw: RawValue): number | string | boolean {
  switch (def.format) {
    case "bool":
      return raw === true;
    case "string": {
      const s = typeof raw === "string" ? raw : "";
      return s.slice(0, def.maxLen ?? 64);
    }
    case "uint32":
    case "float": {
      const n = typeof raw === "number" && Number.isFinite(raw) ? raw : 0;
      const decimals = def.format === "uint32" ? 0 : (def.decimals ?? 3);
      const factor = 10 ** decimals;
      const rounded = Math.round(n * factor) / factor;
      const min = def.min ?? Number.NEGATIVE_INFINITY;
      const max = def.max ?? Number.POSITIVE_INFINITY;
      // `+ 0` folds a negative zero produced by rounding into a plain 0.
      return Math.min(max, Math.max(min, rounded)) + 0;
    }
  }
}

/** Parse an RFC 3339 timestamp into whole seconds since the epoch; 0 when absent or invalid. */
export function toEpochSeconds(value: unknown): number {
  if (typeof value !== "string" || value === "") return 0;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  return Math.floor(ms / 1000);
}

/** Watt-hours to kilowatt-hours; undefined stays undefined. */
export function whToKwh(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value / 1000 : undefined;
}

/** A 0..1 share to percent; undefined stays undefined. */
export function shareToPercent(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value * 100 : undefined;
}

export function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function str(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function bool(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}
