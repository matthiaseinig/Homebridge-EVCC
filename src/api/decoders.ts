import type { EvccState, LoadpointState, WebSocketUpdate } from "./types.js";

/**
 * Walk a dotted key path on `state` and return the array of segments. Numeric
 * segments are coerced to numbers so consumers can branch on array vs object.
 */
export function splitPath(key: string): Array<string | number> {
  return key.split(".").map((s) => (/^\d+$/.test(s) ? Number(s) : s));
}

/**
 * Apply a single websocket diff to the in-memory state cache. Mutates `state`
 * and returns the loadpoint indexes affected (for change-notification fanout).
 *
 * Supports three message shapes EVCC actually emits:
 *  - top-level value:    {"pvPower": 1234}                        → state.pvPower = 1234
 *  - nested loadpoint:   {"loadpoints.0.chargePower": 1234}        → state.loadpoints[0].chargePower = 1234
 *  - whole loadpoint:    {"loadpoints.0": {...}}                   → state.loadpoints[0] = {...}
 *  - whole loadpoints:   {"loadpoints": [...]}                     → state.loadpoints = [...]
 */
export function applyUpdate(state: EvccState, update: WebSocketUpdate): Set<number> {
  const path = splitPath(update.key);
  const touched = new Set<number>();
  if (path.length === 0) return touched;

  // Track the loadpoint(s) impacted, if any.
  if (path[0] === "loadpoints") {
    if (path.length === 1 && Array.isArray(update.value)) {
      for (let i = 0; i < update.value.length; i++) touched.add(i);
    } else if (typeof path[1] === "number") {
      touched.add(path[1]);
    }
  }

  // Walk-and-set. Create intermediate containers as needed.
  let cursor: Record<string | number, unknown> = state as unknown as Record<
    string | number,
    unknown
  >;
  for (let i = 0; i < path.length - 1; i++) {
    const seg = path[i];
    const next = path[i + 1];
    let child = cursor[seg];
    if (child === undefined || child === null) {
      child = typeof next === "number" ? [] : {};
      cursor[seg] = child;
    }
    cursor = child as Record<string | number, unknown>;
  }
  cursor[path[path.length - 1]] = update.value;
  return touched;
}

/**
 * Parse a raw websocket frame. EVCC sends `{ key: value }` objects (one or
 * more keys per frame). Returns an array of normalized updates. Malformed
 * frames return an empty array — callers should log and ignore.
 */
export function parseFrame(raw: string | Buffer): WebSocketUpdate[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(typeof raw === "string" ? raw : raw.toString("utf-8"));
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return [];
  const obj = parsed as Record<string, unknown>;
  return Object.entries(obj).map(([key, value]) => ({ key, value }));
}

/** Narrow an unknown into a LoadpointState[] (best-effort, never throws). */
export function asLoadpointArray(v: unknown): LoadpointState[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is LoadpointState => !!x && typeof x === "object");
}
