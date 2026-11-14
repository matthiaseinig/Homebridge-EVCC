import { randomBytes } from "node:crypto";
import { chmod, readFile } from "node:fs/promises";
import { join } from "node:path";
import { FILE_MODE, writeFileAtomic } from "./fsutil.js";

export const TOKEN_FILE = "evcc-sessions-token";
export const MIN_TOKEN_LENGTH = 32;
/** Shortest token accepted from the plugin config. */
export const MIN_CONFIGURED_TOKEN_LENGTH = 16;

export interface ApiToken {
  token: string;
  /** Set when the token lives in a file (not in the config). */
  file?: string;
  generated: boolean;
}

/**
 * The API always needs a token. A configured token wins; otherwise one is read
 * from (or generated into) a 0600 file in the storage folder.
 */
export async function resolveApiToken(dir: string, configured?: string): Promise<ApiToken> {
  if (configured) return { token: configured, generated: false };
  const file = join(dir, TOKEN_FILE);
  try {
    const existing = (await readFile(file, "utf8")).trim();
    if (existing.length >= MIN_TOKEN_LENGTH) {
      await chmod(file, FILE_MODE);
      return { token: existing, file, generated: false };
    }
  } catch {
    // missing or unreadable: generate below
  }
  const token = randomBytes(32).toString("hex");
  await writeFileAtomic(file, `${token}\n`);
  return { token, file, generated: true };
}
