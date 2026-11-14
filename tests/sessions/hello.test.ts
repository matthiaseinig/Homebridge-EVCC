import { request as helloRequest } from "node:http";
import { describe, expect, it } from "vitest";
import { HelloRateLimiter, helloProof, isHelloTokenStrong } from "../../src/sessions/hello.js";
import { SessionsServer } from "../../src/sessions/server.js";
import { SessionStore } from "../../src/sessions/store.js";
import { tempDir } from "./fixtures.js";

const PROTECTED_PATH = "/v1/status";

async function helloBoot(token = TOKEN_V, warn?: (message: string) => void) {
  const store = new SessionStore(tempDir(), 1000);
  const server = new SessionsServer({ bindAddress: "127.0.0.1", port: 0, token, warn, store });
  const port = await server.start();
  const get = (path: string, method = "GET") =>
    fetch(`http://127.0.0.1:${port}${path}`, { method });
  return { stop: () => server.stop(), port, get };
}

const TOKEN_V = "9f3ac27be41d58a26fd0b7c3e1a49d8265b0f7c4d19e83a6c05b7d2e48f1a69c";
const WEAK_TOKEN = "t0k3n";
const NONCE = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8";
const VECTOR_HOST = "10.0.0.2:8765";
const VECTOR_PROOF = "d7vx6Aj2kwRcU5yX5L8LxiSaC-lruuY52THPU0gN_jA";

function helloStatusWithHost(port: number, host: string, path: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = helloRequest({ host: "127.0.0.1", port, path, headers: { Host: host } }, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    req.on("error", reject);
    req.end();
  });
}

describe("helloProof", () => {
  it("matches the shared test vector", () => {
    expect(helloProof("t0k3n", NONCE, VECTOR_HOST)).toBe(VECTOR_PROOF);
  });
});

describe("HelloRateLimiter", () => {
  it("allows 30 per minute per peer and starts a new window after a minute", () => {
    const limiter = new HelloRateLimiter();
    for (let i = 0; i < 30; i++) expect(limiter.allow("a", 1000)).toBe(true);
    expect(limiter.allow("a", 1000)).toBe(false);
    expect(limiter.allow("b", 1000)).toBe(true);
    expect(limiter.allow("a", 61_001)).toBe(true);
  });
});

describe("GET /v1/hello", () => {
  it("answers 204 with the proof for the listening host and no token", async () => {
    const { stop, port, get } = await helloBoot();
    try {
      const res = await get(`/v1/hello?nonce=${NONCE}`);
      expect(res.status).toBe(204);
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(res.headers.get("x-home-proof")).toBe(helloProof(TOKEN_V, NONCE, `127.0.0.1:${port}`));
    } finally {
      await stop();
    }
  });

  it("refuses a missing, short, long, padded, repeated or non-base64url nonce with 400", async () => {
    const { stop, get } = await helloBoot();
    try {
      for (const q of [
        "",
        "?nonce=",
        `?nonce=${NONCE.slice(1)}`,
        `?nonce=${NONCE}A`,
        `?nonce=${NONCE.slice(1)}=`,
        `?nonce=${NONCE.slice(1)}%2B`,
        `?nonce=${NONCE}&nonce=${NONCE}`,
      ]) {
        const res = await get(`/v1/hello${q}`);
        expect(res.status, q).toBe(400);
        expect(res.headers.get("x-home-proof")).toBeNull();
      }
    } finally {
      await stop();
    }
  });

  it("refuses a wrong Host with 421", async () => {
    const { stop, port } = await helloBoot();
    try {
      expect(await helloStatusWithHost(port, "evil.example:80", `/v1/hello?nonce=${NONCE}`)).toBe(
        421,
      );
    } finally {
      await stop();
    }
  });

  it("answers 429 after 30 requests per minute", async () => {
    const { stop, get } = await helloBoot();
    try {
      for (let i = 0; i < 30; i++) expect((await get(`/v1/hello?nonce=${NONCE}`)).status).toBe(204);
      const res = await get(`/v1/hello?nonce=${NONCE}`);
      expect(res.status).toBe(429);
      expect(res.headers.get("retry-after")).toBe("60");
    } finally {
      await stop();
    }
  });

  it("allows only GET on the hello route", async () => {
    const { stop, get } = await helloBoot();
    try {
      const res = await get(`/v1/hello?nonce=${NONCE}`, "POST");
      expect(res.status).toBe(405);
      expect(res.headers.get("allow")).toBe("GET");
    } finally {
      await stop();
    }
  });

  it("keeps every other route behind the token", async () => {
    const { stop, get } = await helloBoot();
    try {
      expect((await get("/v1/hello/x")).status).toBe(401);
      expect((await get(PROTECTED_PATH)).status).toBe(401);
      expect((await get("/")).status).toBe(401);
    } finally {
      await stop();
    }
  });
});

describe("isHelloTokenStrong", () => {
  it("accepts generated tokens", () => {
    expect(isHelloTokenStrong(TOKEN_V)).toBe(true);
    expect(isHelloTokenStrong("Zm9vYmFyYmF6cXV4MTIzNDU2Nzg5MGFiY2RlZmdoaWo")).toBe(true);
  });

  it("refuses short, repetitive, low-variety and odd-charset tokens", () => {
    expect(isHelloTokenStrong(WEAK_TOKEN)).toBe(false);
    expect(isHelloTokenStrong("t".repeat(40))).toBe(false);
    expect(isHelloTokenStrong("ab".repeat(20))).toBe(false);
    expect(isHelloTokenStrong(`aaaaa${TOKEN_V}`)).toBe(false);
    expect(isHelloTokenStrong(TOKEN_V.slice(0, 31))).toBe(false);
    expect(isHelloTokenStrong(`${TOKEN_V.slice(0, 40)} correct horse battery`)).toBe(false);
  });
});

describe("GET /v1/hello with a weak token", () => {
  it("answers 404, warns once without the token and keeps the other routes on the token", async () => {
    const warnings: string[] = [];
    const { stop, get } = await helloBoot(WEAK_TOKEN, (m) => warnings.push(m));
    try {
      expect((await get(`/v1/hello?nonce=${NONCE}`)).status).toBe(404);
      expect((await get(`/v1/hello?nonce=${NONCE}`)).status).toBe(404);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toMatch(/token/);
      expect(warnings[0]).not.toContain(WEAK_TOKEN);
      expect((await get(PROTECTED_PATH)).status).toBe(401);
    } finally {
      await stop();
    }
  });

  it("does not warn for a strong token", async () => {
    const warnings: string[] = [];
    const { stop, get } = await helloBoot(TOKEN_V, (m) => warnings.push(m));
    try {
      expect((await get(`/v1/hello?nonce=${NONCE}`)).status).toBe(204);
      expect(warnings).toHaveLength(0);
    } finally {
      await stop();
    }
  });
});
