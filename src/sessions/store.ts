import { chmod, readFile } from "node:fs/promises";
import { join } from "node:path";
import { backupAside, FILE_MODE, writeFileAtomic } from "./fsutil.js";
import { compareSessions, normalizeSession, type ChargingSession } from "./model.js";

export const STORE_FILE = "evcc-sessions.json";
const SCHEMA = 1;

export interface TimeRange {
  /** Inclusive, ms since the epoch. */
  fromMs?: number;
  /** Exclusive, ms since the epoch. */
  toMs?: number;
}

export interface SessionPage {
  sessions: ChargingSession[];
  /** Cursor of the first session of the next page, null on the last page. */
  next: string | null;
}

interface StoreFile {
  schema: number;
  currency: string;
  lastUpdate: number | null;
  sessions: ChargingSession[];
}

/**
 * Session log kept in the Homebridge storage folder as one JSON file (0600,
 * written atomically). Bounded: the oldest sessions are dropped beyond
 * `maxSessions`. An unreadable file is moved aside, never overwritten.
 */
export class SessionStore {
  private readonly file: string;
  private byKey = new Map<string, ChargingSession>();
  private sorted: ChargingSession[] = [];
  private currencyCode = "";
  private updatedAt: number | null = null;
  private lastSaved = "";
  private writing: Promise<void> = Promise.resolve();
  /** Short note about the last failed fetch; not persisted. */
  lastError: string | null = null;

  constructor(
    dir: string,
    private readonly maxSessions: number,
  ) {
    this.file = join(dir, STORE_FILE);
  }

  get count(): number {
    return this.sorted.length;
  }

  get currency(): string {
    return this.currencyCode;
  }

  /** ms of the last successful fetch, null before the first one. */
  get lastUpdate(): number | null {
    return this.updatedAt;
  }

  async load(nowMs: number = Date.now()): Promise<{ backup?: string }> {
    let text: string;
    try {
      text = await readFile(this.file, "utf8");
    } catch {
      return {};
    }
    try {
      const data = JSON.parse(text) as Partial<StoreFile>;
      if (data.schema !== SCHEMA || !Array.isArray(data.sessions)) throw new Error("schema");
      await chmod(this.file, FILE_MODE);
      this.replace(
        data.sessions.flatMap((s) => {
          const n = normalizeStored(s);
          return n ? [n] : [];
        }),
      );
      this.currencyCode = typeof data.currency === "string" ? data.currency.slice(0, 8) : "";
      this.updatedAt = typeof data.lastUpdate === "number" ? data.lastUpdate : null;
      this.lastSaved = this.serialize();
      return {};
    } catch {
      return { backup: await backupAside(this.file, nowMs) };
    }
  }

  /** Merge fetched sessions (newer data wins per key), prune and persist. */
  async update(
    fetched: readonly ChargingSession[],
    currency: string,
    nowMs: number,
  ): Promise<void> {
    const merged = new Map(this.byKey);
    for (const s of fetched) merged.set(s.key, s);
    this.replace([...merged.values()]);
    if (currency) this.currencyCode = currency.slice(0, 8);
    this.updatedAt = nowMs;
    this.lastError = null;
    await this.save();
  }

  private replace(list: readonly ChargingSession[]): void {
    const sorted = [...list].sort(compareSessions);
    const kept = sorted.length > this.maxSessions ? sorted.slice(-this.maxSessions) : sorted;
    this.sorted = kept;
    this.byKey = new Map(kept.map((s) => [s.key, s]));
  }

  private serialize(): string {
    const body: StoreFile = {
      schema: SCHEMA,
      currency: this.currencyCode,
      lastUpdate: this.updatedAt,
      sessions: this.sorted,
    };
    return JSON.stringify(body);
  }

  /** Persist when something changed; writes never overlap. */
  save(): Promise<void> {
    const next = this.writing.then(async () => {
      const data = this.serialize();
      if (data === this.lastSaved) return;
      await writeFileAtomic(this.file, data);
      this.lastSaved = data;
    });
    this.writing = next.catch(() => undefined);
    return next;
  }

  /** Sessions in `range`, oldest first. */
  list(range: TimeRange = {}): ChargingSession[] {
    return this.sorted.filter(
      (s) =>
        (range.fromMs === undefined || s.created >= range.fromMs) &&
        (range.toMs === undefined || s.created < range.toMs),
    );
  }

  /** Sessions of one loadpoint (EVCC title), oldest first. */
  forLoadpoint(title: string): ChargingSession[] {
    return this.sorted.filter((s) => s.loadpoint === title);
  }

  /** One page of `list(range)`, starting at `cursor` (from a previous page's `next`). */
  page(range: TimeRange, cursor: string | undefined, limit: number): SessionPage {
    const all = this.list(range);
    const start = cursor === undefined ? 0 : all.findIndex((s) => compareCursor(s, cursor) >= 0);
    if (start < 0) return { sessions: [], next: null };
    const sessions = all.slice(start, start + limit);
    const after = all[start + limit];
    return { sessions, next: after ? cursorOf(after) : null };
  }
}

export function cursorOf(s: ChargingSession): string {
  return `${s.created}.${s.key}`;
}

/** Parse a cursor into start time and key; undefined when malformed. */
export function parseCursor(cursor: string): { created: number; key: string } | undefined {
  const m = /^(\d{1,15})\.(.{1,160})$/.exec(cursor);
  return m ? { created: Number(m[1]), key: m[2] } : undefined;
}

function compareCursor(s: ChargingSession, cursor: string): number {
  const c = parseCursor(cursor);
  if (!c) return 1;
  return s.created - c.created || (s.key < c.key ? -1 : s.key > c.key ? 1 : 0);
}

/** Re-validate a stored entry: it must already have the normalised shape. */
function normalizeStored(s: unknown): ChargingSession | undefined {
  if (!s || typeof s !== "object") return undefined;
  const r = s as Record<string, unknown>;
  const base = normalizeSession({
    created: typeof r.created === "number" ? new Date(r.created).toISOString() : undefined,
    finished: typeof r.finished === "number" ? new Date(r.finished).toISOString() : undefined,
    loadpoint: r.loadpoint,
    vehicle: r.vehicle,
    chargedEnergy: r.chargedKWh,
    solarPercentage: r.solarPercentage,
    price: r.price,
    pricePerKWh: r.pricePerKWh,
    co2PerKWh: r.co2PerKWh,
    chargeDuration: r.chargeDurationSeconds,
    odometer: r.odometer,
  });
  return base && typeof r.key === "string" ? { ...base, key: r.key.slice(0, 160) } : undefined;
}
