import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createAmbientShotStore } from "./ambient-shot-store.ts";

const PNG_B64 = Buffer.from("fake-png-bytes").toString("base64");
const AT = Date.parse("2026-07-26T10:00:00.000Z");

let root: string;
let ambientDir: string;

function store() {
  return createAmbientShotStore({ ambientDir });
}

function age(path: string, ms: number): void {
  const when = new Date(ms);
  utimesSync(path, when, when);
}

describe("createAmbientShotStore", () => {
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "taki-ambient-store-"));
    ambientDir = join(root, "ambient-screenshots");
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("writes the frame into its OWN directory under a prefixed timestamp name", () => {
    const saved = store().save(PNG_B64, AT);
    expect(saved?.name).toMatch(/^ambient-2026-07-26T10-00-00\.000Z-[a-f0-9-]{36}\.png$/);
    expect(saved?.bytes).toBe(14);
    expect(readdirSync(ambientDir)).toEqual([saved?.name]);
  });

  it("cannot sweep an ON-DEMAND capture even when pointed at the on-demand directory (structural, not wired)", () => {
    // The two stores share a timestamp shape; only the `ambient-` prefix keeps this automatic, aggressive sweeper off
    // a user-requested capture. RED if the prefix is ever dropped: a misconfigured dir would then delete chat history's
    // screenshots (their paths live in tool results — D46).
    mkdirSync(ambientDir, { recursive: true });
    const onDemand = join(ambientDir, "2026-07-26T10-00-00.000Z.png"); // the screenshot-store filename shape
    writeFileSync(onDemand, "a user-requested capture");
    age(onDemand, AT);
    const ours = store().save(PNG_B64, AT)!;
    age(join(ambientDir, ours.name), AT);

    expect(store().sweepOlderThan(AT + 30_000).removedCount).toBe(1);
    expect(readdirSync(ambientDir)).toEqual(["2026-07-26T10-00-00.000Z.png"]);
    store().discard("2026-07-26T10-00-00.000Z.png"); // nor can it be addressed by name
    expect(existsSync(onDemand)).toBe(true);
  });

  it("discards only its own frames — a foreign name is a no-op, never an fs reach", () => {
    const saved = store().save(PNG_B64, AT);
    // A traversal / foreign name cannot even be expressed: discard validates the name shape before any fs call.
    writeFileSync(join(root, "on-demand.png"), "keep me");
    store().discard("../on-demand.png");
    store().discard("on-demand.png");
    expect(existsSync(join(root, "on-demand.png"))).toBe(true);

    store().discard(saved!.name);
    expect(readdirSync(ambientDir)).toHaveLength(0);
    store().discard(saved!.name); // already gone: still a no-op, never a throw
  });

  it("sweeps only past-cutoff ambient frames, never a newer one and never a foreign file", () => {
    const old = store().save(PNG_B64, AT)!;
    const fresh = store().save(PNG_B64, AT + 60_000)!;
    age(join(ambientDir, old.name), AT);
    age(join(ambientDir, fresh.name), AT + 60_000);
    // A hand-dropped file inside the ambient dir and a sibling outside it must both survive every sweep.
    const stray = join(ambientDir, "notes.txt");
    writeFileSync(stray, "not ours");
    age(stray, AT);
    const outside = join(root, "ambient-2026-07-26T10-00-00.000Z.png"); // ambient-SHAPED, but in the parent dir
    writeFileSync(outside, "an on-demand capture");
    age(outside, AT);

    const swept = store().sweepOlderThan(AT + 30_000);
    expect(swept.removedCount).toBe(1);
    expect(swept.freedBytes).toBe(14);
    expect(readdirSync(ambientDir).sort()).toEqual([fresh.name, "notes.txt"].sort());
    expect(existsSync(outside)).toBe(true);
  });

  it("treats a missing directory as an empty sweep (nothing captured yet)", () => {
    expect(store().sweepOlderThan(AT)).toEqual({ removedCount: 0, freedBytes: 0 });
  });

  it("protects live frames across store instances, then allows crash-backstop sweeping after release", () => {
    const saved = store().save(PNG_B64, AT)!; age(join(ambientDir, saved.name), AT);
    const release = store().protect!(saved.name);
    expect(store().sweepOlderThan(AT + 60_000).removedCount).toBe(0);
    expect(existsSync(join(ambientDir, saved.name))).toBe(true);
    release(); release(); expect(store().sweepOlderThan(AT + 60_000).removedCount).toBe(1);
  });

  it("does not overwrite a live capture when another producer saves in the same millisecond", () => {
    const first = store().save(PNG_B64, AT)!; const second = store().save(PNG_B64, AT)!;
    expect(first.name).not.toBe(second.name); expect(readdirSync(ambientDir)).toHaveLength(2);
  });

  it("degrades to null instead of throwing when the frame cannot be written", () => {
    // A file where the directory should be: mkdir/write fail, perception must carry on with transient native input.
    mkdirSync(root, { recursive: true });
    writeFileSync(ambientDir, "not a directory");
    expect(store().save(PNG_B64, AT)).toBeNull();
  });
});
