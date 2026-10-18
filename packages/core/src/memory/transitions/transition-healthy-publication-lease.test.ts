import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { HINDSIGHT_TEMPLATE_BACKUP_BUILD } from "@taki/shared";
import { createHealthyTransitionHarness } from "../../testing/memory-transition-healthy-fixtures.ts";
import { createTransitionPublicationFixture } from "../../testing/memory-transition-publication-fixtures.ts";
import { W3_AT } from "../../testing/memory-transition-candidate-fixtures.ts";
import { readTransitionAttempt, readTransitionIntent } from "../../db/memory-transition-repo.ts";
import { enqueueTransitionWrite, readTransitionQueue } from "../../db/memory-transition-queue-repo.ts";
import { readTransitionReceipt } from "../../db/memory-transition-evidence-repo.ts";
import { publishMemoryTransition } from "../../db/memory-transition-publication-repo.ts";
import type { Database } from "../../db/sqlite.ts";
import * as publicationReader from "../../db/memory-transition-publication-reader.ts";
import * as templateState from "./transition-template-state.ts";
import { templateObservationFixture } from "../../testing/hindsight-template-observation-fixtures.ts";

beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(W3_AT); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

// Compare every persisted table, including both providers' installation/checkpoint state, custody,
// queue reservations/results and historical receipts. Stable row ordering does not discard duplicates.
function databaseState(db: Database) {
  return Object.fromEntries(db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all()
    .map(({ name }) => [String(name), db.prepare(`SELECT * FROM "${String(name).replaceAll('"', '""')}"`).all()
      .map((row) => JSON.stringify(row)).sort()]));
}

describe("healthy publication final live lease", () => {
  it.each((["transition.return-local", "transition.reenter-hindsight"] as const).flatMap((kind) =>
    (["publication", "template"] as const).map((boundary) => ({ kind, boundary }))))(
    "rolls back all $kind publication state when the $boundary read-back reaches leaseUntil", async ({ kind, boundary }) => {
      const h = await createHealthyTransitionHarness();
      try {
        if (boundary === "template") {
          const contract = { version: "1.0.0", support: { state: "supported" as const, reason: "all_contracts_available" as const } };
          h.remote.manifest.source_identity.compatibility_build = HINDSIGHT_TEMPLATE_BACKUP_BUILD;
          h.remote.manifest.contracts.template_lifecycle = contract; h.remote.manifest.contracts.template_backup = contract;
          Object.assign(h.remote.client, templateObservationFixture({ receipts: new Map(), snapshots: new Map() }).client);
        }
        if (kind === "transition.reenter-hindsight") {
          const first = h.owner.submit(await h.request()); await h.owner.stop();
          expect(h.owner.status(first.operationId).state).toBe("completed");
        }
        const quiesce = h.runtime.transitions.quiesce;
        vi.spyOn(h.runtime.transitions, "quiesce").mockImplementationOnce(async (work) => {
          await quiesce(work);
          // These real admitted obligations arrive after source drain and before its admission cutoff.
          const session = h.runtime.custody.begin({ characterId: "taki", repo: h.timeline });
          session.repo.append({ characterId: "taki", role: "user", content: "Exact outstanding primary custody" });
          session.repo.append({ characterId: "taki", role: "assistant", content: "Carry both members atomically" });
          session.finalize();
          const intent = readTransitionIntent(h.db, work.lease.transitionId)!;
          const bank = intent.request.expected.banks.find((entry) => entry.scope.kind === "global")!;
          enqueueTransitionWrite(h.db, { now: h.clock.value, admission: {
            transitionId: intent.transitionId, sourceEpochId: intent.request.expected.predecessorEpochId,
            callerRequestId: "original-publication-lease-caller", scope: bank.scope,
            provenance: { callerId: "operator", runId: "original-run", attemptId: "original-attempt", effectId: "original-effect" },
            logicalTargetId: "unit-bank", expectedRevision: 1,
            command: { kind: "mutation", request: { kind: "edit", bankId: bank.sourceBankId,
              memoryId: "unit-bank", expectedRevision: 1, patch: { text: "Queued before publication" } } },
          } });
        });
        const publish = h.runtime.transitions.publish; const read = publicationReader.readVerifiedTransitionPublication;
        let before: ReturnType<typeof databaseState> | undefined;
        let after: ReturnType<typeof databaseState> | undefined;
        let validated: ReturnType<typeof read> | undefined;
        let refusal: unknown; let transitionId = ""; let templateValidated = false;
        vi.spyOn(h.runtime.transitions, "publish").mockImplementationOnce((work) => {
          transitionId = work.lease.transitionId; before = databaseState(h.db);
          vi.spyOn(publicationReader, "readVerifiedTransitionPublication").mockImplementation((...args) => {
            const result = read(...args);
            if (result.transitionId === transitionId) {
              // Execute the full real reader first. Only the clock changes at the final synchronous boundary.
              validated = result;
              if (boundary === "publication") h.clock.value = readTransitionAttempt(h.db, transitionId)!.leaseUntil;
            }
            return result;
          });
          if (boundary === "template") {
            const readTemplates = templateState.assertTransitionTemplatePublication;
            vi.spyOn(templateState, "assertTransitionTemplatePublication").mockImplementation((...args) => {
              readTemplates(...args);
              expect(args[1].identity.templates).toBeDefined();
              templateValidated = true; h.clock.value = readTransitionAttempt(h.db, transitionId)!.leaseUntil;
            });
          }
          try { return publish(work); }
          catch (error) { refusal = error; throw error; }
          finally { after = databaseState(h.db); }
        });
        const operation = h.owner.submit(await h.request(undefined, kind)); await h.owner.stop();
        expect(validated?.transitionId).toBe(transitionId);
        expect(validated?.sourceCustody.groups).toHaveLength(1);
        expect(validated?.sourceCustody.witnesses).toHaveLength(2);
        expect(validated?.queue).toHaveLength(1);
        expect(templateValidated).toBe(boundary === "template");
        expect(refusal).toEqual(new Error("MEMORY_TRANSITION_LEASE_LOST"));
        expect(after).toEqual(before);
        expect(readTransitionReceipt(h.db, transitionId)).toBeUndefined();
        expect(readTransitionAttempt(h.db, transitionId)?.phase).toBe("proven");
        expect(readTransitionQueue(h.db, transitionId)).toHaveLength(1);
        expect(h.owner.status(operation.operationId)).toMatchObject({ state: "outcome_unknown" });
        expect(h.db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
      } finally { await h.close(); }
    }, 30_000);

  it.each(["transition.return-local", "transition.reenter-hindsight"] as const)(
    "commits %s just before leaseUntil and reads the same receipt after expiry without new writes", async (kind) => {
      const h = await createHealthyTransitionHarness();
      try {
        if (kind === "transition.reenter-hindsight") {
          const first = h.owner.submit(await h.request()); await h.owner.stop();
          expect(h.owner.status(first.operationId).state).toBe("completed");
        }
        const publish = h.runtime.transitions.publish; const read = publicationReader.readVerifiedTransitionPublication;
        let original: Parameters<typeof publish>[0] | undefined;
        let validated = false;
        vi.spyOn(h.runtime.transitions, "publish").mockImplementationOnce((work) => {
          original = work;
          vi.spyOn(publicationReader, "readVerifiedTransitionPublication").mockImplementation((...args) => {
            const result = read(...args);
            if (result.transitionId === work.lease.transitionId && !validated) {
              validated = true;
              h.clock.value = new Date(Date.parse(readTransitionAttempt(h.db, result.transitionId)!.leaseUntil) - 1).toISOString();
            }
            return result;
          });
          return publish(work);
        });
        const operation = h.owner.submit(await h.request(undefined, kind)); await h.owner.stop();
        expect(validated).toBe(true);
        expect(h.owner.status(operation.operationId).state).toBe("completed");
        const receipt = readTransitionReceipt(h.db, original!.lease.transitionId)!;
        expect(receipt.committedAt).toBe(original!.now);
        const before = databaseState(h.db);
        h.clock.value = new Date(Date.parse(h.clock.value) + 2).toISOString();
        // The original lease is now expired and terminal. This is factual receipt recovery, not publication authority.
        expect(publish(original!)).toEqual(receipt);
        expect(databaseState(h.db)).toEqual(before);
      } finally { await h.close(); }
    }, 30_000);

  it.each(["ownerId", "operationId", "attemptId", "generation", "revision", "unchanged-revision"] as const)(
    "rejects a changed %s after complete read-back instead of adopting the current executor", async (field) => {
      const f = await createTransitionPublicationFixture();
      try {
        const work = f.prove(); const before = databaseState(f.db);
        const read = publicationReader.readVerifiedTransitionPublication; let validated = false;
        vi.spyOn(publicationReader, "readVerifiedTransitionPublication").mockImplementation((...args) => {
          const result = read(...args); validated = true;
          const attempt = readTransitionAttempt(f.db, f.intent.transitionId)!;
          expect(attempt.revision).toBe(work.lease.revision + 1);
          if (field === "generation" || field === "revision") attempt[field] += 1;
          else if (field === "unchanged-revision") attempt.revision = work.lease.revision;
          else attempt[field] = randomUUID();
          // Fault injection inside the publication transaction; production callers cannot mutate this captured identity.
          f.db.prepare("UPDATE memory_transition_attempts SET revision=:revision,attempt_json=:json WHERE transition_id=:id")
            .run({ id: attempt.transitionId, revision: attempt.revision, json: JSON.stringify(attempt) });
          return result;
        });
        expect(() => publishMemoryTransition(f.db, work)).toThrow("MEMORY_TRANSITION_LEASE_LOST");
        expect(validated).toBe(true);
        expect(databaseState(f.db)).toEqual(before);
      } finally { await f.close(); }
    });

  it("requires an explicit live clock before a new publication can write", async () => {
    const f = await createTransitionPublicationFixture();
    try {
      const work = f.prove(); const before = databaseState(f.db);
      const { currentTime, ...missingClock } = work; void currentTime;
      // @ts-expect-error Deliberately emulate an untyped caller omitting the required clock.
      expect(() => publishMemoryTransition(f.db, missingClock)).toThrow("MEMORY_TRANSITION_PROOF_INVALID");
      expect(databaseState(f.db)).toEqual(before);
    } finally { await f.close(); }
  });
});
