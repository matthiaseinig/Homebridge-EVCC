/** One charging session of EVCC's own session log (GET /api/sessions), normalised. */
export interface ChargingSession {
  /** Dedupe key: EVCC's session id, else start time plus loadpoint. */
  key: string;
  /** Start, ms since the epoch. */
  created: number;
  /** End, ms since the epoch; null while the session is running. */
  finished: number | null;
  /** Loadpoint title as EVCC writes it into the session. */
  loadpoint: string;
  vehicle: string;
  chargedKWh: number;
  /** 0 .. 100 */
  solarPercentage: number;
  /** Total cost in the configured currency; null when EVCC has no price. */
  price: number | null;
  pricePerKWh: number | null;
  co2PerKWh: number | null;
  chargeDurationSeconds: number;
  odometer: number | null;
}

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function text(v: unknown): string {
  return typeof v === "string" ? v.slice(0, 128) : "";
}

/** RFC 3339 to ms; null for absent values and Go's zero time (year 1). */
function time(v: unknown): number | null {
  if (typeof v !== "string") return null;
  const ms = Date.parse(v);
  return Number.isFinite(ms) && ms > 0 ? ms : null;
}

/**
 * EVCC serialises `chargeDuration` as a Go duration, that is nanoseconds. A
 * value below 10 million cannot be a sensible nanosecond count (10 ms), so it
 * is taken as seconds, which covers builds that already report seconds.
 */
export function durationSeconds(v: unknown): number {
  const n = num(v);
  if (n === undefined || n <= 0) return 0;
  return n >= 10_000_000 ? Math.round(n / 1e9) : Math.round(n);
}

/** Normalise one raw session; undefined when it has no usable start time. */
export function normalizeSession(raw: unknown): ChargingSession | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;
  const created = time(r.created);
  if (created === null) return undefined;
  const finished = time(r.finished);
  const loadpoint = text(r.loadpoint);
  const id = num(r.id);
  const solar = num(r.solarPercentage) ?? 0;
  return {
    key: id !== undefined ? `id:${id}` : `${created}:${loadpoint}`,
    created,
    finished: finished !== null && finished >= created ? finished : null,
    loadpoint,
    vehicle: text(r.vehicle),
    chargedKWh: Math.max(0, num(r.chargedEnergy) ?? 0),
    solarPercentage: Math.min(100, Math.max(0, solar)),
    price: num(r.price) ?? null,
    pricePerKWh: num(r.pricePerKWh) ?? null,
    co2PerKWh: num(r.co2PerKWh) ?? null,
    chargeDurationSeconds: durationSeconds(r.chargeDuration),
    odometer: num(r.odometer) ?? null,
  };
}

/** Normalise a raw payload; entries that are not sessions are skipped. */
export function normalizeSessions(raw: readonly unknown[]): ChargingSession[] {
  return raw.flatMap((r) => {
    const s = normalizeSession(r);
    return s ? [s] : [];
  });
}

/** Order by start time, then key, so paging cursors are stable. */
export function compareSessions(a: ChargingSession, b: ChargingSession): number {
  return a.created - b.created || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
}
