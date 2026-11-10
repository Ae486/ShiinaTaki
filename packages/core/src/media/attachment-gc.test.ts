import { mkdtempSync, rmSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createCaptureLogger } from "../testing/capture-logger.ts";
import { startAttachmentGc } from "./attachment-gc.ts";
import { createAttachmentStore } from "./attachment-store.ts";

const DAY = 24 * 60 * 60 * 1000;
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it("uses the current retention for reads and future sweeps, and stops its schedule", () => {
  const dir = mkdtempSync(join(tmpdir(), "taki-attachment-policy-"));
  let ttl = 7 * DAY;
  const store = createAttachmentStore({ attachmentsDir: dir, ttlMs: () => ttl });
  const { logger } = createCaptureLogger();
  const saved = store.save("AAAA", "image/png");
  const old = new Date(Date.now() - 2 * DAY);
  utimesSync(join(dir, saved.ref.slice("attachments/".length)), old, old);
  const gc = startAttachmentGc({ store, ttlMs: () => ttl, logger });
  try {
    expect(store.read(saved.ref).ok).toBe(true);
    ttl = DAY;
    expect(store.read(saved.ref)).toEqual({ ok: false, code: "EXPIRED" });
    expect(store.usage().count).toBe(1);
    vi.advanceTimersByTime(6 * 60 * 60 * 1000);
    expect(store.usage().count).toBe(0);
    ttl = 7 * DAY;
    expect(store.read(saved.ref)).toEqual({ ok: false, code: "NOT_FOUND" });
    gc.stop();
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    gc.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});
