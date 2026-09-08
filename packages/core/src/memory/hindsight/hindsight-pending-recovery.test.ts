import { afterEach, describe, expect, it } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import {
  CanonicalMemoryUnitSchema, MemoryReplicaScheduleConfigSchema, type CanonicalMemoryRecord, type CanonicalMemoryUnit,
  HindsightNativeResultSchema, nativeResultFields, nativeReceiptFields,
  type HindsightConnectionProjection, type HindsightJournalChange, type HindsightLogicalSnapshotMetadata,
  type HindsightLogicalSnapshotRecord, type MemoryReplicaBank, type MemoryReplicaScheduledRun,
  type MutationRequest, type PendingMemoryOperation, type PendingMemoryRecord,
} from "@taki/shared";
import { createCanonicalMemoryAuthorityRepo } from "../../db/canonical-memory-authority-repo.ts";
import { createPendingMemoryRepo } from "../../db/pending-memory-repo.ts";
import { pendingMemoryRef } from "../../db/pending-memory-store.ts";
import { createHindsightReplicaSyncRepo } from "../../db/hindsight-replica-sync-repo.ts";
import { createHindsightReplicaSchedulerRepo } from "../../db/hindsight-replica-scheduler-repo.ts";
import { MIGRATIONS } from "../../db/migrations/index-list.ts";
import { openDatabase, type Database } from "../../db/sqlite.ts";
import { canonicalJson } from "../legacy-migration/legacy-identities.ts";
import { createIntlSegmenterTokenizer } from "../search-tokenizer.ts";
import { createPendingMemoryWriter } from "../pending-memory-writer.ts";
import { createHindsightClient, type HindsightTransportResponse } from "./hindsight-client.ts";
import { createHindsightPendingRecoveryRunner } from "./hindsight-pending-recovery-runner.ts";
import { nativeProofHash, prepareTrackedDispatch } from "./hindsight-native-proof.ts";
import { unavailableHindsightDerivedCompletion, type MemoryDerivedCompletionPort } from "./hindsight-derived-completion.ts";
import { createHindsightReplicaScheduler, type HindsightReplicaScheduler } from "./hindsight-replica-scheduler.ts";
import type { HindsightReplicaProjection } from "./hindsight-replica-projection.ts";
import { replicaErrorCode, replicaOwnershipLost } from "./hindsight-replica-errors.ts";
import { snapshotManifestHash } from "./hindsight-snapshot-validator.ts";

const at = "2026-09-06T00:00:00.000Z";
const lineage = "11111111-1111-4111-8111-111111111111";
const generation = "22222222-2222-4222-8222-222222222222";
const foreign = "33333333-3333-4333-8333-333333333333";
const memoryId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const missingId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const globalBank: MemoryReplicaBank = { bankId: "global", scope: "global", characterId: null };
const characterBank: MemoryReplicaBank = { bankId: "character", scope: "character", characterId: "taki" };
const dbs: Database[] = []; const roots: string[] = []; const schedulers: HindsightReplicaScheduler[] = [];
afterEach(async () => {
  for (const scheduler of schedulers.splice(0)) await scheduler.stop();
  for (const db of dbs.splice(0)) db.close();
  for (const root of roots.splice(0)) {
    if (dirname(resolve(root)) !== resolve(tmpdir()) || !basename(root).startsWith("taki-pending-recovery-")) throw new Error("unsafe fixture path");
    rmSync(root, { recursive: true, force: true });
  }
});

describe("Pending Memory recovery through the real client and SQLite repositories", () => {
  it("orders first pull, retain-first replay, native completion, derived evidence, and second-pull publication", async () => {
    const f = fixture(); f.useProvenFixtureFence(); const authority = f.authorityState();
    const edit = f.enqueue(mutation({ patch: { text: "corrected memory", context: null } }));
    const retained = f.enqueue(retain("记住恢复后的阅读计划。"));
    const originalCursor = f.replica.checkpoint("global")!.endCursor;
    const result = await f.execute();
    expect(f.events).toEqual([
      `pull:global:${originalCursor}`, `retain:${retained.remoteOperationId}`, `mutate:${edit.remoteOperationId}`,
      `native:${retained.remoteOperationId}`, `derived:${retained.remoteOperationId}`, `derived:${edit.remoteOperationId}`,
      `pull:global:${originalCursor}`,
    ]);
    expect(f.row(retained).phase).toBe("completed"); expect(f.row(edit).phase).toBe("completed");
    expect(result.checkpoint.endCursor).toBe(f.banks.get("global")!.cursor);
    expect(f.replica.record({ bankId: "global", memoryId })?.unit).toMatchObject({ revision: 2, text: "corrected memory", context: null });
    expect(f.replica.search({ bankId: "global", query: "阅读计划", limit: 5 })).toHaveLength(1);
    expect(f.replica.logicalRecord({ bankId: "global", objectKind: "mental_model", objectId: `derived-${retained.remoteOperationId}` })?.payload?.kind).toBe("mental_model");
    expect(f.pending.overlay({ authorityEpochId: "epoch", bankId: "global" })).toEqual([]);
    expect(f.authorityState()).toEqual(authority);
    const nativeBody = f.logs.find((entry) => entry.method === "POST")!.body!;
    expect(nativeBody.items).toEqual([expect.objectContaining({ timestamp: at, document_id: retained.documentId,
      metadata: { source: "original", structured: '{"sequence":4}' }, entities: [{ text: "Alice" }], observation_scopes: "shared" })]);
    expect(f.logs.find((entry) => entry.method === "PATCH")?.body).toMatchObject({ context: "", expected_revision: 1, mutation_id: edit.remoteOperationId });
    const durable = JSON.stringify(f.db.prepare("SELECT state_json FROM pending_memory").all());
    expect(durable).not.toContain("dummy-offline-key"); expect(durable).not.toContain("private_debug");
    expect(durable).not.toContain("never persist this raw provider metadata");
  });

  it("preserves successful native receipts across restart when the real provider has no derived fence", async () => {
    const f = fixture(true); const row = f.enqueue(retain());
    const before = f.replica.checkpoint("global");
    await expect(f.execute()).rejects.toThrow("HINDSIGHT_DERIVED_FENCE_UNAVAILABLE");
    const accepted = f.row(row);
    expect(accepted).toMatchObject({ phase: "awaiting_derived", diagnosticCode: "HINDSIGHT_DERIVED_FENCE_UNAVAILABLE" });
    expect(accepted.nativeReceipt).not.toBeNull(); expect(accepted.acceptedAt).toBe(at);
    expect(f.events.filter((event) => event.startsWith("pull:"))).toHaveLength(1);
    expect(f.replica.checkpoint("global")!.endCursor).toBe(before!.endCursor);
    f.reopen(); const receipt = f.row(row).nativeReceipt;
    await expect(f.execute()).rejects.toThrow("HINDSIGHT_DERIVED_FENCE_UNAVAILABLE");
    expect(f.row(row).nativeReceipt).toEqual(receipt);
    expect(f.events.filter((event) => event.startsWith("retain:"))).toHaveLength(1);
    expect(f.events.filter((event) => event.startsWith("native:"))).toHaveLength(1);
    expect(f.pending.summary({ authorityEpochId: "epoch", bankId: "global" })).toMatchObject({ pendingCount: 1, nativeConfirmedCount: 1, completedCount: 0 });
    expect(f.pending.overlay({ authorityEpochId: "epoch", bankId: "global" })[0]).toMatchObject({ confirmed: false, phase: "awaiting_derived" });
    f.useProvenFixtureFence(); await f.execute();
    expect(f.row(row).phase).toBe("completed");
    expect(f.events.filter((event) => event.startsWith("retain:"))).toHaveLength(1);
  });

  it("resumes an interrupted second pull without repeating native writes or a persisted derived check", async () => {
    const f = fixture(true); f.useProvenFixtureFence(); const row = f.enqueue(retain());
    let pulls = 0;
    f.after = (url, response) => url.pathname.endsWith("/changes") && ++pulls === 2 ? { status: 401, body: "private authentication detail" } : response;
    await expect(f.execute()).rejects.toThrow("HINDSIGHT_AUTHENTICATION_FAILED");
    expect(f.row(row).phase).toBe("awaiting_pull"); const witness = f.row(row).derivedEvidence;
    f.reopen(); f.after = undefined;
    await f.execute();
    expect(f.row(row)).toMatchObject({ phase: "completed", derivedEvidence: witness });
    expect(f.events.filter((event) => event.startsWith("retain:"))).toHaveLength(1);
    expect(f.events.filter((event) => event.startsWith("derived:"))).toHaveLength(1);
  });

  it("recovers a lost retain acknowledgement by looking up the same operation without redispatch", async () => {
    const f = fixture(true); f.useProvenFixtureFence(); const row = f.enqueue(retain()); let lost = false;
    f.after = (url, response) => {
      if (url.pathname.endsWith("/memories") && !lost) { lost = true; throw new Error("untrusted socket detail"); }
      return response;
    };
    await expect(f.execute()).rejects.toThrow("HINDSIGHT_UNREACHABLE");
    expect(f.row(row)).toMatchObject({ phase: "submitted", acceptedAt: null, nativeReceipt: null });
    f.reopen(); await f.execute();
    expect(f.row(row).phase).toBe("completed"); expect(f.operations.size).toBe(1);
    expect(f.events.filter((event) => event.startsWith("retain:"))).toHaveLength(1);
  });

  it("keeps a missing post-dispatch retain operation unknown rather than recreating a possibly pruned operation", async () => {
    const f = fixture(); f.useProvenFixtureFence(); const row = f.enqueue(retain());
    f.before = (url, init) => { if (url.pathname.endsWith("/memories") && init.method === "POST") throw new Error("uncertain delivery"); };
    await expect(f.execute()).rejects.toThrow("HINDSIGHT_UNREACHABLE");
    f.before = undefined;
    await expect(f.execute()).rejects.toThrow("HINDSIGHT_PENDING_OUTCOME_UNKNOWN");
    expect(f.row(row)).toMatchObject({ phase: "outcome_unknown", nativeReceipt: null, nextRetryAt: null });
    expect(f.row(row).intent).toEqual(row.intent);
    await expect(f.execute()).rejects.toThrow("HINDSIGHT_PENDING_REMAINS");
    expect(f.logs.filter((entry) => entry.method === "POST")).toHaveLength(1);
    expect(f.operations.size).toBe(0);
  });

  it("replays a lost mutation with its frozen payload even when its own earlier success changed the target revision", async () => {
    const f = fixture(true); f.useProvenFixtureFence(); const row = f.enqueue(mutation({ patch: { layerId: "episodes" } })); let lost = false;
    f.after = (url, response) => {
      if (url.pathname.endsWith(`/memories/${memoryId}`) && !lost) { lost = true; throw new Error("lost mutation acknowledgement"); }
      return response;
    };
    await expect(f.execute()).rejects.toThrow("HINDSIGHT_UNREACHABLE");
    const prepared = f.row(row).preparedMutation;
    expect(prepared).toMatchObject({ patch: { entities: ["Alice", "taki-layer:episodes"], layerId: "episodes" } });
    // This explicit fixture binding stands in for the still-required B4/B6 trusted policy producer.
    f.boundLayers.set(`global:${memoryId}`, "episodes");
    f.externalEdit("global", { entities: ["Bob", "taki-layer:episodes"] }); f.reopen(); await f.execute();
    expect(f.row(row).phase).toBe("completed"); expect(f.appliedMutations).toBe(1);
    const requests = f.logs.filter((entry) => entry.method === "PATCH");
    expect(requests).toHaveLength(2); expect(requests[0]!.body).toEqual(requests[1]!.body);
    expect(f.row(row).nativeReceipt).toMatchObject({ kind: "mutation", revision: 2 });
    expect(f.replica.record({ bankId: "global", memoryId })?.unit.revision).toBe(3);
  });

  it("recovers a committed mutation receipt after the target was independently deleted", async () => {
    const f = fixture(); f.useProvenFixtureFence(); const row = f.enqueue(mutation()); let lost = false;
    f.after = (url, response) => { if (url.pathname.endsWith(`/memories/${memoryId}`) && !lost) { lost = true; throw new Error("lost"); } return response; };
    await expect(f.execute()).rejects.toThrow("HINDSIGHT_UNREACHABLE");
    f.deleteTarget("global"); await f.execute();
    expect(f.row(row).phase).toBe("completed"); expect(f.appliedMutations).toBe(1);
    expect(f.replica.record({ bankId: "global", memoryId })).toBeUndefined();
    expect(f.replica.logicalRecord({ bankId: "global", objectKind: "memory_unit", objectId: memoryId, includeTombstones: true })?.operation).toBe("tombstone");
  });

  it("supersedes stale and missing targets from the first pull while retaining independent new memories", async () => {
    const f = fixture(); f.useProvenFixtureFence(); const stale = f.enqueue(mutation());
    const missing = f.enqueue(mutation({ memoryId: missingId })); const good = f.enqueue(retain());
    f.externalEdit("global", { text: "newer authoritative correction" });
    await f.execute();
    expect(f.row(stale)).toMatchObject({ phase: "superseded", currentRevision: 2, dispatchedAt: null });
    expect(f.row(missing)).toMatchObject({ phase: "superseded", currentRevision: null, dispatchedAt: null });
    expect(f.row(good).phase).toBe("completed"); expect(f.appliedMutations).toBe(0);
    expect(f.replica.record({ bankId: "global", memoryId })?.unit.text).toBe("newer authoritative correction");
    expect(f.pending.summary({ authorityEpochId: "epoch", bankId: "global" })).toMatchObject({ pendingCount: 0, completedCount: 1, supersededCount: 2 });
  });

  it("handles a post-pull CAS race as superseded and still performs the second pull before reporting convergence", async () => {
    const f = fixture(); f.useProvenFixtureFence(); const row = f.enqueue(mutation()); let raced = false;
    f.before = (_url, init) => { if (init.method === "PATCH" && !raced) { raced = true; f.externalEdit("global", { text: "racing authority update" }); } };
    const result = await f.execute();
    expect(f.row(row)).toMatchObject({ phase: "superseded", currentRevision: 2 });
    expect(f.appliedMutations).toBe(0); expect(result.checkpoint.endCursor).toBe(4);
    expect(f.events.filter((event) => event.startsWith("pull:"))).toEqual(["pull:global:3", "pull:global:3"]);
    expect(f.replica.record({ bankId: "global", memoryId })?.unit.text).toBe("racing authority update");
  });

  it("preserves reversible invalidate and restore with continuous revisions and confirmed FTS filtering", async () => {
    const f = fixture(); f.useProvenFixtureFence();
    const invalidated = f.enqueue({ kind: "mutation", request: { kind: "invalidate", bankId: "global", memoryId, expectedRevision: 1, reason: "outdated" } });
    await f.execute(); expect(f.row(invalidated).nativeReceipt).toMatchObject({ revision: 2, state: "invalidated" });
    expect(f.replica.search({ bankId: "global", query: "original memory", limit: 5 })).toEqual([]);
    expect(f.replica.record({ bankId: "global", memoryId, includeInvalidated: true })?.unit.invalidationReason).toBe("outdated");
    const restored = f.enqueue({ kind: "mutation", request: { kind: "restore", bankId: "global", memoryId, expectedRevision: 2 } });
    await f.execute(); expect(f.row(restored).nativeReceipt).toMatchObject({ revision: 3, state: "valid" });
    expect(f.replica.search({ bankId: "global", query: "original memory", limit: 5 })).toHaveLength(1);
  });

  it("durably refuses append before dispatch while independent replace recovery completes", async () => {
    const f = fixture(); f.useProvenFixtureFence(); const append = retain("append source");
    if (append.kind !== "retain") throw new Error("fixture kind"); append.request.updateMode = "append";
    const unsupported = f.enqueue(append); const good = f.enqueue(retain());
    await expect(f.execute()).rejects.toThrow("HINDSIGHT_PENDING_PAYLOAD_UNSUPPORTED");
    expect(f.row(unsupported)).toMatchObject({ phase: "failed", dispatchedAt: null, nextRetryAt: null, attempts: 1 });
    expect(f.row(unsupported).intent).toEqual(unsupported.intent);
    expect(f.row(good).phase).toBe("completed");
    await expect(f.execute()).rejects.toThrow("HINDSIGHT_PENDING_REMAINS");
    expect(f.row(unsupported).attempts).toBe(1);
    expect(f.logs.filter((entry) => entry.method === "POST")).toHaveLength(1);
  });

  it("does not wait for a slow native retain before dispatching and completing independent mutations", async () => {
    const f = fixture(); f.useProvenFixtureFence(); f.autoComplete = false;
    const pending = f.enqueue(retain()); const edit = f.enqueue(mutation());
    await expect(f.execute()).rejects.toThrow("HINDSIGHT_PENDING_REMAINS");
    expect(f.row(pending)).toMatchObject({ phase: "submitted", nativeReceipt: null, acceptedAt: at });
    expect(f.row(edit).phase).toBe("completed"); expect(f.appliedMutations).toBe(1);
    expect(f.events.indexOf(`mutate:${edit.remoteOperationId}`)).toBeLessThan(f.events.indexOf(`native:${pending.remoteOperationId}`));
    f.complete(pending.remoteOperationId); await f.execute();
    expect(f.row(pending).phase).toBe("completed");
    expect(f.events.filter((event) => event.startsWith("retain:"))).toHaveLength(1);
  });

  it("represents policy-permitted zero-result retain without manufacturing a confirmed memory", async () => {
    const f = fixture(); f.useProvenFixtureFence(); const row = f.enqueue(retain("zero"));
    await f.execute(); expect(f.row(row).nativeReceipt).toMatchObject({ kind: "retain", memories: [] });
    expect(f.replica.search({ bankId: "global", query: "zero", limit: 5 })).toEqual([]);
    expect(f.row(row).phase).toBe("completed");
  });

  it("keeps one Bank's authentication failure separate from another Bank's completed recovery", async () => {
    const f = fixture(); f.useProvenFixtureFence(); const before = f.authorityState();
    const global = f.enqueue(retain()); const character = f.enqueue(retain("character memory", "character"));
    f.after = (url, response) => url.pathname === "/ext/taki-memory/banks/global/changes" ? { status: 401, body: "private failure" } : response;
    const scheduler = f.scheduler(); scheduler.start(); scheduler.requestManual("global"); scheduler.requestManual("character");
    await scheduler.tick();
    expect(f.row(global).phase).toBe("queued"); expect(f.row(character).phase).toBe("completed");
    expect(scheduler.status("global")[0]).toMatchObject({ mode: "failed", errorCode: "HINDSIGHT_AUTHENTICATION_FAILED", retryDueAt: null });
    expect(scheduler.status("character")[0]).toMatchObject({ mode: "idle", errorCode: null, lastSuccessAt: at });
    expect(f.authorityState()).toEqual(before); await scheduler.stop();
  });

  it("refuses a foreign authenticated provider lineage before pulling or dispatching any intent", async () => {
    const f = fixture(); f.useProvenFixtureFence(); const row = f.enqueue(retain()); const before = f.replica.checkpoint("global");
    f.providerLineage = foreign;
    await expect(f.execute()).rejects.toThrow("HINDSIGHT_PENDING_AUTHORITY_MISMATCH");
    expect(f.row(row)).toEqual(row); expect(f.replica.checkpoint("global")).toEqual(before);
    expect(f.events).toEqual([]);
  });

  it("coalesces duplicate execution of the same lease instead of dispatching twice", async () => {
    const f = fixture(); f.useProvenFixtureFence(); const row = f.enqueue(retain()); const input = f.claim(); const runner = f.runner();
    const first = runner.run(input); const duplicate = runner.run(input);
    expect(first).toBe(duplicate);
    const results = await Promise.all([first, duplicate]); f.schedule.succeed({ run: input.run, result: results[0]! });
    expect(f.row(row).phase).toBe("completed"); expect(f.operations.size).toBe(1);
    expect(f.events.filter((event) => event.startsWith("retain:"))).toHaveLength(1);
  });

  it("uses a single absolute deadline for both pulls and leaves a late second page unpublished", async () => {
    const f = fixture(); f.useProvenFixtureFence(); const row = f.enqueue(retain());
    const before = f.replica.checkpoint("global"); let pulls = 0;
    f.after = (url, response) => {
      if (url.pathname.endsWith("/changes") && ++pulls === 2) f.advance(60_000);
      return response;
    };
    await expect(f.execute()).rejects.toThrow("HINDSIGHT_DEADLINE_EXCEEDED");
    expect(f.replica.checkpoint("global")).toEqual(before);
    expect(f.row(row)).toMatchObject({ phase: "awaiting_pull", nativeReceipt: { kind: "retain" } });
    expect(f.replica.search({ bankId: "global", query: "recovered", limit: 5 })).toEqual([]);
    f.after = undefined; await f.execute();
    expect(f.row(row).phase).toBe("completed");
    expect(f.events.filter((event) => event.startsWith("retain:"))).toHaveLength(1);
  });

  it.each([1, 2])("rejects an Authority change during pull %s before publishing that page", async (pullToChange) => {
    const f = fixture(); f.useProvenFixtureFence(); const row = f.enqueue(retain());
    const before = f.replica.checkpoint("global"); const confirmed = f.replica.record({ bankId: "global", memoryId });
    if (pullToChange === 1) f.externalEdit("global", { text: "old authority page" });
    let pulls = 0;
    f.after = (url, response) => {
      if (url.pathname.endsWith("/changes") && ++pulls === pullToChange) f.switchAuthority();
      return response;
    };
    await expect(f.execute()).rejects.toThrow("HINDSIGHT_PENDING_AUTHORITY_MISMATCH");
    expect(f.replica.checkpoint("global")).toEqual(before);
    expect(f.replica.record({ bankId: "global", memoryId })).toEqual(confirmed);
    expect(f.replica.search({ bankId: "global", query: "recovered", limit: 5 })).toEqual([]);
    expect(f.row(row).phase).toBe(pullToChange === 1 ? "queued" : "awaiting_pull");
    expect(f.authority.authorityEpoch().epochId).toBe("successor-epoch");
  });

  it.each([1, 2])("rejects a changed Bank binding during pull %s even without a Bank record in the page", async (pullToChange) => {
    const f = fixture(); f.useProvenFixtureFence(); const row = f.enqueue(retain());
    const before = f.replica.checkpoint("global");
    if (pullToChange === 1) f.externalEdit("global", { text: "foreign scope page" });
    let pulls = 0;
    f.after = (url, response) => {
      if (url.pathname.endsWith("/changes") && ++pulls === pullToChange) {
        f.projection.bankScope = () => ({ kind: "character", characterId: "other-character" });
      }
      return response;
    };
    await expect(f.execute()).rejects.toThrow(/HINDSIGHT_(PENDING_AUTHORITY_MISMATCH|REPLICA_BANK_BINDING_MISMATCH)/);
    expect(f.replica.checkpoint("global")).toEqual(before);
    expect(f.replica.record({ bankId: "global", memoryId })?.unit.text).toBe("original memory");
    expect(f.replica.search({ bankId: "global", query: "recovered", limit: 5 })).toEqual([]);
    expect(f.row(row).phase).toBe(pullToChange === 1 ? "queued" : "awaiting_pull");
  });

  it.each([1, 2])("finishes recovery after a cursor reset during pull %s in the same scheduled run", async (pullToReset) => {
    const f = fixture(); f.useProvenFixtureFence(); const row = f.enqueue(retain()); let pulls = 0;
    f.after = (url, response) => url.pathname.endsWith("/changes") && ++pulls === pullToReset
      ? { status: 409, body: "cursor reset" } : response;
    const scheduler = f.scheduler(); scheduler.start(); scheduler.requestManual("global"); await scheduler.tick();
    expect(scheduler.status("global")[0]).toMatchObject({ mode: "idle", fullReconciliationState: "succeeded" });
    expect(f.row(row)).toMatchObject({ phase: "completed", attempts: 1 });
    expect(f.events.filter((event) => event.startsWith("retain:"))).toHaveLength(1);
    expect(f.events.filter((event) => event.startsWith("derived:"))).toHaveLength(1);
    expect(f.replica.checkpoint("global")?.endCursor).toBe(f.banks.get("global")!.cursor);
  });

  it.each(["deadline", "authority"] as const)("preserves native evidence when a second-pull reset hits the captured %s fence", async (fence) => {
    const f = fixture(); f.useProvenFixtureFence(); const row = f.enqueue(retain());
    const before = f.replica.checkpoint("global"); let pulls = 0;
    f.after = (url, response) => {
      if (url.pathname.endsWith("/changes") && ++pulls === 2) {
        if (fence === "deadline") f.advance(59_000);
        return { status: 409, body: "cursor reset" };
      }
      if (url.pathname.endsWith("/snapshots")) {
        if (fence === "deadline") f.advance(1000);
        else f.switchAuthority();
      }
      return response;
    };
    const scheduler = f.scheduler(); scheduler.start(); scheduler.requestManual("global"); await scheduler.tick();
    expect(scheduler.status("global")[0]).toMatchObject({ mode: "failed", errorCode: fence === "deadline"
      ? "HINDSIGHT_DEADLINE_EXCEEDED" : "HINDSIGHT_PENDING_AUTHORITY_MISMATCH" });
    expect(f.replica.checkpoint("global")).toEqual(before);
    expect(f.row(row)).toMatchObject({ phase: "awaiting_pull", nativeReceipt: { kind: "retain" }, derivedEvidence: { throughCursor: 6 } });
    expect(f.events.filter((event) => event.startsWith("retain:"))).toHaveLength(1);
  });

  it.each(["retain", "mutation"] as const)("keeps a dispatched %s outcome unknown after Bank generation replacement", async (kind) => {
    const f = fixture(); const row = f.enqueue(kind === "retain" ? retain() : mutation()); let lost = false;
    f.after = (url, response) => {
      if (!lost && (url.pathname.endsWith("/memories") || url.pathname.endsWith(`/memories/${memoryId}`))) {
        lost = true; throw new Error("lost native acknowledgement");
      }
      return response;
    };
    await expect(f.execute()).rejects.toThrow("HINDSIGHT_UNREACHABLE");
    expect(f.row(row)).toMatchObject({ phase: "submitted", dispatchedAt: at, nativeReceipt: null });
    f.banks.get("global")!.generation = foreign; let reset = false;
    f.after = (url, response) => {
      if (!reset && url.pathname.endsWith("/changes")) { reset = true; return { status: 409, body: "generation reset" }; }
      return response;
    };
    const scheduler = f.scheduler(); scheduler.start(); scheduler.requestManual("global"); await scheduler.tick();
    expect(f.row(row)).toMatchObject({ phase: "outcome_unknown", diagnosticCode: "HINDSIGHT_PENDING_AUTHORITY_MISMATCH",
      remoteOperationId: row.remoteOperationId, nativeReceipt: null, nextRetryAt: null });
    expect(f.row(row).intent).toEqual(row.intent);
    expect(f.logs.filter((entry) => entry.method === "PATCH" || (entry.method === "POST" && entry.path.endsWith("/memories")))).toHaveLength(1);
  });

  it("cancels before HTTP work without dispatching or fabricating a native receipt", async () => {
    const f = fixture(); const row = f.enqueue(retain()); const input = f.claim(); const controller = new AbortController(); controller.abort();
    await expect(f.runner().run({ ...input, signal: controller.signal })).rejects.toThrow("HINDSIGHT_CANCELLED");
    f.schedule.fail({ run: input.run, errorCode: "HINDSIGHT_CANCELLED" });
    expect(f.row(row)).toEqual(row); expect(f.logs).toEqual([]);
  });

  it("revokes the lease on shutdown before a transport ignoring abort can publish a late acknowledgement", async () => {
    const f = fixture(true); f.useProvenFixtureFence(); const row = f.enqueue(retain());
    const dispatched = deferred<void>(); const responseGate = deferred<HindsightTransportResponse>(); let response: HindsightTransportResponse | undefined;
    f.after = (url, value) => {
      if (url.pathname.endsWith("/memories")) { response = value; dispatched.resolve(undefined); return responseGate.promise; }
      return value;
    };
    const scheduler = f.scheduler(); scheduler.start(); scheduler.requestManual("global");
    const execution = scheduler.tick(); await dispatched.promise;
    await scheduler.stop();
    expect(scheduler.status("global")[0]).toMatchObject({ mode: "failed", errorCode: "HINDSIGHT_CANCELLED" });
    const interrupted = f.row(row);
    expect(interrupted).toMatchObject({ phase: "submitted", nativeReceipt: null, acceptedAt: null });
    responseGate.resolve(response!); await execution;
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(f.row(row)).toEqual(interrupted);
    f.after = undefined; f.reopen(); await f.execute();
    expect(f.row(row).phase).toBe("completed"); expect(f.operations.size).toBe(1);
    expect(f.events.filter((event) => event.startsWith("retain:"))).toHaveLength(1);
  });

  it("does not let a late old lease overwrite a newer recovery that already settled the same intent", async () => {
    const f = fixture(); f.useProvenFixtureFence(); const row = f.enqueue(retain());
    const dispatched = deferred<void>(); const responseGate = deferred<HindsightTransportResponse>(); let response: HindsightTransportResponse | undefined;
    f.after = (url, value) => {
      if (url.pathname.endsWith("/memories")) { response = value; dispatched.resolve(undefined); return responseGate.promise; }
      return value;
    };
    const old = f.execute().then(() => null, (error: unknown) => error);
    await dispatched.promise; f.advance(61_000);
    await f.execute(); const settled = f.row(row); expect(settled.phase).toBe("completed");
    responseGate.resolve(response!); expect(await old).toMatchObject({ message: "HINDSIGHT_REPLICA_LEASE_LOST" });
    expect(f.row(row)).toEqual(settled); expect(f.operations.size).toBe(1);
  });

  it("keeps pending derived work separate from native success and resumes only its evidence check", async () => {
    const f = fixture(); const row = f.enqueue(retain());
    f.port = { check: async () => ({ status: "pending" }) };
    await expect(f.execute()).rejects.toThrow("HINDSIGHT_PENDING_REMAINS");
    expect(f.row(row)).toMatchObject({ phase: "awaiting_derived", nativeReceipt: { kind: "retain" }, derivedEvidence: null });
    f.useProvenFixtureFence(); await f.execute();
    expect(f.row(row).phase).toBe("completed");
    expect(f.events.filter((event) => event.startsWith("retain:"))).toHaveLength(1);
  });

  it("rejects an unreachable derived cursor, completes independent rows, and can recheck corrected evidence", async () => {
    const f = fixture(); f.useProvenFixtureFence(); const invalid = f.enqueue(retain("first source")); const good = f.enqueue(retain("second source"));
    const validPort = f.port;
    f.port = { check: async (input) => {
      const result = await validPort.check(input);
      return result.status === "completed" && input.request.operationId === invalid.remoteOperationId
        ? { ...result, evidence: { ...result.evidence, throughCursor: 999 } } : result;
    } };
    await expect(f.execute()).rejects.toThrow("HINDSIGHT_DERIVED_FENCE_INVALID");
    expect(f.row(invalid)).toMatchObject({ phase: "awaiting_derived", derivedEvidence: null, nativeReceipt: { kind: "retain" } });
    expect(f.row(good).phase).toBe("completed");
    f.port = validPort; await f.execute();
    expect(f.row(invalid).phase).toBe("completed");
    expect(f.events.filter((event) => event.startsWith("retain:"))).toHaveLength(2);
  });

  it("retains native cancellation without replaying it and still recovers independent work", async () => {
    const f = fixture(); f.useProvenFixtureFence(); f.autoComplete = false;
    const cancelled = f.enqueue(retain()); const good = f.enqueue(mutation());
    f.before = (url) => {
      if (url.pathname.endsWith(`/operations/${cancelled.remoteOperationId}`)) f.operations.get(cancelled.remoteOperationId)!.status = "cancelled";
    };
    await f.execute();
    expect(f.row(cancelled)).toMatchObject({ phase: "cancelled", nativeReceipt: null, nextRetryAt: null });
    expect(f.row(good).phase).toBe("completed");
    await f.execute(); expect(f.events.filter((event) => event.startsWith("retain:"))).toHaveLength(1);
  });

  it("keeps a forbidden zero result explicit while confirming later independent work across reopen", async () => {
    const f = fixture(true); f.useProvenFixtureFence();
    const operation = retain("zero");
    if (operation.kind !== "retain") throw new Error("fixture kind");
    operation.zeroResultAllowed = false;
    const blocked = f.enqueue(operation); const good = f.enqueue(retain("independent completion"));
    const input = f.claim();
    const guard = { lease: input.run.lease, deadlineAt: new Date(Date.parse(at) + 60_000).toISOString() };
    let row = f.pending.claim({ record: blocked, guard })!;
    row = f.pending.progress({ record: row, guard, change: { kind: "dispatch", preparedMutation: null,
      dispatch: prepareTrackedDispatch(row, null) } });
    // Persist previously verified native proof; the actual repository must enforce
    // this row's policy when the runner reaches its second-pull confirmation stage.
    row = f.pending.progress({ record: row, guard, change: { kind: "native_factual",
      receipt: zeroNativeResultReceipt(row, f.replica.checkpoint("global")!.endCursor) } });
    const receipt = row.nativeResultReceipt; const intent = row.intent;
    await expect(f.runner().run(input)).rejects.toThrow("HINDSIGHT_PENDING_RECEIPT_INVALID");
    f.schedule.fail({ run: input.run, errorCode: "HINDSIGHT_PENDING_RECEIPT_INVALID" });
    expect(f.row(good).phase).toBe("completed");
    expect(f.row(blocked)).toMatchObject({ phase: "awaiting_pull", diagnosticCode: "HINDSIGHT_PENDING_RECEIPT_INVALID",
      nativeResultReceipt: receipt, intent, terminalAt: null });
    expect(f.replica.search({ bankId: "global", query: "independent completion", limit: 5 })).toHaveLength(1);
    expect(f.logs.filter((entry) => entry.method === "POST")).toHaveLength(1);
    f.reopen();
    await expect(f.execute()).rejects.toThrow("HINDSIGHT_PENDING_RECEIPT_INVALID");
    expect(f.row(blocked)).toMatchObject({ phase: "awaiting_pull", nativeResultReceipt: receipt, intent, terminalAt: null });
    expect(f.row(good).phase).toBe("completed");
    expect(f.logs.filter((entry) => entry.method === "POST")).toHaveLength(1);
  });

  it("preserves the writer's original timestamp and checkpoint when the same request is repeated after progress", async () => {
    const f = fixture(); f.useProvenFixtureFence(); const operation = mutation();
    const row = f.enqueue(operation, "original-request"); await f.execute(); f.advance(1000);
    expect(f.enqueue(operation, "original-request")).toEqual(f.row(row));
    expect(f.row(row).intent).toEqual(row.intent);
    expect(() => f.enqueue(mutation({ patch: { text: "another intent" } }), "original-request")).toThrow("HINDSIGHT_PENDING_IDENTITY_CONFLICT");
  });

  it("captures Bank and run identity before asynchronous work so caller-side object changes cannot reroute recovery", async () => {
    const f = fixture(); f.useProvenFixtureFence(); const row = f.enqueue(retain()); const claim = f.claim();
    const input = { ...claim, bank: { ...claim.bank }, run: structuredClone(claim.run) };
    f.after = (url, response) => {
      if (url.pathname.endsWith("/changes")) {
        input.bank.bankId = "character"; input.bank.scope = "character"; input.bank.characterId = "taki";
        input.run.trigger = "interval";
      }
      return response;
    };
    const result = await f.runner().run(input);
    f.schedule.succeed({ run: f.schedule.get("global")!.run!, result });
    expect(f.row(row).phase).toBe("completed");
    expect(f.events.filter((event) => event.startsWith("pull:"))).toEqual(["pull:global:3", "pull:global:3"]);
    expect(f.logs.some((entry) => entry.path.includes("/banks/character/"))).toBe(false);
  });

  it("settles a known native validation refusal without a permanent automatic replay loop", async () => {
    const f = fixture(); f.useProvenFixtureFence(); const bad = f.enqueue(mutation()); const good = f.enqueue(retain());
    f.override = (url) => url.pathname.endsWith(`/memories/${memoryId}`)
      ? { status: 400, body: "native validation detail" } : undefined;
    await expect(f.execute()).rejects.toThrow("HINDSIGHT_PENDING_PAYLOAD_UNSUPPORTED");
    expect(f.row(bad)).toMatchObject({ phase: "failed", nextRetryAt: null });
    expect(f.row(good).phase).toBe("completed");
    expect(f.appliedMutations).toBe(0);
  });
});

function zeroNativeResultReceipt(row: PendingMemoryRecord, cursor: number) {
  if (row.dispatch?.protocol !== "tracked_native_v1") throw new Error("fixture dispatch");
  const result = HindsightNativeResultSchema.parse({ contract_version: "1.0.0", operation_id: row.remoteOperationId,
    provider_lineage: lineage, bank_generation: generation, bank_id: "global", operation_kind: "retain",
    request_hash: row.dispatch.requestHash, native_outcome: "applied", native_through_cursor: cursor,
    inputs: [{ input_index: 0, document_id: row.documentId, update_mode: "replace", prepared_input_hash: "a".repeat(64),
      document_hash: "b".repeat(64), created_count: 0, full_result_count: 0, first_ordinal: 0 }], mutation: null,
    manifest: { total_records: 0, page_size: 128, total_pages: 0,
      references_sha256: createHash("sha256").update("taki-native-references.v1\n").digest("hex") },
    result_hash: "0".repeat(64), native_receipt_hash: "0".repeat(64) });
  result.result_hash = nativeProofHash(nativeResultFields(result)); result.native_receipt_hash = nativeProofHash(nativeReceiptFields(result));
  return { schemaVersion: 1 as const, result, verifiedAt: at };
}

interface RemoteBank {
  bank: MemoryReplicaBank; generation: string; cursor: number; records: Map<string, HindsightLogicalSnapshotRecord>; changes: HindsightJournalChange[];
}
interface NativeOperation {
  bankId: string; documentId: string; content: string; timestamp: string; status: "pending" | "completed" | "failed" | "cancelled";
  memories: Array<{ memoryId: string; revision: number }>;
}
interface RequestLog { path: string; method: string; body: Record<string, unknown> | null }
const connection: HindsightConnectionProjection = { enabled: true, deploymentMode: "existing-instance", endpoint: "http://127.0.0.1:8888",
  apiKeySecretRef: "memory.hindsight.connection.api-key", requestTimeoutMs: 1000, setupTimeoutMs: 5000, desiredTemplateRevision: "taki-bank-v1",
  model: { defaultProvider: null, defaultModel: null, retainModel: null, reflectModel: null, consolidationModel: null,
    embeddingProvider: null, embeddingModel: null, rerankerProvider: null, rerankerModel: null } };

function fixture(file = false) {
  let path = ":memory:";
  if (file) { const root = mkdtempSync(join(tmpdir(), "taki-pending-recovery-")); roots.push(root); path = join(root, "fixture.db"); }
  const f = new RecoveryFixture(path);
  f.seed();
  return f;
}

class RecoveryFixture {
  path: string;
  at = at;
  providerLineage = lineage;
  autoComplete = true;
  logs: RequestLog[] = [];
  events: string[] = [];
  banks = new Map<string, RemoteBank>();
  operations = new Map<string, NativeOperation>();
  mutations = new Map<string, { identity: string; result: Record<string, unknown> }>();
  snapshots = new Map<string, ReturnType<typeof capture>>();
  appliedMutations = 0;
  derived = new Set<string>();
  boundLayers = new Map<string, string>();
  before?: (url: URL, init: RequestInit) => void;
  override?: (url: URL, init: RequestInit) => HindsightTransportResponse | undefined;
  after?: (url: URL, response: HindsightTransportResponse) => Promise<HindsightTransportResponse> | HindsightTransportResponse;
  port: MemoryDerivedCompletionPort = unavailableHindsightDerivedCompletion;
  db: Database;
  readonly projection: HindsightReplicaProjection;
  readonly client;
  replica: ReturnType<typeof createHindsightReplicaSyncRepo>;
  pending: ReturnType<typeof createPendingMemoryRepo>;
  authority: ReturnType<typeof createCanonicalMemoryAuthorityRepo>;
  schedule: ReturnType<typeof createHindsightReplicaSchedulerRepo>;

  constructor(path: string) {
    this.path = path;
    this.projection = {
      bankScope: (bankId) => bankId === "global" ? { kind: "global", characterId: null } : { kind: "character", characterId: "taki" },
      source: (record) => ({ retainedText: this.documentText(record.objectId), context: null, provenance: provenance(record.payload.value.bankId) }),
      memory: (record) => ({ policy: { ...canonical(record.payload.value.bankId, record.objectId).policy,
        layerId: this.boundLayers.get(`${record.payload.value.bankId}:${record.objectId}`) ?? "profile" }, provenance: provenance(record.payload.value.bankId) }),
    };
    this.db = this.open();
    this.replica = this.createReplica();
    this.pending = createPendingMemoryRepo(this.db, () => this.at);
    this.authority = createCanonicalMemoryAuthorityRepo(this.db);
    this.schedule = createHindsightReplicaSchedulerRepo(this.db, () => this.at);
    this.client = createHindsightClient({ endpoint: connection.endpoint, resolveApiKey: () => "dummy-offline-key",
      transport: async (raw, init = {}) => {
        const url = new URL(raw);
        expect(init.headers).toMatchObject({ authorization: "Bearer dummy-offline-key" });
        this.logs.push({ path: url.pathname + url.search, method: init.method ?? "GET", body: init.body ? JSON.parse(String(init.body)) : null });
        this.before?.(url, init);
        const response = this.override?.(url, init) ?? this.respond(url, init);
        return this.after ? await this.after(url, response) : response;
      } });
  }

  seed() {
    seedAuthority(this.db);
    for (const bank of [globalBank, characterBank]) {
      const records = [bankRecord(bank.bankId), sourceRecord(bank.bankId, "seed-doc", { content: "seed source" }),
        memoryRecord(bank.bankId, bank.scope === "global" ? memoryId : missingId)];
      const remote = { bank, generation, cursor: 3, records: new Map(records.map((record) => [recordKey(record), record])), changes: [] };
      this.banks.set(bank.bankId, remote);
      const snapshot = capture(remote, this.at);
      const lease = this.replica.leases.acquire({ bankId: bank.bankId, ownerId: "fixture-seed", durationMs: 61_000 });
      this.replica.seedVerifiedSnapshot({ ...snapshot, lease, expectedBank: bank, expectedCheckpoint: null,
        authorityEpochId: "epoch", expectedProviderLineageId: lineage, expectedBankGeneration: generation });
      this.replica.leases.release(lease);
      this.schedule.ensureBank({ bank, config: MemoryReplicaScheduleConfigSchema.parse({ automatic: false }) });
    }
  }

  enqueue(operation: PendingMemoryOperation, operationId: string = randomUUID()) {
    const bank = this.banks.get(operation.request.bankId)!.bank;
    return createPendingMemoryWriter({ authority: this.authority, replica: this.replica, pending: this.pending, now: () => this.at })
      .enqueue(operation, { requestId: operationId, authorityEpochId: "epoch", actor: "foreground-agent" }, bank);
  }

  row(record: PendingMemoryRecord) { return this.pending.get(pendingMemoryRef(record))!; }
  advance(ms: number) { this.at = new Date(Date.parse(this.at) + ms).toISOString(); }
  authorityState() { return { epochs: this.db.prepare("SELECT * FROM canonical_memory_authority_epochs").all(),
    pointer: this.db.prepare("SELECT * FROM canonical_memory_authority_state").all(),
    selection: this.db.prepare("SELECT * FROM memory_authority_selection").all(),
    receipts: this.db.prepare("SELECT * FROM hindsight_authority_activation_receipts").all() }; }
  switchAuthority() {
    this.db.transaction(() => this.db.exec(`
      UPDATE canonical_memory_authority_epochs SET status='closed',ended_at='${this.at}' WHERE epoch_id='epoch';
      INSERT INTO canonical_memory_authority_epochs
        (epoch_id,provider_id,provider_lineage_id,status,predecessor_epoch_id,started_at,ended_at,reason)
        VALUES ('successor-epoch','local','successor-lineage','active','epoch','${this.at}',NULL,'planned-switch');
      UPDATE canonical_memory_authority_state SET active_epoch_id='successor-epoch',updated_at='${this.at}' WHERE singleton=1;
    `));
  }
  reopen() {
    this.db.close(); this.db = this.open(); this.replica = this.createReplica();
    this.pending = createPendingMemoryRepo(this.db, () => this.at); this.authority = createCanonicalMemoryAuthorityRepo(this.db);
    this.schedule = createHindsightReplicaSchedulerRepo(this.db, () => this.at);
  }
  runner() {
    return createHindsightPendingRecoveryRunner({ client: this.client, replica: this.replica, pending: this.pending,
      authority: this.authority, projection: this.projection, connection, secretMarker: "dummy-generation",
      derivedCompletion: this.port, now: () => this.at });
  }
  claim(bank = globalBank) {
    this.schedule.requestManual({ bankId: bank.bankId, kind: "incremental" });
    const run = this.schedule.claim({ bankId: bank.bankId, ownerId: "fixture-recovery", leaseDurationMs: 61_000 })!;
    return { bank, run, signal: new AbortController().signal };
  }
  async execute(bank = globalBank) {
    const input = this.claim(bank);
    try {
      const result = await this.runner().run(input);
      this.schedule.succeed({ run: input.run, result });
      return result;
    } catch (error) {
      this.fail(input.run, error);
      throw error;
    }
  }
  scheduler() {
    const scheduler = createHindsightReplicaScheduler({ repo: this.schedule, replica: this.replica,
      banks: [globalBank, characterBank], runner: this.runner(), ownerId: "fixture-supervisor",
      setTimer: () => ({ unref: () => undefined } as unknown as ReturnType<typeof setTimeout>), clearTimer: () => undefined });
    schedulers.push(scheduler); return scheduler;
  }
  useProvenFixtureFence() {
    this.port = { check: async ({ request }) => {
      this.events.push(`derived:${request.operationId}`);
      const bank = this.banks.get(request.bankId)!;
      if (!this.derived.has(request.operationId)) {
        this.append(bank, [{ objectKind: "mental_model", objectId: `derived-${request.operationId}`, objectRevision: bank.cursor + 1,
          payload: { kind: "mental_model", value: { bankId: request.bankId, mentalModelId: `derived-${request.operationId}`,
            subtype: "mental_model", name: "Fixture derivation", sourceQuery: null, content: "derived fixture content", tags: [],
            maxTokens: 128, trigger: null, lastRefreshedAt: this.at, createdAt: this.at, reflectResponse: null, structuredContent: null } } }]);
        this.derived.add(request.operationId);
      }
      return { status: "completed", evidence: { schemaVersion: 1, evidenceId: `fixture-proof-${request.operationId}`,
        authorityEpochId: request.authorityEpochId, providerLineageId: request.providerLineageId, bankGeneration: request.bankGeneration,
        bankId: request.bankId, operationId: request.operationId, nativeReceiptHash: request.nativeReceiptHash,
        throughCursor: bank.cursor, completedAt: this.at } };
    } };
  }

  externalEdit(bankId: string, patch: Partial<CanonicalMemoryUnit>) {
    const bank = this.banks.get(bankId)!;
    const existing = bank.records.get(`memory_unit:${memoryId}`)!;
    if (existing.payload.kind !== "memory_unit") throw new Error("fixture kind");
    const unit = CanonicalMemoryUnitSchema.parse({ ...existing.payload.value, authorityEpochId: "epoch" });
    this.append(bank, [memoryRecord(bankId, memoryId, { ...unit, ...patch, revision: existing.objectRevision + 1 })]);
  }

  deleteTarget(bankId: string) {
    const bank = this.banks.get(bankId)!; const existing = bank.records.get(`memory_unit:${memoryId}`)!;
    bank.records.delete(recordKey(existing)); bank.cursor += 1;
    bank.changes.push({ providerLineageId: this.providerLineage, bankGeneration: bank.generation,
      cursor: bank.cursor, batchId: randomUUID(), batchIndex: 0, batchSize: 1, recordedAt: this.at,
      objectKind: "memory_unit", objectId: memoryId, objectRevision: existing.objectRevision + 1, operation: "tombstone", payload: null });
  }

  complete(operationId: string) {
    const operation = this.operations.get(operationId)!; const bank = this.banks.get(operation.bankId)!;
    const source = sourceRecord(operation.bankId, operation.documentId, { content: operation.content, revision: bank.cursor + 1 });
    const memories = operation.content === "zero" ? [] : [memoryRecord(operation.bankId, randomUUID(), {
      documentId: operation.documentId, text: operation.content, mentionedAt: this.at,
      eventDate: operation.timestamp === "unset" ? null : operation.timestamp,
    })];
    operation.memories = memories.map((record) => ({ memoryId: record.objectId, revision: record.objectRevision }));
    this.append(bank, [source, ...memories]); operation.status = "completed";
  }

  private fail(run: MemoryReplicaScheduledRun, error: unknown) {
    try { this.schedule.fail({ run, errorCode: replicaErrorCode(error) }); }
    catch (failure) { if (!replicaOwnershipLost(failure)) throw failure; }
  }
  private open() { const db = openDatabase({ path: this.path, migrations: MIGRATIONS }); dbs.push(db); return db; }
  private createReplica() { return createHindsightReplicaSyncRepo({ db: this.db, projection: this.projection,
    tokenizer: createIntlSegmenterTokenizer({ stoplist: true }), now: () => this.at }); }
  private documentText(id: string) { return [...this.operations.values()].find((value) => value.documentId === id)?.content ?? "seed source"; }

  private respond(url: URL, init: RequestInit): HindsightTransportResponse {
    if (url.pathname === "/health") return json({ status: "healthy", database: "connected" });
    if (url.pathname === "/version") return json({ api_version: "0.9.0" });
    if (url.pathname === "/ext/taki-memory/version") return json(compatibility(this.providerLineage));
    const parts = url.pathname.split("/"); const bankId = decodeURIComponent(parts[4]!); const bank = this.banks.get(bankId)!;
    if (parts[5] === "changes") {
      const after = Number(url.searchParams.get("after_cursor")); this.events.push(`pull:${bankId}:${after}`);
      const changes = bank.changes.filter((change) => change.cursor > after);
      return json({ provider_lineage: this.providerLineage, bank_generation: bank.generation, from_cursor: after,
        next_cursor: changes.at(-1)?.cursor ?? after, current_cursor: bank.cursor, minimum_available_cursor: 0, has_more: false,
        changes: changes.map(wireChange) });
    }
    if (parts[5] === "snapshots") return this.snapshot(bank, parts, init);
    if (parts[5] === "memories" && init.method === "POST") return this.retain(bank, JSON.parse(String(init.body)));
    if (parts[5] === "memories" && init.method === "PATCH") return this.mutate(bank, parts[6]!, JSON.parse(String(init.body)));
    if (parts[5] === "operations") {
      this.events.push(`native:${parts[6]}`); const operation = this.operations.get(parts[6]!);
      return json({ operation_id: parts[6], status: operation?.status ?? "not_found", operation_type: operation ? "batch_retain" : null,
        result_metadata: operation?.status === "completed" ? { unit_ids_count: operation.memories.length,
          extraction_errors_count: 0, private_debug: "never persist this raw provider metadata" } : null });
    }
    if (parts[5] === "documents") return this.document(bankId, decodeURIComponent(parts[6]!));
    if (parts[5] === "memories" && parts[6] === "list") return this.facts(bankId, url);
    throw new Error(`unexpected offline request: ${url.pathname}`);
  }

  private retain(bank: RemoteBank, body: { operation_id: string; async: boolean; items: Array<{ document_id: string; content: string; timestamp: string }> }) {
    expect(body.async).toBe(true); expect(body.items).toHaveLength(1);
    this.events.push(`retain:${body.operation_id}`);
    if (!this.operations.has(body.operation_id)) {
      const item = body.items[0]!;
      this.operations.set(body.operation_id, { bankId: bank.bank.bankId, documentId: item.document_id,
        content: item.content, timestamp: item.timestamp, status: "pending", memories: [] });
      if (this.autoComplete) this.complete(body.operation_id);
    }
    return json({ success: true, async: true, bank_id: bank.bank.bankId, items_count: 1, operation_id: body.operation_id, operation_ids: null });
  }

  private mutate(bank: RemoteBank, id: string, body: Record<string, unknown>) {
    this.events.push(`mutate:${String(body.mutation_id)}`);
    const key = String(body.mutation_id); const identity = canonicalJson({ bankId: bank.bank.bankId, id, body });
    const prior = this.mutations.get(key);
    if (prior) return prior.identity === identity ? json(prior.result)
      : { status: 409, body: JSON.stringify({ error: "memory_mutation_id_conflict", memory_id: id, mutation_id: key }) };
    const record = bank.records.get(`memory_unit:${id}`);
    if (record?.payload.kind !== "memory_unit") return { status: 404, body: "private missing detail" };
    if (body.expected_revision !== record.objectRevision) return { status: 412, body: JSON.stringify({
      error: "memory_revision_mismatch", memory_id: id, expected_revision: body.expected_revision, current_revision: record.objectRevision }) };
    const unit = CanonicalMemoryUnitSchema.parse({ ...record.payload.value, authorityEpochId: "epoch" });
    const changed = body.state === undefined || body.state !== unit.state || (body.state === "invalidated" && body.reason !== unit.invalidationReason);
    const entities = body.entities === undefined ? unit.entities : body.entities as string[];
    const state = (body.state ?? unit.state) as "valid" | "invalidated";
    const next = memoryRecord(bank.bank.bankId, id, { ...unit, text: body.text as string | undefined ?? unit.text,
      context: body.context === undefined ? unit.context : body.context === "" ? null : body.context as string,
      entities, tags: [...unit.tags.filter((tag) => !tag.startsWith("taki-layer:")), ...entities.filter((entity) => entity.startsWith("taki-layer:"))],
      state, revision: unit.revision + (changed ? 1 : 0), editedAt: changed ? this.at : unit.editedAt,
      invalidatedAt: state === "invalidated" ? this.at : null, invalidationReason: state === "invalidated" ? body.reason as string | null : null });
    if (changed) { this.append(bank, [next]); this.appliedMutations += 1; }
    if (next.payload.kind !== "memory_unit") throw new Error("fixture kind");
    const result = nativeMutation(next.payload.value);
    this.mutations.set(key, { identity, result }); return json(result);
  }

  private document(bankId: string, documentId: string) {
    const operation = [...this.operations.values()].find((value) => value.bankId === bankId && value.documentId === documentId);
    if (!operation || operation.status !== "completed") return { status: 404, body: "document missing" };
    return json({ id: documentId, bank_id: bankId, original_text: operation.content,
      content_hash: createHash("sha256").update(operation.content).digest("hex"), memory_unit_count: operation.memories.length, updated_at: this.at });
  }

  private facts(bankId: string, url: URL) {
    const documentId = url.searchParams.get("document_id")!;
    const operation = [...this.operations.values()].find((value) => value.bankId === bankId && value.documentId === documentId)!;
    const offset = Number(url.searchParams.get("offset")); const limit = Number(url.searchParams.get("limit"));
    return json({ total: operation.memories.length, limit, offset, items: operation.memories.slice(offset, offset + limit)
      .map((value) => ({ id: value.memoryId, revision: value.revision, document_id: documentId, bank_id: bankId })) });
  }

  private snapshot(bank: RemoteBank, parts: string[], init: RequestInit) {
    if (init.method === "POST") {
      const snapshot = capture(bank, this.at); this.snapshots.set(snapshot.metadata.snapshotId, snapshot);
      return json(wireMetadata(snapshot.metadata));
    }
    const snapshot = this.snapshots.get(parts[6]!)!;
    if (parts[7] !== "pages") return json(wireMetadata(snapshot.metadata));
    const page = snapshot.pages[Number(parts[8])]!;
    return json({ snapshot_id: page.snapshotId, page_number: page.pageNumber, total_pages: page.totalPages,
      record_count: page.recordCount, content_sha256: page.contentHash, records: page.records.map(wireRecord) });
  }

  private append(bank: RemoteBank, records: HindsightLogicalSnapshotRecord[]) {
    const batchId = randomUUID();
    for (const [index, record] of records.entries()) {
      bank.records.set(recordKey(record), structuredClone(record)); bank.cursor += 1;
      bank.changes.push({ ...structuredClone(record), providerLineageId: this.providerLineage, bankGeneration: bank.generation,
        operation: "upsert", cursor: bank.cursor, batchId, batchSize: records.length, batchIndex: index, recordedAt: this.at });
    }
  }
}

function retain(content = "recovered reading plan", bankId = "global"): PendingMemoryOperation {
  return { kind: "retain", zeroResultAllowed: true, request: { bankId, content, context: "original context", timestamp: null,
    tags: ["scope-tag"], entities: ["Alice"], metadata: { source: "original", structured: { sequence: 4 } }, observationScopes: "shared",
    documentId: null, strategy: null, updateMode: "replace", provenance: provenance(bankId),
    policy: { layerId: "profile", importance: 5, visibility: "retrieved", disclosure: null, origin: "self", emotionalWeight: null,
      retention: { kind: "permanent" }, policyVersion: 1 } } };
}
function mutation(request: Partial<Extract<MutationRequest, { kind: "edit" }>> = {}): PendingMemoryOperation {
  return { kind: "mutation", request: { kind: "edit", bankId: "global", memoryId, expectedRevision: 1, patch: { text: "corrected memory" }, ...request } };
}
function provenance(bankId: string) { return { actor: "user" as const, origin: "explicit-user" as const,
  characterId: bankId === "global" ? null : "taki", timelineFromSeq: 1, timelineToSeq: 2, capturedAt: at, sanitized: true as const, sourceRef: "fixture-source" }; }
function canonical(bankId: string, id: string, patch: Partial<CanonicalMemoryUnit> = {}): CanonicalMemoryRecord {
  return { unit: { authorityEpochId: "epoch", bankId, memoryId: id, documentId: "seed-doc", chunkId: null,
    text: "original memory", context: "original context", factType: "experience", state: "valid", revision: 1,
    tags: ["taki-layer:profile", "keep-tag"], metadata: {}, entities: ["Alice", "taki-layer:profile"], sourceMemoryIds: [], observationScopes: null,
    eventDate: null, occurredStart: null, occurredEnd: null, mentionedAt: at, createdAt: at, updatedAt: at, editedAt: null,
    consolidatedAt: null, consolidationFailedAt: null, invalidationReason: null, invalidatedAt: null, proofCount: 1, ...patch },
  policy: { authorityEpochId: "epoch", bankId, memoryId: id, layerId: "profile", importance: 5, visibility: "retrieved", disclosure: null,
    origin: "self", emotionalWeight: null, retention: { kind: "permanent" }, policyVersion: 1, updatedAt: at }, provenance: provenance(bankId) };
}
function memoryRecord(bankId: string, id: string, patch: Partial<CanonicalMemoryUnit> = {}): HindsightLogicalSnapshotRecord {
  const { authorityEpochId: epoch, ...unit } = canonical(bankId, id, patch).unit; void epoch;
  return { objectKind: "memory_unit", objectId: id, objectRevision: unit.revision, payload: { kind: "memory_unit", value: unit } };
}
function bankRecord(bankId: string): HindsightLogicalSnapshotRecord {
  return { objectKind: "bank", objectId: bankId, objectRevision: 1, payload: { kind: "bank", value: { bankId,
    name: "Offline fixture", disposition: { skepticism: 3, literalism: 3, empathy: 3 }, mission: "remember", config: {}, createdAt: at, updatedAt: at } } };
}
function sourceRecord(bankId: string, documentId: string, input: { content: string; revision?: number }): HindsightLogicalSnapshotRecord {
  return { objectKind: "document", objectId: documentId, objectRevision: input.revision ?? 2, payload: { kind: "document", value: { bankId,
    documentId, contentHash: createHash("sha256").update(input.content).digest("hex"), tags: [], metadata: {}, observationScopes: null, createdAt: at, updatedAt: at } } };
}
function nativeMutation(unit: Extract<HindsightLogicalSnapshotRecord["payload"], { kind: "memory_unit" }>["value"]): Record<string, unknown> {
  return { id: unit.memoryId, text: unit.text, context: unit.context ?? "", date: unit.eventDate ?? "", type: unit.factType,
    mentioned_at: unit.mentionedAt, occurred_start: unit.occurredStart, occurred_end: unit.occurredEnd, entities: unit.entities,
    document_id: unit.documentId, chunk_id: unit.chunkId, tags: unit.tags, metadata: unit.metadata, observation_scopes: unit.observationScopes,
    state: unit.state, invalidation_reason: unit.invalidationReason, invalidated_at: unit.invalidatedAt, edited_at: unit.editedAt, revision: unit.revision };
}
function recordKey(record: HindsightLogicalSnapshotRecord) { return `${record.objectKind}:${record.objectId}`; }
function snake(value: object) { return Object.fromEntries(Object.entries(value).map(([key, item]) => [key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`), item])); }
function wireRecord(record: HindsightLogicalSnapshotRecord) { return { object_kind: record.objectKind, object_id: record.objectId,
  object_revision: record.objectRevision, payload: snake(record.payload.value) }; }
function wireChange(change: HindsightJournalChange) { return { object_kind: change.objectKind, object_id: change.objectId,
  object_revision: change.objectRevision, payload: change.payload ? snake(change.payload.value) : null, operation: change.operation,
  provider_lineage: change.providerLineageId, bank_generation: change.bankGeneration, cursor: change.cursor,
  batch_id: change.batchId, batch_index: change.batchIndex, batch_size: change.batchSize, recorded_at: change.recordedAt }; }
function json(value: unknown): HindsightTransportResponse { return { status: 200, body: canonicalJson(value) }; }
function capture(bank: RemoteBank, now: string) {
  const snapshotId = randomUUID(); const records = [...bank.records.values()];
  const pages = records.map((record, pageNumber) => ({ snapshotId, pageNumber, totalPages: records.length, recordCount: 1,
    contentHash: createHash("sha256").update(canonicalJson([wireRecord(record)])).digest("hex"), records: [record] }));
  const count = (kind: string) => records.filter((record) => record.objectKind === kind).length;
  const invalidated = records.filter((record) => record.payload.kind === "memory_unit" && record.payload.value.state === "invalidated").length;
  const metadata: HindsightLogicalSnapshotMetadata = { snapshotId, createdAt: now, expiresAt: new Date(Date.parse(now) + 3600_000).toISOString(),
    manifest: { schemaVersion: 1, bankId: bank.bank.bankId, providerLineage: lineage, bankGeneration: bank.generation,
      endCursor: bank.cursor, pageSize: 1, totalPages: pages.length, totalRecords: records.length,
      counts: { bank: count("bank"), document: count("document"), memoryUnit: { valid: count("memory_unit") - invalidated, invalidated },
        mentalModel: count("mental_model"), directive: count("directive"), total: records.length },
      pageHashes: pages.map((page) => page.contentHash), manifestDigest: "0".repeat(64) } };
  metadata.manifest.manifestDigest = snapshotManifestHash(metadata); return { metadata, pages };
}
function wireMetadata(value: HindsightLogicalSnapshotMetadata) {
  const m = value.manifest;
  return { snapshot_id: value.snapshotId, created_at: value.createdAt, expires_at: value.expiresAt,
    manifest: { schema_version: 1, bank_id: m.bankId, provider_lineage: m.providerLineage, bank_generation: m.bankGeneration,
      end_cursor: m.endCursor, page_size: m.pageSize, total_pages: m.totalPages, total_records: m.totalRecords,
      counts: { bank: m.counts.bank, document: m.counts.document, memory_unit: m.counts.memoryUnit,
        mental_model: m.counts.mentalModel, directive: m.counts.directive, total: m.counts.total }, page_hashes: m.pageHashes, sha256: m.manifestDigest } };
}
function compatibility(providerLineage: string) {
  const support = { state: "supported", reason: "all_contracts_available" }; const contract = { version: "1.0.0", support };
  return { base_api_version: "0.9.0", compatibility_version: "1.0.0", source_identity: { upstream_commit: "offline", compatibility_build: "taki-memory-hindsight-0.9.0-batch0-v2" },
    provider: { lineage: providerLineage, database_dialect: "postgresql", storage_mode: "sql_rows" }, support,
    journal: { schema_version: 1, retention_mode: "operator_managed_cursor_floor", cursor_reset_supported: true },
    snapshot: { schema_version: 1, default_page_size: 500, max_page_size: 1000, default_ttl_seconds: 3600, max_ttl_seconds: 86400 },
    contracts: { change_journal: contract, conditional_mutation: contract, logical_snapshot: contract, additive_observation_instructions: contract, controlled_layer_projection: contract } };
}
function seedAuthority(db: Database) {
  db.exec(`INSERT INTO canonical_memory_authority_epochs
    (epoch_id,provider_id,provider_lineage_id,status,predecessor_epoch_id,started_at,ended_at,reason)
    VALUES ('local-epoch','local','local-lineage','closed',NULL,'${at}','${at}','initial-local'),
      ('epoch','hindsight','${lineage}','active','local-epoch','${at}',NULL,'planned-switch');
    INSERT INTO canonical_memory_authority_state (singleton,active_epoch_id,updated_at) VALUES (1,'epoch','${at}');
    INSERT INTO memory_migration_runs (run_id,snapshot_id,phase,status,requested_at,updated_at,lease_fence)
      VALUES ('fixture-run','fixture-snapshot','verified','ready','${at}','${at}',1);
    UPDATE memory_authority_selection SET mode='hindsight',active_epoch_id='epoch',provider_lineage_id='${lineage}',
      verified_snapshot_id=NULL,activation_transaction_id='fixture-activation',replica_checkpoint_digest='${"a".repeat(64)}',updated_at='${at}' WHERE singleton=1;
    INSERT INTO hindsight_authority_activation_receipts
      (transaction_id,run_id,predecessor_epoch_id,hindsight_epoch_id,provider_lineage,config_fingerprint,checkpoint_set_digest,bank_count,lease_fence,committed_at)
      VALUES ('fixture-activation','fixture-run','local-epoch','epoch','${lineage}','${"b".repeat(64)}','${"c".repeat(64)}',2,1,'${at}');`);
}
function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
