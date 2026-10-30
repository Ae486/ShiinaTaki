import { describe, expect, it, vi } from "vitest";
import type { ForegroundWindowOutput } from "@taki/shared";
import { createPerceptionEvidence } from "./perception-evidence.ts";

function setup() {
  let generation = 1;
  let catalog = 1;
  let paused = false;
  let at = 1000;
  const onChange = vi.fn();
  const onRetire = vi.fn();
  const evidence = createPerceptionEvidence({ isPaused: () => paused, freshnessMs: 60000, onChange, onRetire });
  const sample = (patch: Partial<ForegroundWindowOutput> = {}) => {
    const captured = generation;
    const capturedCatalog = catalog;
    return evidence.acceptForeground({ epoch: evidence.generation(), observedAt: at,
      sample: { available: true, processName: "Editor", windowTitle: "private title", idleSeconds: 0, ...patch },
      provenance: { hostId: "host", connectionGeneration: captured, catalogGeneration: capturedCatalog,
        isCurrent: () => generation === captured && catalog === capturedCatalog },
    });
  };
  return { evidence, sample, onChange, onRetire, now: () => at, advance: (delta = 30000) => { at += delta; },
    replace: () => { generation++; }, replaceCatalog: () => { catalog++; }, pause: (value: boolean) => { paused = value; evidence.retire(); } };
}

describe("accepted foreground continuity for initiative", () => {
  it("requires consecutive accepted samples, keeps one occurrence and never exposes window titles", () => {
    const f = setup();
    f.sample();
    const first = f.evidence.foreground(f.now())!;
    expect(first).toMatchObject({ meaningful: false, startedAt: 1000, observedAt: 1000, application: "Editor", idleSeconds: 0 });
    expect(JSON.stringify(first)).not.toContain("private title");
    f.advance(); f.sample({ windowTitle: "another private title" });
    const next = f.evidence.foreground(f.now())!;
    expect(next).toMatchObject({ occurrenceKey: first.occurrenceKey, startedAt: first.startedAt, meaningful: true, observedAt: 31000 });
    f.advance(); f.sample();
    expect(f.evidence.foreground(f.now())?.occurrenceKey).toBe(first.occurrenceKey);
    Object.assign(next, { application: "tampered" });
    expect(f.evidence.foreground(f.now())?.application).toBe("Editor");
    expect(f.onChange).not.toHaveBeenCalled();
  });

  it.each(["app", "idle", "unknown", "gap", "duplicate-time"] as const)("splits %s without carrying earlier dwell", (kind) => {
    const f = setup(); f.sample(); f.advance(); f.sample();
    const before = f.evidence.foreground(f.now())!;
    if (kind !== "duplicate-time") f.advance(kind === "gap" ? 60000 : 30000);
    const patch = kind === "app" ? { processName: "Browser" } : kind === "idle" ? { idleSeconds: 180 }
      : kind === "unknown" ? { idleSeconds: null } : {};
    f.sample(patch);
    const first = f.evidence.foreground(f.now())!;
    expect(first).toMatchObject({ meaningful: false, startedAt: f.now() });
    expect(first.occurrenceKey).not.toBe(before.occurrenceKey);
    f.advance(); f.sample(patch);
    expect(f.evidence.foreground(f.now())).toMatchObject({ meaningful: true, startedAt: first.startedAt, occurrenceKey: first.occurrenceKey });
    if (kind === "unknown") expect(f.evidence.foreground(f.now())?.idleSeconds).toBeNull();
  });

  it.each(["host", "catalog", "pause", "reject"] as const)("retires %s and requires new same-source dwell", (kind) => {
    const f = setup(); f.sample(); f.advance(); f.sample();
    const before = f.evidence.foreground(f.now())!;
    if (kind === "host") f.replace();
    if (kind === "catalog") f.replaceCatalog();
    if (kind === "pause") f.pause(true);
    if (kind === "reject") f.evidence.reject();
    expect(f.evidence.foreground(f.now())).toBeUndefined();
    if (kind === "pause") f.pause(false);
    f.advance(); f.sample();
    expect(f.evidence.foreground(f.now())).toMatchObject({ meaningful: false, startedAt: f.now() });
    expect(f.evidence.foreground(f.now())?.occurrenceKey).not.toBe(before.occurrenceKey);
    f.advance(); f.sample();
    expect(f.evidence.foreground(f.now())?.meaningful).toBe(true);
  });

  it("never repairs unavailable, missing-provenance, malformed-label or expired sources", () => {
    const f = setup(); f.sample(); f.advance(); f.sample();
    expect(f.evidence.foreground(f.now() - 1)).toBeUndefined();
    expect(f.evidence.foreground(f.now() + 60000)).toBeUndefined();
    f.advance(); expect(f.sample({ available: false })).toBe(false);
    expect(f.evidence.foreground(f.now())).toBeUndefined();
    f.advance(); f.sample({ processName: "x".repeat(121) });
    expect(f.evidence.foreground(f.now())).toBeUndefined();
    f.evidence.acceptForeground({ epoch: f.evidence.generation(), observedAt: f.now(),
      sample: { available: true, processName: "Editor", windowTitle: "ignored", idleSeconds: 0 } });
    expect(f.evidence.foreground(f.now())).toBeUndefined();
  });
});
