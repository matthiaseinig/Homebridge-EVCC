import { describe, expect, it } from "vitest";
import { describeSecret, errorText, redactUrl } from "../../src/util/redact.js";

describe("describeSecret", () => {
  it("reports only whether a secret is configured", () => {
    expect(describeSecret(undefined)).toBe("not configured");
    expect(describeSecret("")).toBe("not configured");
    expect(describeSecret("a")).toBe("configured");
    expect(describeSecret("correct horse battery staple")).toBe("configured");
  });
});

describe("redactUrl", () => {
  it("passes a URL without credentials through unchanged", () => {
    expect(redactUrl("http://evcc.local:7070")).toBe("http://evcc.local:7070");
  });

  it("strips user and password from the URL", () => {
    const out = redactUrl("http://admin:s3cret@evcc.local:7070/api");
    expect(out).toBe("http://***@evcc.local:7070/api");
    expect(out).not.toContain("admin");
    expect(out).not.toContain("s3cret");
  });

  it("handles empty and unparseable input without echoing it", () => {
    expect(redactUrl(undefined)).toBe("(none)");
    expect(redactUrl("not a url with secret")).toBe("(invalid url)");
  });
});

describe("errorText", () => {
  it("strips URL credentials from an error message", () => {
    const err = new TypeError(
      "fetch failed: https://u:p%40ss@evcc.local/api/state and ws://x:y@h/ws",
    );
    expect(errorText(err)).toBe("fetch failed: https://***@evcc.local/api/state and ws://***@h/ws");
  });

  it("replaces every occurrence of the given secrets and ignores empty ones", () => {
    expect(errorText(new Error("bad pw hunter2 / hunter2"), "hunter2", undefined, "")).toBe(
      "bad pw *** / ***",
    );
  });

  it("handles non-Error values and leaves clean messages alone", () => {
    expect(errorText("plain http://a:b@h")).toBe("plain http://***@h");
    expect(errorText(new Error("connect refused"))).toBe("connect refused");
  });
});
