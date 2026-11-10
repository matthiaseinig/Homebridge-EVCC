import { request } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { normalizeSessions } from "../../src/sessions/model.js";
import { parseBound, SessionsServer } from "../../src/sessions/server.js";
import { SessionStore } from "../../src/sessions/store.js";
import { rawSession, tempDir } from "./fixtures.js";

const TOKEN = "t".repeat(40);
const servers: SessionsServer[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.stop()));
});

interface Reply {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: any;
}

async function boot(count = 3) {
  const store = new SessionStore(tempDir(), 1000);
  const raw = Array.from({ length: count }, (_, i) =>
    rawSession({
      id: i + 1,
      created: new Date(2026, 2, 1 + i, 8).toISOString(),
      finished: new Date(2026, 2, 1 + i, 10).toISOString(),
      chargedEnergy: 10,
      solarPercentage: 50,
    }),
  );
  await store.update(normalizeSessions(raw), "EUR", Date.parse("2026-03-20T00:00:00Z"));
  const server = new SessionsServer({ bindAddress: "127.0.0.1", port: 0, token: TOKEN, store });
  servers.push(server);
  const port = await server.start();
  const get = (
    path: string,
    opts: { method?: string; token?: string | null; host?: string } = {},
  ): Promise<Reply> =>
    new Promise((resolve, reject) => {
      const headers: Record<string, string> = { Host: opts.host ?? `127.0.0.1:${port}` };
      if (opts.token !== null) headers.Authorization = `Bearer ${opts.token ?? TOKEN}`;
      const req = request(
        { host: "127.0.0.1", port, path, method: opts.method ?? "GET", headers },
        (res) => {
          let text = "";
          res.on("data", (c) => (text += c));
          res.on("end", () =>
            resolve({ status: res.statusCode ?? 0, headers: res.headers, body: JSON.parse(text) }),
          );
        },
      );
      req.on("error", reject);
      req.end();
    });
  return { store, port, get };
}

describe("SessionsServer construction", () => {
  it("refuses a public bind address and a missing token", () => {
    const store = new SessionStore(tempDir(), 10);
    expect(
      () => new SessionsServer({ bindAddress: "0.0.0.0", port: 0, token: TOKEN, store }),
    ).toThrow(/private/);
    expect(
      () => new SessionsServer({ bindAddress: "127.0.0.1", port: 0, token: "", store }),
    ).toThrow(/token/);
  });

  it("stop is safe before start and twice", async () => {
    const server = new SessionsServer({
      bindAddress: "127.0.0.1",
      port: 0,
      token: TOKEN,
      store: new SessionStore(tempDir(), 10),
    });
    await server.stop();
    await server.start();
    await server.stop();
    await server.stop();
  });

  it("rejects when the port is taken", async () => {
    const { port } = await boot();
    const second = new SessionsServer({
      bindAddress: "127.0.0.1",
      port,
      token: TOKEN,
      store: new SessionStore(tempDir(), 10),
    });
    await expect(second.start()).rejects.toBeTruthy();
  });
});

describe("SessionsServer security", () => {
  it("requires the bearer token", async () => {
    const { get } = await boot();
    expect((await get("/v1/status", { token: null })).status).toBe(401);
    expect((await get("/v1/status", { token: "wrong" })).status).toBe(401);
    expect((await get("/v1/status", { token: TOKEN.slice(0, -1) })).status).toBe(401);
    expect((await get("/v1/status")).status).toBe(200);
  });

  it("answers 421 for a foreign Host header, before the token check", async () => {
    const { get, port } = await boot();
    expect((await get("/v1/status", { host: "evil.example" })).status).toBe(421);
    expect((await get("/v1/status", { host: "127.0.0.1" })).status).toBe(421);
    expect((await get("/v1/status", { host: "evil.example", token: null })).status).toBe(421);
    expect((await get("/v1/status", { host: `127.0.0.1:${port}`.toUpperCase() })).status).toBe(200);
  });

  it("allows GET only and never redirects", async () => {
    const { get } = await boot();
    for (const method of ["POST", "PUT", "DELETE", "PATCH"]) {
      const r = await get("/v1/sessions", { method });
      expect(r.status).toBe(405);
      expect(r.headers.allow).toBe("GET");
    }
    for (const path of ["/v1/status", "/v1/sessions", "/v1/nope", "/", "//v1/status"]) {
      const r = await get(path);
      expect(r.status).toBeLessThan(400 + 100);
      expect([200, 404]).toContain(r.status);
      expect(r.headers.location).toBeUndefined();
    }
  });

  it("sends no-store JSON and 404 for unknown paths", async () => {
    const { get } = await boot();
    const r = await get("/v1/unknown");
    expect(r.status).toBe(404);
    expect(r.headers["cache-control"]).toBe("no-store");
    expect(r.headers["x-content-type-options"]).toBe("nosniff");
    expect(r.headers["content-type"]).toContain("application/json");
  });
});

describe("GET /v1/status", () => {
  it("reports the store", async () => {
    const { get, store } = await boot(3);
    store.lastError = "boom";
    const { body } = await get("/v1/status");
    expect(body).toMatchObject({
      schema: 1,
      sessions: 3,
      currency: "EUR",
      lastUpdate: "2026-03-20T00:00:00.000Z",
      lastError: "boom",
    });
    expect(body.oldest).toBe(new Date(2026, 2, 1, 8).toISOString());
    expect(body.newest).toBe(new Date(2026, 2, 3, 8).toISOString());
    expect(body.units.chargedKWh).toBe("kWh");
  });

  it("reports nulls for an empty store", async () => {
    const { get } = await boot(0);
    const { body } = await get("/v1/status");
    expect(body).toMatchObject({ sessions: 0, oldest: null, newest: null });
  });
});

describe("GET /v1/sessions", () => {
  it("lists sessions oldest first in the documented shape", async () => {
    const { get } = await boot(3);
    const { status, body } = await get("/v1/sessions");
    expect(status).toBe(200);
    expect(body.currency).toBe("EUR");
    expect(body.next).toBeNull();
    expect(body.sessions.map((s: { id: string }) => s.id)).toEqual(["id:1", "id:2", "id:3"]);
    expect(body.sessions[0]).toEqual({
      id: "id:1",
      created: new Date(2026, 2, 1, 8).toISOString(),
      finished: new Date(2026, 2, 1, 10).toISOString(),
      loadpoint: "Garage",
      vehicle: "Car A",
      chargedKWh: 10,
      solarPercentage: 50,
      price: 2.5,
      pricePerKWh: 0.25,
      co2PerKWh: 120,
      chargeDurationSeconds: 7200,
      odometer: 12000.5,
    });
  });

  it("filters by local days and by ISO times", async () => {
    const { get } = await boot(5);
    const days = await get("/v1/sessions?from=2026-03-02&to=2026-03-03");
    expect(days.body.sessions.map((s: { id: string }) => s.id)).toEqual(["id:2", "id:3"]);
    const iso = await get(
      `/v1/sessions?from=${encodeURIComponent(new Date(2026, 2, 2, 8).toISOString())}&to=${encodeURIComponent(new Date(2026, 2, 4, 8).toISOString())}`,
    );
    expect(iso.body.sessions.map((s: { id: string }) => s.id)).toEqual(["id:2", "id:3"]);
  });

  it("pages with limit and cursor", async () => {
    const { get } = await boot(5);
    const first = await get("/v1/sessions?limit=2");
    expect(first.body.sessions).toHaveLength(2);
    expect(first.body.next).toBeTruthy();
    const second = await get(`/v1/sessions?limit=2&cursor=${encodeURIComponent(first.body.next)}`);
    expect(second.body.sessions.map((s: { id: string }) => s.id)).toEqual(["id:3", "id:4"]);
    const third = await get(`/v1/sessions?limit=2&cursor=${encodeURIComponent(second.body.next)}`);
    expect(third.body.sessions.map((s: { id: string }) => s.id)).toEqual(["id:5"]);
    expect(third.body.next).toBeNull();
  });

  it("rejects bad parameters with 400", async () => {
    const { get } = await boot();
    for (const q of [
      "from=yesterday",
      "to=2026-13-40",
      "from=2026-02-30",
      "limit=0",
      "limit=1001",
      "limit=abc",
      "limit=1.5",
      "cursor=junk",
    ]) {
      const r = await get(`/v1/sessions?${q}`);
      expect(r.status, q).toBe(400);
      expect(typeof r.body.error).toBe("string");
    }
  });

  it("ignores empty from and to", async () => {
    const { get } = await boot(3);
    expect((await get("/v1/sessions?from=&to=")).body.sessions).toHaveLength(3);
  });
});

describe("GET /v1/sessions/summary", () => {
  it("returns month buckets", async () => {
    const { get } = await boot(3);
    const { status, body } = await get("/v1/sessions/summary?period=month");
    expect(status).toBe(200);
    expect(body.period).toBe("month");
    expect(body.currency).toBe("EUR");
    expect(body.buckets).toEqual([
      {
        period: "2026-03",
        sessions: 3,
        chargedKWh: 30,
        solarPercentage: 50,
        cost: 7.5,
        avgPricePerKWh: 0.25,
        chargeDurationSeconds: 21600,
      },
    ]);
  });

  it("returns year buckets and honours the range", async () => {
    const { get } = await boot(3);
    const year = await get("/v1/sessions/summary?period=year");
    expect(year.body.buckets).toHaveLength(1);
    expect(year.body.buckets[0].period).toBe("2026");
    const none = await get("/v1/sessions/summary?period=year&from=2027-01-01");
    expect(none.body.buckets).toEqual([]);
  });

  it("rejects a missing or unknown period and bad bounds", async () => {
    const { get } = await boot();
    expect((await get("/v1/sessions/summary")).status).toBe(400);
    expect((await get("/v1/sessions/summary?period=week")).status).toBe(400);
    expect((await get("/v1/sessions/summary?period=month&from=x")).status).toBe(400);
    expect((await get("/v1/sessions/summary?period=month&to=x")).status).toBe(400);
  });
});

describe("parseBound", () => {
  it("covers whole local days on both edges and takes ISO times verbatim", () => {
    expect(parseBound("2026-03-05", "from")).toBe(new Date(2026, 2, 5).getTime());
    expect(parseBound("2026-03-05", "to")).toBe(new Date(2026, 2, 6).getTime());
    expect(parseBound("2026-03-05T10:00:00Z", "to")).toBe(Date.parse("2026-03-05T10:00:00Z"));
    expect(parseBound("2026-03-05Tnope", "to")).toBeUndefined();
    expect(parseBound("2026/03/05", "to")).toBeUndefined();
    expect(parseBound("0", "from")).toBeUndefined();
  });
});
