import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { isPrivateAddress } from "./config.js";
import type { ChargingSession } from "./model.js";
import { parseCursor, type SessionStore, type TimeRange } from "./store.js";
import { summarize, type SummaryPeriod } from "./summary.js";

/** Default and maximum page size of /v1/sessions. */
export const DEFAULT_PAGE = 200;
export const MAX_PAGE = 1000;

export interface SessionsServerOptions {
  bindAddress: string;
  port: number;
  /** Required: the API is never served without a token. */
  token: string;
  store: SessionStore;
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * A `from` or `to` bound: `YYYY-MM-DD` (a local calendar day, covering the
 * whole day on both ends) or a full ISO time (`from` inclusive, `to`
 * exclusive). Undefined when invalid.
 */
export function parseBound(value: string, edge: "from" | "to"): number | undefined {
  const day = DAY.exec(value);
  if (day) {
    const y = Number(day[1]);
    const m = Number(day[2]);
    const d = Number(day[3]);
    const start = new Date(y, m - 1, d);
    if (start.getFullYear() !== y || start.getMonth() !== m - 1 || start.getDate() !== d) {
      return undefined;
    }
    return edge === "from" ? start.getTime() : new Date(y, m - 1, d + 1).getTime();
  }
  if (!/^\d{4}-\d{2}-\d{2}T/.test(value)) return undefined;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : undefined;
}

function toApi(s: ChargingSession): Record<string, unknown> {
  return {
    id: s.key,
    created: new Date(s.created).toISOString(),
    finished: s.finished === null ? null : new Date(s.finished).toISOString(),
    loadpoint: s.loadpoint,
    vehicle: s.vehicle,
    chargedKWh: s.chargedKWh,
    solarPercentage: s.solarPercentage,
    price: s.price,
    pricePerKWh: s.pricePerKWh,
    co2PerKWh: s.co2PerKWh,
    chargeDurationSeconds: s.chargeDurationSeconds,
    odometer: s.odometer,
  };
}

/**
 * Small read-only JSON API for the session log. GET only, no redirects. It
 * binds to one literal private or loopback address (never a wildcard),
 * refuses requests from non-private peers, accepts only
 * `Host: <bindAddress>:<port>` (421 otherwise, which stops DNS rebinding) and
 * always requires `Authorization: Bearer`.
 *
 *   GET /v1/status
 *   GET /v1/sessions?from&to&limit&cursor      from/to: YYYY-MM-DD or ISO time
 *   GET /v1/sessions/summary?period=month|year[&from&to]
 */
export class SessionsServer {
  private server: Server | null = null;
  private allowedHost = "";

  constructor(private readonly opts: SessionsServerOptions) {
    if (!isPrivateAddress(opts.bindAddress)) {
      throw new Error("sessions API must bind to a private or loopback address");
    }
    if (!opts.token) throw new Error("sessions API needs a token");
  }

  /** Resolves with the bound port (useful with port 0 in tests). */
  start(): Promise<number> {
    return new Promise((resolve, reject) => {
      const server = createServer((req, res) => this.handle(req, res));
      server.once("error", reject);
      server.listen(this.opts.port, this.opts.bindAddress, () => {
        server.off("error", reject);
        this.server = server;
        const addr = server.address();
        const port = typeof addr === "object" && addr ? addr.port : this.opts.port;
        const host = this.opts.bindAddress.includes(":")
          ? `[${this.opts.bindAddress}]`
          : this.opts.bindAddress;
        this.allowedHost = `${host}:${port}`.toLowerCase();
        resolve(port);
      });
    });
  }

  stop(): Promise<void> {
    const server = this.server;
    this.server = null;
    if (!server) return Promise.resolve();
    return new Promise((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    });
  }

  private send(res: ServerResponse, status: number, body: unknown): void {
    res.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    res.end(JSON.stringify(body));
  }

  private handle(req: IncomingMessage, res: ServerResponse): void {
    try {
      if (!isPrivateAddress(req.socket.remoteAddress ?? ""))
        return this.send(res, 403, { error: "forbidden" });
      if ((req.headers.host ?? "").toLowerCase() !== this.allowedHost) {
        return this.send(res, 421, { error: "misdirected request" });
      }
      if (req.method !== "GET") {
        res.setHeader("Allow", "GET");
        return this.send(res, 405, { error: "method not allowed" });
      }
      const header = req.headers.authorization ?? "";
      if (!header.startsWith("Bearer ") || !safeEqual(header.slice(7), this.opts.token)) {
        return this.send(res, 401, { error: "unauthorized" });
      }
      this.route(new URL(req.url ?? "/", "http://localhost"), res);
    } catch {
      this.send(res, 500, { error: "internal error" });
    }
  }

  private range(q: URLSearchParams): TimeRange | string {
    const range: { fromMs?: number; toMs?: number } = {};
    const from = q.get("from");
    const to = q.get("to");
    if (from !== null && from !== "") {
      range.fromMs = parseBound(from, "from");
      if (range.fromMs === undefined) return "from must be YYYY-MM-DD or an ISO time";
    }
    if (to !== null && to !== "") {
      range.toMs = parseBound(to, "to");
      if (range.toMs === undefined) return "to must be YYYY-MM-DD or an ISO time";
    }
    return range;
  }

  private route(url: URL, res: ServerResponse): void {
    const { store } = this.opts;
    const q = url.searchParams;
    const bad = (msg: string): void => this.send(res, 400, { error: msg });
    switch (url.pathname) {
      case "/v1/status": {
        const all = store.list();
        return this.send(res, 200, {
          schema: 1,
          sessions: store.count,
          currency: store.currency,
          oldest: all.length > 0 ? new Date(all[0].created).toISOString() : null,
          newest: all.length > 0 ? new Date(all[all.length - 1].created).toISOString() : null,
          lastUpdate: store.lastUpdate === null ? null : new Date(store.lastUpdate).toISOString(),
          lastError: store.lastError,
          units: {
            chargedKWh: "kWh",
            solarPercentage: "percent, 0 to 100",
            price: "currency",
            pricePerKWh: "currency per kWh",
            co2PerKWh: "g per kWh",
            chargeDurationSeconds: "s",
            odometer: "km",
            periods: "month and year buckets use the local time of the Homebridge host",
          },
        });
      }
      case "/v1/sessions": {
        const range = this.range(q);
        if (typeof range === "string") return bad(range);
        const limitRaw = q.get("limit");
        const limit = limitRaw === null ? DEFAULT_PAGE : Number(limitRaw);
        if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE) {
          return bad(`limit must be an integer from 1 to ${MAX_PAGE}`);
        }
        const cursor = q.get("cursor") ?? undefined;
        if (cursor !== undefined && !parseCursor(cursor)) return bad("cursor is not valid");
        const page = store.page(range, cursor, limit);
        return this.send(res, 200, {
          currency: store.currency,
          sessions: page.sessions.map(toApi),
          next: page.next,
        });
      }
      case "/v1/sessions/summary": {
        const period = q.get("period");
        if (period !== "month" && period !== "year") return bad("period must be month or year");
        const range = this.range(q);
        if (typeof range === "string") return bad(range);
        return this.send(res, 200, {
          period: period as SummaryPeriod,
          currency: store.currency,
          buckets: summarize(store.list(range), period),
        });
      }
      default:
        return this.send(res, 404, { error: "not found" });
    }
  }
}
