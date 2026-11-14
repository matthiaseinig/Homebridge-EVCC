import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { request } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AFTER_SESSION_DELAY_MS,
  POLL_INTERVAL_MS,
  SessionsService,
} from "../../src/sessions/service.js";
import { STORE_FILE } from "../../src/sessions/store.js";
import { TOKEN_FILE } from "../../src/sessions/token.js";
import { createMockLogger } from "../helpers/homebridge.js";
import { rawSession, tempDir } from "./fixtures.js";

const services: SessionsService[] = [];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  vi.setSystemTime(new Date("2026-03-10T12:00:00Z"));
});
afterEach(() => {
  for (const s of services.splice(0)) s.stop();
  vi.useRealTimers();
});

function build(
  over: {
    getSessions?: () => Promise<unknown[]>;
    api?: { bindAddress: string; port: number; token?: string };
    dir?: string;
    currency?: unknown;
  } = {},
) {
  const log = createMockLogger();
  const getSessions = vi.fn(over.getSessions ?? (async () => [rawSession()]));
  const service = new SessionsService({
    source: { getSessions, getState: () => ({ currency: over.currency ?? "EUR" }) },
    log,
    dir: over.dir ?? tempDir(),
    maxSessions: 100,
    api: over.api,
  });
  services.push(service);
  return { service, log, getSessions };
}

describe("SessionsService polling", () => {
  it("fetches on start, stores the sessions and notifies listeners", async () => {
    const dir = tempDir();
    const { service, getSessions } = build({ dir });
    const updated = vi.fn();
    service.onUpdated(updated);
    await service.start();
    expect(getSessions).toHaveBeenCalledTimes(1);
    expect(service.store.count).toBe(1);
    expect(service.store.currency).toBe("EUR");
    expect(service.store.lastUpdate).toBe(Date.parse("2026-03-10T12:00:00Z"));
    expect(updated).toHaveBeenCalledTimes(2); // after load, after fetch
    expect(statSync(join(dir, STORE_FILE)).mode & 0o777).toBe(0o600);
  });

  it("polls every 10 minutes and stops on stop()", async () => {
    const { service, getSessions } = build();
    await service.start();
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS - 1);
    expect(getSessions).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(getSessions).toHaveBeenCalledTimes(2);
    // The next poll is armed once the (real) file write of this refresh is done.
    await vi.waitFor(() => expect(vi.getTimerCount()).toBe(1));
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    expect(getSessions).toHaveBeenCalledTimes(3);
    service.stop();
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3);
    expect(getSessions).toHaveBeenCalledTimes(3);
  });

  it("a stop while the log is still loading prevents the API from binding and the first fetch", async () => {
    const dir = tempDir();
    const { service, log, getSessions } = build({
      dir,
      api: { bindAddress: "127.0.0.1", port: 0, token: "t".repeat(32) },
    });
    const started = service.start();
    service.stop();
    await started;
    expect(getSessions).not.toHaveBeenCalled();
    expect(log.info).not.toHaveBeenCalledWith(
      expect.stringContaining("Sessions API listening"),
      expect.anything(),
      expect.anything(),
    );
    expect(() => statSync(join(dir, TOKEN_FILE))).toThrow();
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 2);
    expect(getSessions).not.toHaveBeenCalled();
  });

  it("a stop while the API is binding closes the server again, and a later start works", async () => {
    const { service, getSessions } = build({
      api: { bindAddress: "127.0.0.1", port: 0, token: "t".repeat(32) },
    });
    const started = service.start();
    await vi.waitFor(() => expect(getSessions).not.toHaveBeenCalled());
    service.stop();
    await started;
    expect(getSessions).not.toHaveBeenCalled();
    await service.start();
    expect(getSessions).toHaveBeenCalledTimes(1);
  });

  it("keeps the old data and records the error when a fetch fails", async () => {
    let fail = false;
    const { service, log } = build({
      getSessions: async () => {
        if (fail) throw new Error("GET /api/sessions HTTP 500");
        return [rawSession()];
      },
    });
    await service.start();
    const before = service.store.lastUpdate;
    fail = true;
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    await vi.waitFor(() => expect(vi.getTimerCount()).toBe(1));
    expect(service.store.count).toBe(1);
    expect(service.store.lastUpdate).toBe(before);
    expect(service.store.lastError).toBe("GET /api/sessions HTTP 500");
    expect(log.warn).toHaveBeenCalled();
    fail = false;
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    expect(service.store.lastError).toBeNull();
  });

  it("shares one fetch between overlapping refreshes", async () => {
    let release: (v: unknown[]) => void = () => undefined;
    const { service, getSessions } = build({
      getSessions: () => new Promise<unknown[]>((r) => (release = r)),
    });
    const a = service.refresh();
    const b = service.refresh();
    release([rawSession()]);
    await Promise.all([a, b]);
    expect(getSessions).toHaveBeenCalledTimes(1);
  });

  it("ignores a non-string currency", async () => {
    const { service } = build({ currency: 42 });
    await service.start();
    expect(service.store.currency).toBe("");
  });

  it("survives a listener that throws", async () => {
    const { service, log } = build();
    service.onUpdated(() => {
      throw new Error("bad listener");
    });
    await service.start();
    expect(log.error).toHaveBeenCalledWith(expect.any(String), "bad listener");
    expect(service.store.count).toBe(1);
  });
});

describe("SessionsService after a session ends", () => {
  it("refreshes once, shortly after charging or the plug turns false", async () => {
    const { service, getSessions } = build();
    await service.start();
    getSessions.mockClear();

    service.noteUpdate("loadpoints.0.charging", true);
    service.noteUpdate("loadpoints.0.connected", true);
    await vi.advanceTimersByTimeAsync(AFTER_SESSION_DELAY_MS * 2);
    expect(getSessions).not.toHaveBeenCalled();

    service.noteUpdate("loadpoints.0.charging", false);
    service.noteUpdate("loadpoints.0.connected", false);
    await vi.advanceTimersByTimeAsync(AFTER_SESSION_DELAY_MS - 1);
    expect(getSessions).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(getSessions).toHaveBeenCalledTimes(1);
  });

  it("ignores other keys, non-boolean values, a first false and false to false", async () => {
    const { service, getSessions } = build();
    await service.start();
    getSessions.mockClear();
    service.noteUpdate("loadpoints.0.chargePower", false);
    service.noteUpdate("pvPower", false);
    service.noteUpdate("loadpoints.0.charging", "no");
    service.noteUpdate("loadpoints.0.charging", false);
    service.noteUpdate("loadpoints.0.charging", false);
    await vi.advanceTimersByTimeAsync(AFTER_SESSION_DELAY_MS * 2);
    expect(getSessions).not.toHaveBeenCalled();
  });

  it("tracks loadpoints separately and does nothing once stopped", async () => {
    const { service, getSessions } = build();
    await service.start();
    getSessions.mockClear();
    service.noteUpdate("loadpoints.1.charging", true);
    service.noteUpdate("loadpoints.0.charging", false);
    await vi.advanceTimersByTimeAsync(AFTER_SESSION_DELAY_MS * 2);
    expect(getSessions).not.toHaveBeenCalled();

    service.stop();
    service.noteUpdate("loadpoints.1.charging", false);
    await vi.advanceTimersByTimeAsync(AFTER_SESSION_DELAY_MS * 2);
    expect(getSessions).not.toHaveBeenCalled();
  });
});

describe("SessionsService storage", () => {
  it("warns and starts empty when the stored file is unreadable", async () => {
    const dir = tempDir();
    const { writeFileSync } = await import("node:fs");
    writeFileSync(join(dir, STORE_FILE), "garbage");
    const { service, log } = build({ dir });
    await service.start();
    expect(log.warn).toHaveBeenCalledWith(
      expect.stringContaining("moved aside"),
      expect.any(String),
    );
    expect(service.store.count).toBe(1);
  });

  it("warns when the store cannot be read at all", async () => {
    const dir = tempDir();
    const { service, log } = build({ dir });
    vi.spyOn(service.store, "load").mockRejectedValue(new Error("disk"));
    await service.start();
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining("Could not read"), "disk");
  });

  it("reloads what an earlier run stored", async () => {
    const dir = tempDir();
    const first = build({ dir });
    await first.service.start();
    first.service.stop();
    const second = build({ dir, getSessions: async () => [] });
    await second.service.start();
    expect(second.service.store.count).toBe(1);
  });
});

describe("SessionsService API", () => {
  function get(port: number, token: string, path: string): Promise<number> {
    return new Promise((resolve, reject) => {
      const req = request(
        { host: "127.0.0.1", port, path, headers: { Authorization: `Bearer ${token}` } },
        (res) => {
          res.resume();
          res.on("end", () => resolve(res.statusCode ?? 0));
        },
      );
      req.on("error", reject);
      req.end();
    });
  }

  it("serves the API with a generated token file", async () => {
    vi.useRealTimers();
    const dir = tempDir();
    const { service, log } = build({ dir, api: { bindAddress: "127.0.0.1", port: 0 } });
    await service.start();
    const token = readFileSync(join(dir, TOKEN_FILE), "utf8").trim();
    expect(statSync(join(dir, TOKEN_FILE)).mode & 0o777).toBe(0o600);
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(log.info).toHaveBeenCalledWith(expect.stringContaining("Generated"), expect.any(String));
    expect(log.info).toHaveBeenCalledWith(
      expect.stringContaining("listening"),
      "127.0.0.1",
      expect.any(Number),
    );
  });

  it("reads an existing token file and a configured token", async () => {
    vi.useRealTimers();
    const dir = tempDir();
    const a = build({ dir, api: { bindAddress: "127.0.0.1", port: 0 } });
    await a.service.start();
    a.service.stop();
    const b = build({ dir, api: { bindAddress: "127.0.0.1", port: 0 } });
    await b.service.start();
    expect(b.log.info).toHaveBeenCalledWith(
      expect.stringContaining("is read from"),
      expect.any(String),
    );
    const c = build({ api: { bindAddress: "127.0.0.1", port: 0, token: "c".repeat(20) } });
    await c.service.start();
    expect(c.log.info).toHaveBeenCalledTimes(1);
  });

  it("answers requests and stops serving on stop()", async () => {
    vi.useRealTimers();
    const probe = tempDir();
    const { service } = build({
      dir: probe,
      api: { bindAddress: "127.0.0.1", port: 0, token: "k".repeat(20) },
    });
    await service.start();
    const { log } = build();
    expect(log).toBeDefined();
    // The port was chosen by the OS; find it through the info log of the service.
    const infoCalls = (service as unknown as { opts: { log: ReturnType<typeof createMockLogger> } })
      .opts.log.info as ReturnType<typeof vi.fn>;
    const port = infoCalls.mock.calls.find((c) => String(c[0]).includes("listening"))![2] as number;
    expect(await get(port, "k".repeat(20), "/v1/status")).toBe(200);
    expect(await get(port, "wrong", "/v1/status")).toBe(401);
    service.stop();
    await expect(get(port, "k".repeat(20), "/v1/status")).rejects.toBeTruthy();
  });

  it("logs and carries on when the API cannot start", async () => {
    vi.useRealTimers();
    const first = build({ api: { bindAddress: "127.0.0.1", port: 0, token: "k".repeat(20) } });
    await first.service.start();
    const port = (first.log.info as ReturnType<typeof vi.fn>).mock.calls.find((c) =>
      String(c[0]).includes("listening"),
    )![2] as number;
    const second = build({ api: { bindAddress: "127.0.0.1", port, token: "k".repeat(20) } });
    await second.service.start();
    expect(second.log.error).toHaveBeenCalledWith(
      expect.stringContaining("could not start"),
      expect.any(String),
    );
    expect(second.service.store.count).toBe(1);
  });
});

describe("SessionsService.noteLoadpoints", () => {
  it("learns the flags from a snapshot so the first false afterwards counts", async () => {
    const { service, getSessions } = build();
    await service.start();
    getSessions.mockClear();
    service.noteLoadpoints([{ charging: true, connected: true }, {}]);
    service.noteUpdate("loadpoints.0.charging", false);
    await vi.advanceTimersByTimeAsync(AFTER_SESSION_DELAY_MS);
    expect(getSessions).toHaveBeenCalledTimes(1);
  });

  it("refreshes when a snapshot itself shows the end", async () => {
    const { service, getSessions } = build();
    await service.start();
    service.noteLoadpoints([{ charging: true }]);
    getSessions.mockClear();
    service.noteLoadpoints([{ charging: false }]);
    await vi.advanceTimersByTimeAsync(AFTER_SESSION_DELAY_MS);
    expect(getSessions).toHaveBeenCalledTimes(1);
  });
});
