import { createHmac } from "node:crypto";

/** Token-free proof route: the app checks it reaches the real home service before it sends its bearer token. */
export const HELLO_PATH = "/v1/hello";

const NONCE_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const HELLO_PREFIX = "HOME-HELLO\n";

export const HELLO_LIMIT_PER_MINUTE = 30;
const WINDOW_MS = 60_000;
export const MAX_TRACKED_PEERS = 256;

export const HELLO_OFF_WARNING =
  "GET /v1/hello is off: the API token is shorter than 32 characters or does not look random. " +
  "Delete the API token file (or the configured token) and restart to generate a new one.";

const MIN_TOKEN_BITS = 128;
const MIN_TOKEN_LENGTH = 32;
const MIN_DISTINCT_CHARS = 10;
const MAX_REPEAT_RUN = 4;

/**
 * The route is an unauthenticated oracle (a proof lets one test token guesses offline), so it is served only
 * for a token that cannot be guessed: at least 32 characters, hex or base64 characters (so at least 128 bits
 * when random), at least 10 distinct characters and no run of more than 4 equal characters.
 */
export function isHelloTokenStrong(token: string): boolean {
  if (token.length < MIN_TOKEN_LENGTH) return false;
  let bitsPerChar: number;
  if (/^[0-9a-fA-F]+$/.test(token)) bitsPerChar = 4;
  else if (/^[A-Za-z0-9_+/=-]+$/.test(token)) bitsPerChar = 6;
  else return false;
  if (token.length * bitsPerChar < MIN_TOKEN_BITS) return false;
  if (new Set(token).size < MIN_DISTINCT_CHARS) return false;
  return !new RegExp(`(.)\\1{${MAX_REPEAT_RUN}}`).test(token);
}

/** `base64url_nopad(HMAC-SHA256(key = token, msg = "HOME-HELLO\n" + nonce + "\n" + host))`. */
export function helloProof(token: string, nonce: string, host: string): string {
  return createHmac("sha256", Buffer.from(token, "utf8"))
    .update(Buffer.from(`${HELLO_PREFIX}${nonce}\n${host}`, "utf8"))
    .digest("base64url");
}

/** Fixed-window request counter per peer address. */
export class HelloRateLimiter {
  private readonly windows = new Map<string, { start: number; count: number }>();

  constructor(private readonly limit = HELLO_LIMIT_PER_MINUTE) {}

  /** True when the request is within the limit; counts it either way. */
  allow(peer: string, nowMs: number): boolean {
    const w = this.windows.get(peer);
    if (w && nowMs - w.start < WINDOW_MS) {
      w.count += 1;
      return w.count <= this.limit;
    }
    this.windows.delete(peer);
    if (this.windows.size >= MAX_TRACKED_PEERS) {
      for (const [key, old] of this.windows) {
        if (nowMs - old.start >= WINDOW_MS) this.windows.delete(key);
      }
    }
    // Still full: evict the oldest windows (insertion order is window start order).
    while (this.windows.size >= MAX_TRACKED_PEERS) {
      const oldest = this.windows.keys().next();
      if (oldest.done) break;
      this.windows.delete(oldest.value);
    }
    this.windows.set(peer, { start: nowMs, count: 1 });
    return true;
  }

  /** Number of tracked peers (for tests). */
  get size(): number {
    return this.windows.size;
  }
}

export type HelloResult = { status: 204; proof: string } | { status: 400 | 429; error: string };

/** The answer of GET /v1/hello. `searchParams` is the parsed query; the nonce is used exactly as received. */
export function handleHello(
  searchParams: URLSearchParams,
  token: string,
  host: string,
  limiter: HelloRateLimiter,
  peer: string,
  nowMs: number,
): HelloResult {
  if (!limiter.allow(peer, nowMs)) return { status: 429, error: "too many requests" };
  const values = searchParams.getAll("nonce");
  const nonce = values.length === 1 ? values[0] : "";
  if (!NONCE_PATTERN.test(nonce)) return { status: 400, error: "invalid nonce" };
  return { status: 204, proof: helloProof(token, nonce, host) };
}
