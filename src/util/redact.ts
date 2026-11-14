/**
 * Describe a secret for log output without revealing any part of it: only
 * whether one is configured.
 */
export function describeSecret(value: string | undefined): "configured" | "not configured" {
  return value ? "configured" : "not configured";
}

/**
 * Strip credentials (user:password@) from a URL before logging it. Input that
 * does not parse as a URL is replaced entirely rather than risk leaking it.
 */
export function redactUrl(value: string | undefined): string {
  if (!value) return "(none)";
  try {
    const u = new URL(value);
    if (u.username || u.password) {
      u.username = "";
      u.password = "";
      return u.toString().replace(/^([a-z]+:\/\/)/i, "$1***@");
    }
    return value;
  } catch {
    return "(invalid url)";
  }
}

const URL_CREDENTIALS = /([a-z][a-z0-9+.-]*:\/\/)[^\s/?#@]*@/gi;

/**
 * Text of an error (or any thrown value) that is safe to log: credentials
 * embedded in URLs (scheme://user:pass@host) are removed, and every given
 * secret value is replaced, so a fetch error that quotes the request URL
 * cannot leak them.
 */
export function errorText(err: unknown, ...secrets: Array<string | undefined>): string {
  let text = err instanceof Error ? err.message : String(err);
  text = text.replace(URL_CREDENTIALS, "$1***@");
  for (const secret of secrets) {
    if (secret) text = text.split(secret).join("***");
  }
  return text;
}
