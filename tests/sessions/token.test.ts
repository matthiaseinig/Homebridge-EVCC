import { chmodSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MIN_TOKEN_LENGTH, resolveApiToken, TOKEN_FILE } from "../../src/sessions/token.js";
import { tempDir } from "./fixtures.js";

describe("resolveApiToken", () => {
  it("prefers the configured token and writes no file", async () => {
    const dir = tempDir();
    expect(await resolveApiToken(dir, "configured-token-value")).toEqual({
      token: "configured-token-value",
      generated: false,
    });
    expect(() => statSync(join(dir, TOKEN_FILE))).toThrow();
  });

  it("generates a 0600 token file once and reuses it", async () => {
    const dir = tempDir();
    const first = await resolveApiToken(dir);
    expect(first.generated).toBe(true);
    expect(first.token).toMatch(/^[0-9a-f]{64}$/);
    expect(statSync(first.file!).mode & 0o777).toBe(0o600);
    const second = await resolveApiToken(dir);
    expect(second).toMatchObject({ token: first.token, generated: false, file: first.file });
  });

  it("tightens the mode of an existing file and replaces a too short one", async () => {
    const dir = tempDir();
    const file = join(dir, TOKEN_FILE);
    const good = "a".repeat(MIN_TOKEN_LENGTH);
    writeFileSync(file, `${good}\n`);
    chmodSync(file, 0o644);
    expect((await resolveApiToken(dir)).token).toBe(good);
    expect(statSync(file).mode & 0o777).toBe(0o600);

    writeFileSync(file, "short\n");
    const fresh = await resolveApiToken(dir);
    expect(fresh.generated).toBe(true);
    expect(readFileSync(file, "utf8").trim()).toBe(fresh.token);
  });
});
