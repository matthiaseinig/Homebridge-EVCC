import { describe, expect, it } from "vitest";
import {
  DEFAULT_API_PORT,
  DEFAULT_MAX_SESSIONS,
  isPrivateAddress,
  parseSessionsConfig,
} from "../../src/sessions/config.js";

describe("isPrivateAddress", () => {
  it("accepts loopback, private, link-local and unique-local addresses", () => {
    for (const a of [
      "127.0.0.1",
      "10.1.2.3",
      "172.16.0.1",
      "172.31.255.1",
      "192.168.1.5",
      "169.254.1.1",
      "::1",
      "fd00::1",
      "fe80::1",
      "::ffff:192.168.1.5",
    ]) {
      expect(isPrivateAddress(a), a).toBe(true);
    }
  });

  it("rejects public addresses, wildcards and names", () => {
    for (const a of [
      "0.0.0.0",
      "::",
      "8.8.8.8",
      "172.32.0.1",
      "172.15.0.1",
      "2001:db8::1",
      "localhost",
      "",
      "192.168.1.5.1",
      "::ffff:8.8.8.8",
    ]) {
      expect(isPrivateAddress(a), a).toBe(false);
    }
  });
});

describe("parseSessionsConfig", () => {
  it("defaults to enabled history and no API", () => {
    expect(parseSessionsConfig(undefined)).toEqual({
      config: { enabled: true, maxSessions: DEFAULT_MAX_SESSIONS },
      errors: [],
    });
    expect(parseSessionsConfig("junk").config.enabled).toBe(true);
    expect(parseSessionsConfig([]).config.enabled).toBe(true);
  });

  it("can switch the history off and bounds maxSessions", () => {
    expect(parseSessionsConfig({ enabled: false }).config.enabled).toBe(false);
    expect(parseSessionsConfig({ maxSessions: 5 }).config.maxSessions).toBe(100);
    expect(parseSessionsConfig({ maxSessions: 1e9 }).config.maxSessions).toBe(50_000);
    expect(parseSessionsConfig({ maxSessions: "x" }).config.maxSessions).toBe(DEFAULT_MAX_SESSIONS);
  });

  it("enables the API only with a private bind address", () => {
    const ok = parseSessionsConfig({ api: { enabled: true, bindAddress: " 192.168.1.10 " } });
    expect(ok.config.api).toEqual({ bindAddress: "192.168.1.10", port: DEFAULT_API_PORT });
    expect(ok.errors).toEqual([]);
    for (const bindAddress of ["0.0.0.0", "evcc.local", "", undefined]) {
      const bad = parseSessionsConfig({ api: { enabled: true, bindAddress } });
      expect(bad.config.api).toBeUndefined();
      expect(bad.errors[0]).toContain("bindAddress");
    }
  });

  it("rejects a zoned link-local bind address and turns the API off with a message", () => {
    for (const bindAddress of ["fe80::1%en0", "fe80::1%1", "FE80::abcd%eth0"]) {
      const bad = parseSessionsConfig({ api: { enabled: true, bindAddress } });
      expect(bad.config.api).toBeUndefined();
      expect(bad.errors[0]).toContain("zone");
    }
    expect(
      parseSessionsConfig({ api: { enabled: true, bindAddress: "fe80::1" } }).config.api,
    ).toBeDefined();
  });

  it("keeps the API off unless it is enabled", () => {
    expect(parseSessionsConfig({ api: { bindAddress: "127.0.0.1" } }).config.api).toBeUndefined();
  });

  it("bounds the port and checks a configured token", () => {
    const api = (over: object) =>
      parseSessionsConfig({ api: { enabled: true, bindAddress: "127.0.0.1", ...over } });
    expect(api({ port: 80 }).config.api?.port).toBe(1024);
    expect(api({ port: 70000 }).config.api?.port).toBe(65535);
    expect(api({ port: 9000 }).config.api?.port).toBe(9000);
    expect(api({ token: "x".repeat(16) }).config.api?.token).toBe("x".repeat(16));
    expect(api({ token: "" }).config.api?.token).toBeUndefined();
    const short = api({ token: "short" });
    expect(short.config.api).toBeUndefined();
    expect(short.errors[0]).toContain("token");
  });
});
