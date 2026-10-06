import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHealthyTransitionHarness } from "../../testing/memory-transition-healthy-fixtures.ts";
import { createConfigSource } from "../../config/config-source.ts";
import { createConfigRepo } from "../../db/config-repo.ts";
import { createCaptureLogger } from "../../testing/capture-logger.ts";
import { hindsightFixtureSecrets } from "../../testing/hindsight-runtime-composition-fixtures.ts";
import { composeMemoryTransitions } from "../../boot/memory-transition-boot.ts";
import { createMemoryOperationService } from "../operations/memory-operation-service.ts";
import { fakeSetup } from "../operations/memory-operation-fixtures.ts";
import { W3_AT } from "../../testing/memory-transition-candidate-fixtures.ts";
import type { TransitionEvidenceContext } from "./transition-evidence-context.ts";
import * as identity from "./transition-current-identity.ts";
import * as native from "./transition-native-evidence.ts";

beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(W3_AT); });
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

async function fixture() {
  const h = await createHealthyTransitionHarness();
  for (const kind of ["transition.return-local", "transition.reenter-hindsight"] as const) {
    const operation = h.owner.submit(await h.request(undefined, kind)); await h.owner.stop();
    expect(h.owner.status(operation.operationId).state).toBe("completed");
  }
  const { logger } = createCaptureLogger();
  const secrets = hindsightFixtureSecrets(); secrets.state.value = null;
  const service = composeMemoryTransitions({ db: h.db, runtime: h.runtime, ownerId: "offline-admission", actorId: "operator",
    config: createConfigSource({ repo: createConfigRepo(h.db), env: { TAKI_HINDSIGHT_ENABLED: "false" } }),
    secrets: secrets.catalog, logger, client: h.remote.client, now: () => h.clock.value });
  const owner = createMemoryOperationService({ db: h.db, live: () => null, setup: fakeSetup(), transition: service,
    bootId: "offline-admission", logger, now: () => h.clock.value, onChanged: () => undefined });
  const preview = await service.preview({ kind: "transition.emergency-local" });
  if (!preview.expected) throw new Error("owned emergency fixture refused");
  const request = { kind: preview.kind, requestId: randomUUID(), previewId: preview.previewId,
    previewHash: preview.previewHash, expected: preview.expected, confirmation: "emergency-takeover" as const };
  const tables = ["memory_operations", "memory_transition_intents", "memory_transition_emergency_captures",
    "memory_transition_incidents", "memory_transition_emergency_quarantine", "memory_transition_emergency_manual_quarantine"];
  const rows = () => tables.map((table) => h.db.prepare(`SELECT * FROM ${table}`).all());
  return { h, service, owner, preview, request, rows,
    advance: (ms: number) => { h.clock.value = new Date(Date.parse(h.clock.value) + ms).toISOString(); },
    close: async () => { await owner.stop(); await service.stop(); await h.close(); } };
}

describe("offline emergency admission confirmation time", () => {
  it("accepts a 6ms-old confirmation when both actual synchronous plans cross its 120s window", async () => {
    const f = await fixture();
    try {
      f.advance(6); const entry = f.h.clock.value; const remoteBefore = { ...f.h.remote.calls };
      const read = identity.readEmergencyTransitionIdentity;
      const plans = vi.spyOn(f.service, "plan"); const verify = vi.spyOn(native, "verifyTransitionNativeEvidence");
      const quiesce = f.service.emergencyAdmitted;
      let admissionEvidenceIds: string[] = [];
      vi.spyOn(f.service, "emergencyAdmitted").mockImplementation((epochId) => {
        admissionEvidenceIds = verify.mock.calls.map(([evidence]) => evidence.evidenceId);
        quiesce!(epochId); // After COMMIT, retirement must start another independent proof boundary.
      });
      vi.spyOn(identity, "readEmergencyTransitionIdentity").mockImplementation((...args) => {
        const result = read(...args); f.advance(130_000); return result;
      });
      const admitted = f.owner.submit(f.request);
      expect(plans).toHaveBeenCalledTimes(2);
      expect(Date.parse(f.h.clock.value)).toBeGreaterThan(Date.parse(f.preview.expiresAt));
      const context = plans.mock.calls[0]![1] as TransitionEvidenceContext;
      expect(plans.mock.calls[1]![1]).toBe(context);
      expect(f.h.db.prepare("SELECT created_at FROM memory_operations WHERE operation_id=:id").get({ id: admitted.operationId })?.created_at)
        .not.toBe(entry); // Real operation/lease clocks continue advancing; only confirmation entry validity is retained.
      expect(admissionEvidenceIds.length).toBeGreaterThan(0);
      expect(new Set(admissionEvidenceIds).size).toBe(admissionEvidenceIds.length);
      expect(() => context.admissionStartedAt).toThrow("MEMORY_TRANSITION_PROOF_INVALID");
      f.owner.cancel(admitted.operationId); await f.owner.stop();
      expect(f.h.remote.calls).toEqual(remoteBefore);
      expect(f.owner.submit(f.request).operationId).toBe(admitted.operationId); // Exact duplicate stays observable.
      expect(() => f.owner.submit({ ...f.request, requestId: randomUUID() })).toThrow("MEMORY_TRANSITION_STALE");
    } finally { await f.close(); }
  }, 30_000);

  it("refuses a genuinely expired preview at a new submission before identity work or dispatch", async () => {
    const f = await fixture(); const before = f.rows();
    try {
      const read = vi.spyOn(identity, "readEmergencyTransitionIdentity"); const execute = vi.spyOn(f.service, "execute");
      f.advance(120_000);
      expect(() => f.owner.submit(f.request)).toThrow("MEMORY_TRANSITION_STALE");
      expect(read).not.toHaveBeenCalled(); expect(execute).not.toHaveBeenCalled(); expect(f.rows()).toEqual(before);
    } finally { await f.close(); }
  }, 30_000);

  it.each(["configuration", "inventory", "epoch", "replica", "preview"] as const)(
    "keeps the second-plan current %s check after costly validation, with complete admission rollback", async (change) => {
      const f = await fixture(); const before = f.rows(); const remoteBefore = { ...f.h.remote.calls };
      try {
        const plan = f.service.plan; let count = 0;
        const execute = vi.spyOn(f.service, "execute");
        vi.spyOn(f.service, "plan").mockImplementation((...args) => {
          if (++count === 2) {
            f.advance(130_000);
            if (change === "configuration") f.h.db.exec("UPDATE hindsight_connection_state SET revision=revision+1");
            if (change === "inventory") f.h.db.exec("UPDATE hindsight_bank_setup SET last_verified_at='2026-10-06T00:00:00.000Z'");
            if (change === "replica") f.h.db.exec("UPDATE hindsight_replica_sync_checkpoints SET end_cursor=end_cursor+1");
            if (change === "epoch") f.h.db.exec(`UPDATE canonical_memory_authority_state SET active_epoch_id=(
              SELECT predecessor_epoch_id FROM canonical_memory_authority_epochs WHERE epoch_id=active_epoch_id)`);
            if (change === "preview") {
              f.h.db.exec("DROP TRIGGER memory_transition_previews_no_delete");
              f.h.db.prepare("DELETE FROM memory_transition_previews WHERE id=:id").run({ id: f.request.previewId });
            }
          }
          return plan(...args);
        });
        expect(() => f.owner.submit(f.request)).toThrow(/MEMORY_TRANSITION_(?:STALE|UNAVAILABLE|PROOF_INVALID)/);
        expect(count).toBe(2); expect(execute).not.toHaveBeenCalled(); expect(f.rows()).toEqual(before);
        expect(f.h.remote.calls).toEqual(remoteBefore);
        expect(f.h.db.prepare("SELECT id FROM memory_transition_previews WHERE id=:id").get({ id: f.request.previewId })).toBeDefined();
      } finally { await f.close(); }
    }, 30_000);

  it.each(["configuration", "preview"] as const)("rereads %s after the first expensive identity read", async (change) => {
    const f = await fixture(); const before = f.rows();
    try {
      const read = identity.readEmergencyTransitionIdentity;
      vi.spyOn(identity, "readEmergencyTransitionIdentity").mockImplementation((...args) => {
        const result = read(...args); f.advance(130_000);
        if (change === "configuration") f.h.db.exec("UPDATE hindsight_connection_state SET revision=revision+1");
        else {
          f.h.db.exec("DROP TRIGGER memory_transition_previews_no_delete");
          f.h.db.prepare("DELETE FROM memory_transition_previews WHERE id=:id").run({ id: f.request.previewId });
        }
        return result;
      });
      expect(() => f.owner.submit(f.request)).toThrow("MEMORY_TRANSITION_STALE"); expect(f.rows()).toEqual(before);
    } finally { await f.close(); }
  }, 30_000);
});
