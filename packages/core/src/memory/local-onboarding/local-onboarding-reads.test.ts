import { afterEach, describe, expect, it } from "vitest";
import { MemoryOnboardingStatusSchema } from "@taki/shared";
import { cleanupLegacyMigrationFixtures, legacyEntry, PROFILE_ENTRY } from "../legacy-migration/legacy-migration-fixture.ts";
import type { LocalBindingSnapshot } from "../local-runtime-binding.ts";
import { createLocalOnboardingHarness } from "./local-onboarding-fixture.ts";
import { localRuntimeAvailability, readOnboardingExceptions, runProgress } from "./local-onboarding-reads.ts";

afterEach(cleanupLegacyMigrationFixtures);

const snapshot = (patch: Partial<LocalBindingSnapshot>): LocalBindingSnapshot =>
  ({ selection: "canonical-local", selectedEpochId: "e", binding: { kind: "published", epochId: "e" }, lifetime: "running", flush: "available", ...patch });

describe("local onboarding reads", () => {
  it("derives a closed runtime availability that always satisfies the status invariant", () => {
    const cases: Array<[LocalBindingSnapshot, ReturnType<typeof localRuntimeAvailability>]> = [
      [snapshot({}), { available: true, unavailableReason: null }],
      [snapshot({ selection: "legacy-markdown", selectedEpochId: null, binding: { kind: "none" }, flush: "failing" }), { available: true, unavailableReason: null }],
      [snapshot({ lifetime: "stopped", flush: "failing" }), { available: false, unavailableReason: "stopped" }],
      [snapshot({ binding: { kind: "unavailable", epochId: "e", code: "X" }, flush: "failing" }), { available: false, unavailableReason: "not_installed" }],
      [snapshot({ binding: { kind: "none" }, flush: "failing" }), { available: false, unavailableReason: "not_installed" }],
      [snapshot({ binding: { kind: "published", epochId: "other" } }), { available: false, unavailableReason: "authority_mismatch" }],
    ];
    for (const [input, expected] of cases) {
      const runtime = localRuntimeAvailability(input);
      expect(runtime).toEqual(expected);
      MemoryOnboardingStatusSchema.parse({ authority: { mode: input.selection, epochId: input.selectedEpochId }, runtime, run: null, operation: null,
        custody: { openGroups: 0, recoverableGroups: 0 }, observedAt: "2026-09-22T00:00:00.000Z",
        actions: { preview: false, prepare: false, resume: false, replace: false, activate: false, recoverBinding: false, reconcileSources: false, cancelOperationId: null, retryOperationId: null } });
    }
  });

  it("maps run status and lease evidence onto the bounded progress phases", () => {
    const counts = { sourceCount: 3, resolvedCount: 1, blockingCount: 2 };
    expect(runProgress({ runId: "r", phase: "staged", status: "running", ...counts }, true)).toEqual({ phase: "converting", ...counts });
    expect(runProgress({ runId: "r", phase: "staged", status: "running", ...counts }, false)).toEqual({ phase: "blocked", ...counts });
    expect(runProgress({ runId: "r", phase: "staged", status: "failed", ...counts, blockingCount: 0 }, false)).toEqual({ phase: "verifying", ...counts, blockingCount: 0 });
    expect(runProgress({ runId: "r", phase: "verified", status: "ready", ...counts }, false).phase).toBe("ready");
    expect(runProgress({ runId: "r", phase: "activated", status: "completed", ...counts }, false).phase).toBe("completed");
  });

  it("pages diagnostics by source id with an exclusion hint and refuses unknown runs", async () => {
    const bad = (i: number) => [`memory/global/profile/bad-${i}.md`, "---\nid: a\nid: b\n---\nx"] as const;
    const h = createLocalOnboardingHarness({ entries: Object.fromEntries([[PROFILE_ENTRY, legacyEntry("ok")], bad(1), bad(2), bad(3)]) });
    const preview = await h.local.preview();
    await h.local.prepare({ runId: "run-1", previewId: preview.reportId });
    const first = readOnboardingExceptions(h.f.db, { runId: "run-1", cursor: null, limit: 2 });
    expect(first.items).toHaveLength(2); expect(first.nextCursor).toBe(first.items[1]!.sourceId);
    const second = readOnboardingExceptions(h.f.db, { runId: "run-1", cursor: first.nextCursor, limit: 2 });
    expect(second).toMatchObject({ items: [{ canExclude: true, relativePath: expect.stringMatching(/^entries\//) }], nextCursor: null });
    expect(new Set([...first.items, ...second.items].map((item) => item.sourceId)).size).toBe(3);
    expect(() => readOnboardingExceptions(h.f.db, { runId: "missing", cursor: null, limit: 10 })).toThrow("MIGRATION_NOT_FOUND");
  });
});
