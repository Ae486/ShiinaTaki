import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAttachmentStore, type AttachmentStore } from "./attachment-store.ts";

const roots: string[] = [];
function fresh(): { store: AttachmentStore; dir: string } {
  const root = mkdtempSync(join(tmpdir(), "taki-attach-"));
  roots.push(root);
  const dir = join(root, "attachments");
  return { store: createAttachmentStore({ attachmentsDir: dir }), dir };
}
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

// "hello" as base64 — content-addressing hashes the DECODED bytes, so the ref is stable across saves.
const HELLO = Buffer.from("hello").toString("base64");

describe("createAttachmentStore save/read (T4)", () => {
  it("round-trips the same bytes and media type through a content-addressed ref", () => {
    const { store } = fresh();
    const saved = store.save(HELLO, "image/png");
    expect(saved.ref).toMatch(/^attachments\/[a-f0-9]{64}\.png$/);
    expect(saved.bytes).toBe(5);

    const read = store.read(saved.ref);
    expect(read).toEqual({ ok: true, mediaType: "image/png", dataBase64: HELLO });
  });

  it("maps each media type to its extension", () => {
    const { store } = fresh();
    expect(store.save(HELLO, "image/jpeg").ref).toMatch(/\.jpg$/);
    expect(store.save(HELLO, "image/webp").ref).toMatch(/\.webp$/);
    expect(store.save(HELLO, "image/gif").ref).toMatch(/\.gif$/);
  });

  it("dedups identical bytes to one file and refreshes its mtime (TTL restart)", () => {
    const { store, dir } = fresh();
    const first = store.save(HELLO, "image/png");
    const path = join(dir, first.ref.slice("attachments/".length));
    // Age the file well into the past, then re-save identical bytes: the dedup path must touch mtime forward.
    const past = new Date(Date.now() - 60_000);
    utimesSync(path, past, past);
    const agedMtime = statSync(path).mtimeMs;

    const second = store.save(HELLO, "image/png");
    expect(second.ref).toBe(first.ref);
    expect(readdirSync(dir)).toHaveLength(1); // one file, not two
    expect(statSync(path).mtimeMs).toBeGreaterThan(agedMtime);
  });
});

describe("createAttachmentStore read confinement (T4 — the security surface)", () => {
  it.each([
    "../../etc/passwd",
    "/etc/passwd",
    "attachments/../secret.png",
    "attachments\\..\\secret.png", // backslash separators — the regex admits only ASCII "/"
    "attachments/short.png", // hash not 64 hex
    `attachments/${"a".repeat(64)}.exe`, // ext not in the allow-set
    `attachments/${"A".repeat(64)}.png`, // uppercase hex — regex demands lowercase
    `attachments/${"a".repeat(64)}.PNG`, // uppercase ext — no `i` flag, ever
    `attachments/${"a".repeat(64)}.png:zone`, // NTFS alternate data stream suffix
    `attachments/${"a".repeat(64)}.png\n`, // trailing newline — JS `$` without `m` must not match
    `attachments/${"a".repeat(64)}.png.png`, // double extension
    `${"a".repeat(64)}.png`, // missing namespace prefix
  ])("rejects a malformed/traversal ref before any fs: %s", (ref) => {
    // Point at a dir that does NOT exist: an INVALID_REF (not NOT_FOUND) proves the regex rejected before touching fs.
    const store = createAttachmentStore({ attachmentsDir: join(tmpdir(), "taki-attach-does-not-exist") });
    expect(store.read(ref)).toEqual({ ok: false, code: "INVALID_REF" });
  });

  it("rejects a well-formed but absent ref as NOT_FOUND (after the regex passes)", () => {
    const { store } = fresh();
    expect(store.read(`attachments/${"b".repeat(64)}.png`)).toEqual({ ok: false, code: "NOT_FOUND" });
  });
});

describe("createAttachmentStore lifecycle (T4)", () => {
  it("sweepExpired deletes only files older than the ttl", () => {
    const { store, dir } = fresh();
    const stale = store.save(Buffer.from("old").toString("base64"), "image/png");
    const fresh1 = store.save(Buffer.from("new").toString("base64"), "image/png");
    // Age only the stale file 10 minutes back; a 5-minute ttl must remove it and keep the fresh one.
    const stalePath = join(dir, stale.ref.slice("attachments/".length));
    const old = new Date(Date.now() - 600_000);
    utimesSync(stalePath, old, old);

    const swept = store.sweepExpired(300_000);
    expect(swept.removedCount).toBe(1);
    expect(swept.freedBytes).toBe(3);
    expect(existsSync(stalePath)).toBe(false);
    expect(store.read(fresh1.ref).ok).toBe(true);
  });

  it("usage reports count + bytes, and zeros for a never-created dir", () => {
    const { store } = fresh();
    expect(store.usage()).toEqual({ count: 0, bytes: 0 });
    store.save(HELLO, "image/png");
    store.save(Buffer.from("world!").toString("base64"), "image/jpeg");
    expect(store.usage()).toEqual({ count: 2, bytes: 11 }); // 5 + 6 bytes
  });

  it("clear purges everything and reports what it freed", () => {
    const { store, dir } = fresh();
    store.save(HELLO, "image/png");
    store.save(Buffer.from("world!").toString("base64"), "image/jpeg");
    const cleared = store.clear();
    expect(cleared).toEqual({ removedCount: 2, freedBytes: 11 });
    expect(readdirSync(dir)).toHaveLength(0);
    expect(store.usage()).toEqual({ count: 0, bytes: 0 });
  });
});
