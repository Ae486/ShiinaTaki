import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { InteractionPatternContextSelector } from "@taki/shared";
import { createInitiativeContextBuilder } from "./initiative-context-builder.ts";
import type { WakeSelection } from "./wake/wake-contract.ts";
import { createMemoryRunReference } from "../memory/memory-capability-snapshot.ts";
import { LOCAL_MEMORY_CAPABILITIES } from "../memory/local-memory-provider.ts";
import { captureInitiativeMemoryAssembly } from "../memory/initiative-memory-assembly.ts";
import type { CapturedMemoryRun } from "../memory/canonical-memory-run.ts";
import { hindsightRuntimeFixture, type HindsightRuntimeFixture } from "../testing/hindsight-runtime-composition-fixtures.ts";
import { createStructuredMemoryBlockRepo } from "../db/structured-memory-block-repo.ts";
import { createBlockStore } from "../memory/block-store.ts";
import { createScreenContext, renderScreenContext } from "../perception/screen-context.ts";
import { renderWallClock } from "../time/time-context.ts";

const NOW = Date.parse("2026-09-28T12:00:00.000Z");
const fixtures: HindsightRuntimeFixture[] = [];
const builders: ReturnType<typeof createInitiativeContextBuilder>[] = [];
afterEach(async () => {
  for (const builder of builders.splice(0)) builder.close();
  for (const fixture of fixtures.splice(0)) await fixture.close();
  vi.useRealTimers();
});
function selection(selectors: InteractionPatternContextSelector[] = []): WakeSelection {
  return { opportunityId: "opportunity", sourceKey: "clock-window", characterId: "taki", capturedAt: NOW, expiresAt: NOW + 600_000,
    snapshot: { enabled: true, targetId: "taki", targetReady: true, policyRevision: "policy", timezone: "Asia/Shanghai",
      timezoneRevision: 7, primaryVersion: 3, privacyPaused: false, presence: "unknown", foreground: null,
      presenceReturn: null, completions: [], intentions: [] },
    candidates: [{ kind: "pattern", candidateId: "candidate", patternId: "pattern", patternVersion: 2, revisionId: "accepted",
      source: "clock", occurrenceKey: "window-occurrence", sourceKey: "clock-window", sourceRevision: "7", dueAt: NOW,
      expiresAt: NOW + 600_000, sampling: false, causeRunId: null,
      definition: { title: "Reflection", purpose: "Consider a check-in under current evidence", conditions: { all: [
        { kind: "local_time_window", start: "19:00", end: "21:00", daysOfWeek: [1] }] }, contextSelectors: selectors,
      allowedOutcomes: ["silent", "express"], timing: { minimumGapMinutes: 60, chance: 1 }, lifetime: { startsAt: null, expiresAt: null } } }] };
}
function memory(): CapturedMemoryRun {
  return { snapshot: createMemoryRunReference({ providerId: "local", contractVersion: 1, capabilities: LOCAL_MEMORY_CAPABILITIES }),
    tools: {}, isCurrent: () => true, prompt: "Stable runtime rules",
    assembleInitiative: captureInitiativeMemoryAssembly({ characterId: "taki",
      persona: { assistantLayer: () => "ASSISTANT", persona: () => "PERSONA" } }) };
}
function builder(overrides: Partial<Parameters<typeof createInitiativeContextBuilder>[0]> = {}) {
  const captureMemory = vi.fn(async () => memory()); const screenContext = vi.fn(() => "");
  const created = createInitiativeContextBuilder({ captureMemory, screenContext, avatarContext: () => "Dynamic Avatar vocabulary", now: () => NOW, ...overrides });
  builders.push(created); return { builder: created, captureMemory, screenContext };
}

describe("initiative thin context construction", () => {
  it.each(["local", "legacy", "hindsight"] as const)("uses actual %s Memory capture and selected scopes without auto-recall", async (mode) => {
    const f = hindsightRuntimeFixture({ mode }); fixtures.push(f);
    mkdirSync(join(f.promptDir, "system"), { recursive: true }); mkdirSync(join(f.promptDir, "characters", "taki"), { recursive: true });
    writeFileSync(join(f.promptDir, "system", "assistant-layer.md"), "ACTUAL_ASSISTANT", "utf8");
    writeFileSync(join(f.promptDir, "characters", "taki", "persona.md"), "ACTUAL_PERSONA", "utf8");
    if (mode === "legacy") {
      const blocks = createBlockStore({ root: join(f.dataDir, "workspace", "blocks") });
      blocks.writeBlock({ id: "user-card", caller: "user", content: "GLOBAL_SCOPE_ONLY" });
      blocks.writeBlock({ id: "memory-index", characterId: "taki", caller: "background", content: "CHARACTER_SCOPE_ONLY" });
    } else {
      const blocks = createStructuredMemoryBlockRepo(f.db);
      blocks.replace({ blockId: "user-card", scope: { kind: "global", characterId: null }, actor: "user", content: "GLOBAL_SCOPE_ONLY" });
      blocks.replace({ blockId: "memory-index", scope: { kind: "character", characterId: "taki" }, actor: "background", content: "CHARACTER_SCOPE_ONLY" });
    }
    const runtime = f.compose(); const capture = vi.fn((id: string, signal?: AbortSignal) => runtime.captureRun(id, signal));
    const { builder: context } = builder({ captureMemory: capture });
    const built = await context.prepare(selection(["memory_global"]));
    expect(capture).toHaveBeenCalledExactlyOnceWith("taki", expect.any(AbortSignal));
    expect(built?.instructions).toContain("ACTUAL_PERSONA"); expect(built?.instructions).toContain("GLOBAL_SCOPE_ONLY");
    expect(built?.instructions).not.toContain("CHARACTER_SCOPE_ONLY");
    expect(f.remote.calls.some((call) => call.operation === "recall-native")).toBe(false);
    expect(f.db.prepare("SELECT count(*) AS n FROM timeline_messages").get()?.n).toBe(0);
    expect(built?.candidatePolicies).toEqual([{ candidateId: "candidate", allowedOutcomes: ["silent", "express"] }]);
  });

  it("uses the shared User Timezone renderer, source facts and structural candidate policy", async () => {
    const { builder: context } = builder(); const offered = selection(["presence"]);
    offered.candidates[0]!.source = "completion"; offered.candidates[0]!.occurrenceKey = "completed-run";
    const built = await context.prepare(offered);
    expect(built?.controlInput).toContain(`User time: ${renderWallClock(NOW, "Asia/Shanghai")}`);
    expect(built?.manifest.sources).toContainEqual({ category: "completion", reference: "completed-run", revision: "7", trust: "core" });
    expect(built?.manifest).toMatchObject({ primaryVersion: 3, timezoneRevision: 7, policyRevision: "policy", accountingQuality: "unknown" });
    expect(built?.controlInput).toContain("User presence evidence: unknown. This is not proof of reading.");
    expect(built?.manifest.sources).toContainEqual({ category: "observation", reference: "user-presence-projection",
      revision: expect.stringMatching(/^[a-f0-9]{64}$/), trust: "core" });
    expect(built?.allowedToolNames).not.toContain("recall");
  });

  it("does not fabricate an observation manifest or shorten expiry when the requested screen fragment is absent", async () => {
    const { builder: context, screenContext } = builder(); const offered = withForeground(selection(["accepted_screen"]));
    const built = await context.prepare(offered);
    expect(screenContext).toHaveBeenCalledTimes(1);
    expect(built?.manifest.sources.filter((source) => source.category === "observation")).toEqual([]);
    expect(built?.manifest.expiresAt).toBe(new Date(offered.expiresAt).toISOString());
  });

  it.each(["paused", "stale", "future"])("excludes %s optional Sampling and never asks for screen context", async (state) => {
    const { builder: context, screenContext } = builder(); const offered = withForeground(selection(["accepted_activity", "accepted_screen"]));
    if (state === "paused") offered.snapshot.privacyPaused = true;
    if (state === "stale") offered.snapshot.foreground!.observedAt = NOW - 60_000;
    if (state === "future") offered.snapshot.foreground!.observedAt = NOW + 1;
    const built = await context.prepare(offered);
    expect(screenContext).not.toHaveBeenCalled(); expect(built?.controlInput).not.toContain("Editor");
    expect(built?.manifest.sources.filter((source) => source.category === "observation")).toEqual([]);
  });

  it("captures current fenced observations once before the awaited Memory read and preserves nullable idle", async () => {
    const screen = createScreenContext({ staleAfterMs: 60_000 }); screen.push("Original accepted description", NOW);
    const captureMemory = vi.fn(async () => { screen.push("Later unrelated description", NOW + 1); return memory(); });
    const { builder: context } = builder({ captureMemory, screenContext: (at) => renderScreenContext(screen, at) });
    const built = await context.prepare(withForeground(selection(["accepted_activity", "accepted_screen"])));
    expect(built?.controlInput).toContain("Original accepted description"); expect(built?.controlInput).not.toContain("Later unrelated");
    expect(built?.controlInput).toContain('"idleSeconds":null'); expect(built?.controlInput).toContain("<untrusted-observation");
    expect(built?.manifest.sources.filter((source) => source.category === "observation")).toHaveLength(2);
    expect(built?.manifest.expiresAt).toBe(new Date(NOW + 60_000).toISOString());
  });

  it("retains the original prepared authority and refuses a missing authority-currentness port", async () => {
    let current = true; const captured = memory(); const offered = selection();
    const { builder: context } = builder({ captureMemory: async () => ({ ...captured, isCurrent: () => current }) });
    expect(context.isCurrent(offered)).toBe(true); expect(await context.prepare(offered)).toBeDefined();
    current = false; expect(context.isCurrent(offered)).toBe(false);
    const missing = builder({ captureMemory: async () => ({ ...captured, isCurrent: undefined }) });
    const other = selection(); expect(await missing.builder.prepare(other)).toBeUndefined(); expect(missing.builder.isCurrent(other)).toBe(false);
  });
});

describe("bounded initiative preparation lifetime", () => {
  it.each(["deadline", "cancel", "close"] as const)("settles %s even if the capture port ignores abort, and ignores late completion", async (boundary) => {
    vi.useFakeTimers(); vi.setSystemTime(NOW); let resolve!: (run: CapturedMemoryRun) => void;
    const waiting = new Promise<CapturedMemoryRun>((done) => { resolve = done; }); let signal: AbortSignal | undefined;
    const { builder: context } = builder({ now: Date.now, captureMemory: async (_id, observed) => { signal = observed; return waiting; } });
    const offered = selection(); offered.expiresAt = NOW + 1000;
    const prepared = context.prepare(offered);
    if (boundary === "deadline") await vi.advanceTimersByTimeAsync(1001);
    if (boundary === "cancel") context.cancel("taki");
    if (boundary === "close") context.close();
    await expect(prepared).resolves.toBeUndefined(); expect(signal?.aborted).toBe(true); expect(context.isCurrent(offered)).toBe(false);
    resolve(memory()); await Promise.resolve(); expect(context.isCurrent(offered)).toBe(false); expect(vi.getTimerCount()).toBe(0);
  });

  it("ends capture at the actual selected Sampling deadline rather than the longer clock window", async () => {
    vi.useFakeTimers(); vi.setSystemTime(NOW);
    const { builder: context } = builder({ now: Date.now, captureMemory: () => new Promise<CapturedMemoryRun>(() => undefined) });
    const offered = withForeground(selection(["accepted_activity"])); offered.snapshot.foreground!.observedAt -= 59_000;
    const pending = context.prepare(offered); await vi.advanceTimersByTimeAsync(1001);
    await expect(pending).resolves.toBeUndefined(); expect(context.isCurrent(offered)).toBe(false);
  });
});

function withForeground(offered: WakeSelection): WakeSelection {
  offered.snapshot.foreground = { occurrenceKey: "foreground-stretch", observedAt: NOW, startedAt: NOW - 1_800_000,
    application: "Editor", meaningful: true, idleSeconds: null, observationEpoch: 5,
    hostId: "host", connectionGeneration: 2, catalogGeneration: 3 };
  return offered;
}
