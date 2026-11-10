import type { Logging } from "homebridge";
import { normalizeSessions } from "./model.js";
import { SessionsServer } from "./server.js";
import { SessionStore } from "./store.js";
import { resolveApiToken } from "./token.js";
import type { SessionsApiConfig } from "./config.js";

export const POLL_INTERVAL_MS = 10 * 60_000;
/** Delay before the refresh that follows a charging or plug state change. */
export const AFTER_SESSION_DELAY_MS = 10_000;

/** The part of the EVCC client the sessions service needs (read only). */
export interface SessionsSource {
  getSessions(): Promise<unknown[]>;
  getState(): { currency?: unknown };
}

export interface SessionsServiceOptions {
  source: SessionsSource;
  log: Logging;
  /** Homebridge storage folder. */
  dir: string;
  maxSessions: number;
  api?: SessionsApiConfig;
  now?: () => number;
  pollIntervalMs?: number;
  afterSessionDelayMs?: number;
}

const FLAG_KEY = /^loadpoints\.(\d+)\.(charging|connected)$/;

/**
 * Keeps EVCC's session log: fetches it every 10 minutes and once shortly after
 * a loadpoint stops charging or is unplugged (seen on the websocket), stores
 * it, serves the optional LAN API and tells the platform when it changed.
 * Never writes to EVCC.
 */
export class SessionsService {
  readonly store: SessionStore;
  private server: SessionsServer | null = null;
  private pollTimer: NodeJS.Timeout | null = null;
  private soonTimer: NodeJS.Timeout | null = null;
  private running = false;
  private refreshing: Promise<void> | null = null;
  private stopped = true;
  /** Bumped by every start and stop, so a start that is still loading knows it was stopped meanwhile. */
  private generation = 0;
  private readonly flags = new Map<string, boolean>();
  private readonly listeners = new Set<() => void>();
  private readonly now: () => number;

  constructor(private readonly opts: SessionsServiceOptions) {
    this.store = new SessionStore(opts.dir, opts.maxSessions);
    this.now = opts.now ?? Date.now;
  }

  onUpdated(listener: () => void): void {
    this.listeners.add(listener);
  }

  async start(): Promise<void> {
    this.stopped = false;
    const generation = ++this.generation;
    const live = (): boolean => generation === this.generation;
    const { log } = this.opts;
    try {
      const loaded = await this.store.load(this.now());
      if (loaded.backup) {
        log.warn("Session log was unreadable and was moved aside to %s", loaded.backup);
      }
    } catch (err) {
      log.warn("Could not read the session log: %s", (err as Error).message);
    }
    if (!live()) return;
    this.emit();
    await this.startApi(live);
    if (!live()) return;
    await this.refresh();
    if (!live()) return;
    this.schedulePoll();
  }

  stop(): void {
    this.stopped = true;
    this.generation++;
    this.running = false;
    if (this.pollTimer) clearTimeout(this.pollTimer);
    if (this.soonTimer) clearTimeout(this.soonTimer);
    this.pollTimer = null;
    this.soonTimer = null;
    const server = this.server;
    this.server = null;
    void server?.stop();
  }

  /** Feed websocket updates; a charging or plug flag turning false schedules one refresh. */
  noteUpdate(key: string, value: unknown): void {
    const m = FLAG_KEY.exec(key);
    if (!m || typeof value !== "boolean") return;
    const previous = this.flags.get(key);
    this.flags.set(key, value);
    if (previous === true && value === false) this.refreshSoon();
  }

  /** Feed the loadpoints of a REST snapshot, so a flag seen true there is known before the first websocket diff. */
  noteLoadpoints(loadpoints: ReadonlyArray<{ charging?: unknown; connected?: unknown }>): void {
    loadpoints.forEach((lp, i) => {
      this.noteUpdate(`loadpoints.${i}.charging`, lp.charging);
      this.noteUpdate(`loadpoints.${i}.connected`, lp.connected);
    });
  }

  /** Refresh once after a short delay; repeated calls within the delay collapse into one. */
  refreshSoon(): void {
    if (this.stopped || this.soonTimer) return;
    this.soonTimer = setTimeout(() => {
      this.soonTimer = null;
      void this.refresh();
    }, this.opts.afterSessionDelayMs ?? AFTER_SESSION_DELAY_MS);
    this.soonTimer.unref?.();
  }

  /** Fetch, merge and persist now. Overlapping calls share one fetch. */
  refresh(): Promise<void> {
    if (this.refreshing) return this.refreshing;
    this.refreshing = this.doRefresh().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  private async doRefresh(): Promise<void> {
    const { log, source } = this.opts;
    try {
      const raw = await source.getSessions();
      const currency = source.getState().currency;
      await this.store.update(
        normalizeSessions(raw),
        typeof currency === "string" ? currency : "",
        this.now(),
      );
      this.emit();
    } catch (err) {
      const message = (err as Error).message;
      this.store.lastError = message.slice(0, 200);
      log.warn("Could not refresh the charging sessions: %s", message);
    }
  }

  private emit(): void {
    for (const l of this.listeners) {
      try {
        l();
      } catch (err) {
        this.opts.log.error("Sessions listener threw: %s", (err as Error).message);
      }
    }
  }

  private schedulePoll(): void {
    if (this.stopped) return;
    this.pollTimer = setTimeout(() => {
      void this.refresh().finally(() => this.schedulePoll());
    }, this.opts.pollIntervalMs ?? POLL_INTERVAL_MS);
    this.pollTimer.unref?.();
  }

  private async startApi(live: () => boolean): Promise<void> {
    const api = this.opts.api;
    if (!api || this.running) return;
    const { log } = this.opts;
    try {
      const token = await resolveApiToken(this.opts.dir, api.token);
      if (!live()) return;
      const server = new SessionsServer({
        bindAddress: api.bindAddress,
        port: api.port,
        token: token.token,
        store: this.store,
      });
      const port = await server.start();
      if (!live()) {
        await server.stop();
        return;
      }
      this.server = server;
      this.running = true;
      log.info(
        "Sessions API listening on %s:%d (GET only, bearer token required)",
        api.bindAddress,
        port,
      );
      if (token.generated && token.file) {
        log.info("Generated the sessions API token into %s (read it from there)", token.file);
      } else if (token.file) {
        log.info("Sessions API token is read from %s", token.file);
      }
    } catch (err) {
      log.error("Sessions API could not start: %s", (err as Error).message);
    }
  }
}
