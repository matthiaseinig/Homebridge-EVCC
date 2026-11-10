import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { normalizeSessions } from "../../src/sessions/model.js";
import { cursorOf, parseCursor, SessionStore, STORE_FILE } from "../../src/sessions/store.js";
import { rawSession, tempDir } from "./fixtures.js";

const day = (n: number): string => `2026-03-${String(n).padStart(2, "0")}T08:00:00Z`;
const make = (ids: number[]) =>
  normalizeSessions(ids.map((id) => rawSession({ id, created: day(id), finished: day(id) })));

describe("SessionStore persistence", () => {
  it("writes 0600 JSON atomically and reloads it", async () => {
    const dir = tempDir();
    const store = new SessionStore(dir, 100);
    await store.update(make([1, 2, 3]), "EUR", 1_000);
    const file = join(dir, STORE_FILE);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(readdirSync(dir)).toEqual([STORE_FILE]);

    const again = new SessionStore(dir, 100);
    expect(await again.load()).toEqual({});
    expect(again.count).toBe(3);
    expect(again.currency).toBe("EUR");
    expect(again.lastUpdate).toBe(1_000);
    expect(again.list().map((s) => s.key)).toEqual(["id:1", "id:2", "id:3"]);
  });

  it("tightens a loose file mode on load", async () => {
    const dir = tempDir();
    await new SessionStore(dir, 100).update(make([1]), "", 1);
    chmodSync(join(dir, STORE_FILE), 0o644);
    await new SessionStore(dir, 100).load();
    expect(statSync(join(dir, STORE_FILE)).mode & 0o777).toBe(0o600);
  });

  it("starts empty without a file", async () => {
    const store = new SessionStore(tempDir(), 10);
    expect(await store.load()).toEqual({});
    expect(store.count).toBe(0);
    expect(store.lastUpdate).toBeNull();
  });

  it("moves an unreadable or foreign file aside instead of overwriting it", async () => {
    for (const content of ["not json", JSON.stringify({ schema: 99, sessions: [] })]) {
      const dir = tempDir();
      writeFileSync(join(dir, STORE_FILE), content);
      const store = new SessionStore(dir, 10);
      const result = await store.load(42);
      expect(result.backup).toBe(join(dir, `${STORE_FILE}.bak-42`));
      expect(readFileSync(result.backup!, "utf8")).toBe(content);
      expect(existsSync(join(dir, STORE_FILE))).toBe(false);
      expect(store.count).toBe(0);
    }
  });

  it("moves a file that cannot be read (any error except a missing file) aside, never overwrites it", async () => {
    const dir = tempDir();
    const file = join(dir, STORE_FILE);
    const content = JSON.stringify({ schema: 1, currency: "EUR", lastUpdate: 1, sessions: [] });
    writeFileSync(file, content);
    chmodSync(file, 0o000);
    const store = new SessionStore(dir, 10);
    const result = await store.load(7);
    expect(result.backup).toBe(join(dir, `${STORE_FILE}.bak-7`));
    expect(existsSync(file)).toBe(false);
    chmodSync(result.backup!, 0o600);
    expect(readFileSync(result.backup!, "utf8")).toBe(content);
    // A directory in place of the file is also a read error (EISDIR), not an empty start.
    const other = tempDir();
    mkdirSync(join(other, STORE_FILE));
    const second = await new SessionStore(other, 10).load(8);
    expect(second.backup).toBe(join(other, `${STORE_FILE}.bak-8`));
  });

  it("writes nothing when the unreadable file could not be moved aside", async () => {
    const dir = tempDir();
    const file = join(dir, STORE_FILE);
    const content = JSON.stringify({ schema: 1, currency: "EUR", lastUpdate: 1, sessions: [] });
    writeFileSync(file, content);
    chmodSync(file, 0o000);
    chmodSync(dir, 0o500); // no rename in this folder
    const store = new SessionStore(dir, 10);
    try {
      await expect(store.load(9)).rejects.toThrow();
    } finally {
      chmodSync(dir, 0o700);
    }
    await store.update(make([1]), "EUR", 5);
    chmodSync(file, 0o600);
    expect(readFileSync(file, "utf8")).toBe(content);
    expect(readdirSync(dir).filter((f) => f.includes("bak") || f.includes("tmp"))).toEqual([]);
  });

  it("skips stored entries that are not sessions", async () => {
    const dir = tempDir();
    writeFileSync(
      join(dir, STORE_FILE),
      JSON.stringify({
        schema: 1,
        currency: 5,
        lastUpdate: "x",
        sessions: [null, { key: 7 }, { key: "a", created: "bad" }, { key: "id:9", created: 1000 }],
      }),
    );
    const store = new SessionStore(dir, 10);
    await store.load();
    expect(store.list().map((s) => s.key)).toEqual(["id:9"]);
    expect(store.currency).toBe("");
    expect(store.lastUpdate).toBeNull();
  });

  it("does not rewrite an unchanged store", async () => {
    const dir = tempDir();
    const store = new SessionStore(dir, 10);
    await store.update(make([1]), "EUR", 5);
    const before = statSync(join(dir, STORE_FILE)).mtimeMs;
    await store.save();
    expect(statSync(join(dir, STORE_FILE)).mtimeMs).toBe(before);
  });

  it("reports a failed write and keeps working", async () => {
    const dir = tempDir();
    writeFileSync(join(dir, "blocker"), "x");
    const store = new SessionStore(join(dir, "blocker"), 10);
    await expect(store.update(make([1]), "", 1)).rejects.toBeTruthy();
    await expect(store.save()).rejects.toBeTruthy();
  });
});

describe("SessionStore content", () => {
  it("merges by key (newer wins) and keeps the currency when none is given", async () => {
    const store = new SessionStore(tempDir(), 10);
    await store.update(make([1, 2]), "EUR", 1);
    const changed = normalizeSessions([rawSession({ id: 2, created: day(2), chargedEnergy: 99 })]);
    await store.update(changed, "", 2);
    expect(store.count).toBe(2);
    expect(store.list()[1].chargedKWh).toBe(99);
    expect(store.currency).toBe("EUR");
    expect(store.lastError).toBeNull();
  });

  it("drops the oldest sessions beyond the bound", async () => {
    const store = new SessionStore(tempDir(), 3);
    await store.update(make([1, 2, 3, 4, 5]), "", 1);
    expect(store.list().map((s) => s.key)).toEqual(["id:3", "id:4", "id:5"]);
  });

  it("filters by range and loadpoint", async () => {
    const store = new SessionStore(tempDir(), 10);
    const other = normalizeSessions([rawSession({ id: 9, created: day(9), loadpoint: "Carport" })]);
    await store.update([...make([1, 2, 3]), ...other], "", 1);
    const from = Date.parse(day(2));
    const to = Date.parse(day(3));
    expect(store.list({ fromMs: from, toMs: to }).map((s) => s.key)).toEqual(["id:2"]);
    expect(store.list({ fromMs: from }).map((s) => s.key)).toEqual(["id:2", "id:3", "id:9"]);
    expect(store.forLoadpoint("Carport").map((s) => s.key)).toEqual(["id:9"]);
    expect(store.forLoadpoint("None")).toEqual([]);
  });

  it("pages with a stable cursor, also across equal start times", async () => {
    const store = new SessionStore(tempDir(), 20);
    const same = normalizeSessions([5, 6, 7].map((id) => rawSession({ id, created: day(5) })));
    await store.update([...make([1, 2, 3]), ...same], "", 1);
    const first = store.page({}, undefined, 4);
    expect(first.sessions.map((s) => s.key)).toEqual(["id:1", "id:2", "id:3", "id:5"]);
    expect(first.next).not.toBeNull();
    const second = store.page({}, first.next!, 4);
    expect(second.sessions.map((s) => s.key)).toEqual(["id:6", "id:7"]);
    expect(second.next).toBeNull();
  });

  it("returns an empty page for a cursor beyond the end", async () => {
    const store = new SessionStore(tempDir(), 20);
    await store.update(make([1, 2]), "", 1);
    expect(store.page({}, `${Date.parse(day(30))}.id:1`, 5)).toEqual({ sessions: [], next: null });
    // A malformed cursor sorts before everything, so the page starts at the first session.
    expect(store.page({}, "garbage", 5).sessions).toHaveLength(2);
  });

  it("round trips cursors", () => {
    const s = make([4])[0];
    expect(parseCursor(cursorOf(s))).toEqual({ created: s.created, key: "id:4" });
    expect(parseCursor("x.y")).toBeUndefined();
    expect(parseCursor("123")).toBeUndefined();
  });
});
