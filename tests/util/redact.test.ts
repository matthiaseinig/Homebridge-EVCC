import { describe, expect, it } from "vitest";
import { redactSecret } from "../../src/util/redact.js";

describe("redactSecret", () => {
  it("returns (none) for empty/undefined", () => {
    expect(redactSecret(undefined)).toBe("(none)");
    expect(redactSecret("")).toBe("(none)");
  });

  it("masks short strings (4 or fewer)", () => {
    expect(redactSecret("ab")).toBe("ab***");
    expect(redactSecret("abcd")).toBe("ab***");
  });

  it("masks medium strings (5-8) with leading and trailing chars", () => {
    expect(redactSecret("abcde")).toBe("ab***e");
    expect(redactSecret("abcdefgh")).toBe("ab***h");
  });

  it("masks long strings with 4 leading and 2 trailing chars", () => {
    expect(redactSecret("ABCDEFGHIJK")).toBe("ABCD***JK");
  });
});
