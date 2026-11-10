import { isIP } from "node:net";
import { MIN_CONFIGURED_TOKEN_LENGTH } from "./token.js";

export const DEFAULT_API_PORT = 8768;
export const DEFAULT_MAX_SESSIONS = 5000;

export interface SessionsApiConfig {
  bindAddress: string;
  port: number;
  /** Optional; a token is generated into the storage folder when absent. */
  token?: string;
}

export interface SessionsConfig {
  /** Poll EVCC's session log, keep it and expose the summaries. Default true. */
  enabled: boolean;
  /** Oldest sessions are dropped beyond this many. */
  maxSessions: number;
  /** Present only when the LAN API is enabled and valid. */
  api?: SessionsApiConfig;
}

/** True for loopback, RFC 1918, link-local and unique-local addresses (never a host name). */
export function isPrivateAddress(address: string): boolean {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  const addr = mapped ? mapped[1] : address;
  const family = isIP(addr);
  if (family === 4) {
    const [a, b] = addr.split(".").map(Number);
    return (
      a === 10 ||
      a === 127 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254)
    );
  }
  if (family === 6) {
    const lower = addr.toLowerCase();
    if (lower === "::1") return true;
    const first = parseInt(lower.split(":")[0] || "0", 16);
    return (first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80;
  }
  return false;
}

function intIn(v: unknown, fallback: number, min: number, max: number): number {
  const n = typeof v === "number" && Number.isFinite(v) ? v : fallback;
  return Math.round(Math.min(max, Math.max(min, n)));
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/** Parse the `sessions` block of the plugin config; invalid API settings switch the API off. */
export function parseSessionsConfig(raw: unknown): { config: SessionsConfig; errors: string[] } {
  const s = obj(raw);
  const errors: string[] = [];
  const config: SessionsConfig = {
    enabled: s.enabled !== false,
    maxSessions: intIn(s.maxSessions, DEFAULT_MAX_SESSIONS, 100, 50_000),
  };
  const a = obj(s.api);
  if (a.enabled === true) {
    const bindAddress = str(a.bindAddress);
    const token = str(a.token);
    if (!isPrivateAddress(bindAddress)) {
      errors.push(
        "sessions.api.bindAddress must be a literal private or loopback IP address (not 0.0.0.0, not a host name), sessions API is off",
      );
    } else if (token !== "" && token.length < MIN_CONFIGURED_TOKEN_LENGTH) {
      errors.push(
        `sessions.api.token must be at least ${MIN_CONFIGURED_TOKEN_LENGTH} characters (or empty to generate one), sessions API is off`,
      );
    } else {
      config.api = {
        bindAddress,
        port: intIn(a.port, DEFAULT_API_PORT, 1024, 65535),
        ...(token !== "" ? { token } : {}),
      };
    }
  }
  return { config, errors };
}
