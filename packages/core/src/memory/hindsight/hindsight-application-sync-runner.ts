/**
 * INPUT:  authenticated D77 state, captured authority/Bank leases and complete native/application checkpoints
 * OUTPUT: atomic joint snapshot/event publication through the existing B5 scheduler interface; a binding CAS conflict
 *         re-pulls and retries a bounded number of consecutive times before failing the run; a native head behind Core's
 *         own checkpoint in the same lineage and generation, reported by a reset refusal or by a full run's initialize,
 *         surfaces as a rollback before any snapshot, never a rebuild or a stale publication
 * POS:    core/memory/hindsight — application-aware pull; policy binding runs between complete pulls, never in SQL transactions
 */
import { z } from "zod";
import {
  HINDSIGHT_APPLICATION_DEFAULT_TTL_SECONDS, MemoryReplicaBankSchema,
  type MemoryBankScope, type MemoryAuthorityEpoch, type MemoryReplicaRunResult, type TakiApplicationCheckpoint,
} from "@taki/shared";
import type { CanonicalMemoryAuthorityRepo } from "../../db/canonical-memory-authority-repo.ts";
import type { HindsightApplicationReplicaRepo, HindsightApplicationReplicaCheckpoint } from "../../db/hindsight-application-replica-contract.ts";
import type { HindsightClient, HindsightCallContext } from "./hindsight-client.ts";
import type { HindsightCompatibilityWire } from "./hindsight-contracts.ts";
import { HindsightApplicationRefusal, type HindsightApplicationClient } from "./hindsight-application-client.ts";
import { HindsightRollbackError } from "./hindsight-cursor-reset.ts";
import { admitHindsightApplication, requireHindsightApplicationClient } from "./hindsight-application-capability.ts";
import { captureHindsightApplicationBaseline, snapshotHindsightApplication, loadHindsightApplicationEvent } from "./hindsight-application-bundle-loader.ts";
import { requireApplicationScope, sameApplicationValue, type HindsightApplicationScope } from "./hindsight-application-integrity.ts";
import type { HindsightReplicaRunInput, HindsightReplicaSchedulerRunner } from "./hindsight-replica-sync-runner.ts";

export interface HindsightApplicationBindingPass extends HindsightApplicationScope {
  authorityEpochId: string;
  bank: HindsightReplicaRunInput["bank"];
  checkpoint: HindsightApplicationReplicaCheckpoint;
  request(): HindsightCallContext;
}
/** Consecutive binding CAS conflicts re-pulled within one run before the conflict fails it. */
const BIND_CONFLICT_RETRIES = 3;

interface Dependencies {
  client: HindsightClient;
  repo: HindsightApplicationReplicaRepo;
  authority: CanonicalMemoryAuthorityRepo;
  bankScope(bankId: string): MemoryBankScope;
  requestTimeoutMs: number;
  deadlineMs?: number;
  now?: () => string;
  bind?: (input: HindsightApplicationBindingPass) => Promise<boolean>;
  onAdmission?: (manifest: HindsightCompatibilityWire) => void;
}
interface Context {
  deps: Dependencies;
  client: HindsightClient & HindsightApplicationClient;
  input: HindsightReplicaRunInput;
  authority: MemoryAuthorityEpoch;
  request(): HindsightCallContext;
  deadlineAt?: string;
  now(): string;
}

export function createHindsightApplicationSyncRunner(deps: Dependencies): HindsightReplicaSchedulerRunner & {
  stop(): void; settle(): Promise<void>;
} {
  const shutdown = new AbortController(); const active = new Set<Promise<MemoryReplicaRunResult>>();
  const execute = (input: HindsightReplicaRunInput, reset: boolean) => {
    const signal = AbortSignal.any([input.signal, shutdown.signal]);
    const work = synchronize(capture(deps, { ...input, signal }), reset);
    active.add(work);
    void work.finally(() => active.delete(work)).catch(() => undefined);
    return work;
  };
  return { run: (input) => execute(input, false), rebuild: (input) => execute(input, true),
    stop: () => shutdown.abort(), settle: async () => { await Promise.allSettled(active); } };
}

function capture(deps: Dependencies, input: HindsightReplicaRunInput): Context {
  const authority = deps.authority.authorityEpoch();
  if (authority.providerId !== "hindsight") throw new Error("HINDSIGHT_PENDING_AUTHORITY_MISMATCH");
  if (input.expectedAuthority && (input.expectedAuthority.epochId !== authority.epochId
    || input.expectedAuthority.providerLineageId !== authority.providerLineageId)) throw new Error("HINDSIGHT_PENDING_AUTHORITY_MISMATCH");
  const bank = MemoryReplicaBankSchema.parse(input.bank);
  const now = () => z.iso.datetime({ offset: true }).parse(deps.now?.() ?? new Date().toISOString());
  // An explicitly supplied operation deadline always wins over an optional
  // process-local foreground owner; it must never become a renewable budget.
  const foreground = input.deadlineAt === undefined ? input.foreground : undefined;
  const deadlineAt = foreground ? undefined
    : input.deadlineAt ?? new Date(Date.parse(now()) + (deps.deadlineMs ?? 60_000)).toISOString();
  const context: Context = { deps, input: { ...input, bank, foreground }, client: requireHindsightApplicationClient(deps.client),
    authority, now, deadlineAt, request: () => requestContext(context) };
  context.request();
  if (!sameApplicationValue(deps.repo.nativeCheckpoint(bank.bankId) ?? null, input.run.predecessor)) {
    throw new Error("HINDSIGHT_CHECKPOINT_STALE");
  }
  return context;
}

function requestContext(context: Context): HindsightCallContext {
  const guard = publicationGuard(context);
  const foreground = context.input.foreground?.request();
  const remaining = foreground?.timeoutMs ?? Date.parse(guard.deadlineAt) - Date.parse(context.now());
  if (remaining <= 0) throw new Error("HINDSIGHT_DEADLINE_EXCEEDED");
  return { timeoutMs: Math.min(context.deps.requestTimeoutMs, remaining), signal: context.input.signal };
}

function publicationGuard(context: Context) {
  const { deps, input, authority } = context;
  if (input.signal.aborted) throw new Error("HINDSIGHT_CANCELLED");
  const lease = input.foreground?.current() ?? input.run.lease;
  deps.repo.leases.assert(lease);
  if (lease.bankId !== input.run.lease.bankId || lease.runId !== input.run.lease.runId
    || lease.ownerId !== input.run.lease.ownerId || lease.fence !== input.run.lease.fence) throw new Error("HINDSIGHT_REPLICA_LEASE_LOST");
  const active = deps.authority.authorityEpoch(); const scope = deps.bankScope(input.bank.bankId);
  if (active.providerId !== "hindsight" || active.epochId !== authority.epochId || active.providerLineageId !== authority.providerLineageId
    || lease.bankId !== input.bank.bankId || scope.kind !== input.bank.scope || scope.characterId !== input.bank.characterId) {
    throw new Error("HINDSIGHT_PENDING_AUTHORITY_MISMATCH");
  }
  const deadlineAt = input.foreground ? lease.expiresAt : context.deadlineAt;
  if (!deadlineAt || Date.parse(deadlineAt) <= Date.parse(context.now())) throw new Error("HINDSIGHT_DEADLINE_EXCEEDED");
  return { lease, deadlineAt };
}

async function synchronize(context: Context, reset: boolean): Promise<MemoryReplicaRunResult> {
  const { deps, input } = context;
  const admitted = await admitHindsightApplication({ client: context.client, request: context.request, expectedLineage: context.authority.providerLineageId });
  context.request(); deps.onAdmission?.(admitted.manifest);
  let checkpoint = deps.repo.checkpoint(input.bank.bankId);
  if (reset || input.run.kind === "full" || !checkpoint) checkpoint = await full(context, reset);
  else {
    try { checkpoint = await incremental(context, checkpoint); }
    catch (error) {
      if (error instanceof HindsightApplicationRefusal && error.refusal.code === "namespace_mismatch") {
        throw new Error("HINDSIGHT_REPLICA_GENERATION_MISMATCH", { cause: error });
      }
      if (!(error instanceof HindsightApplicationRefusal) || error.refusal.code !== "state_reset_required") throw error;
      refuseRollback(error.refusal.checkpoint, deps.repo.checkpoint(input.bank.bankId) ?? checkpoint);
      checkpoint = await full(context, true);
    }
  }
  checkpoint = await bindPasses(context, checkpoint);
  context.request();
  return { checkpoint: checkpoint.native, observedCursor: checkpoint.checkpoint.native_cursor };
}

async function bindPasses(context: Context, initial: HindsightApplicationReplicaCheckpoint): Promise<HindsightApplicationReplicaCheckpoint> {
  const { deps, input } = context; let checkpoint = initial; let conflicts = 0;
  // Neutral/rebinding commands have their own immutable receipts. A receipt is
  // followed by a complete pull before any new policy becomes locally readable.
  while (!checkpoint.bankDeleted && deps.bind) {
    try {
      if (!await deps.bind({ bankId: input.bank.bankId, namespace: checkpoint.namespace, authorityEpochId: context.authority.epochId,
        bank: input.bank, checkpoint, request: context.request })) return checkpoint;
      conflicts = 0;
    } catch (error) {
      // Native consolidation can advance a unit between the pull and its binding CAS. The refused receipt is durable
      // for that exact intent only, so a fresh pull yields a new intent against the newer version.
      if (!bindingConflict(error) || ++conflicts > BIND_CONFLICT_RETRIES) throw error;
    }
    context.request();
    checkpoint = await incremental(context, checkpoint);
  }
  return checkpoint;
}

/** A native head behind Core in Core's own namespace is a restore without Core's copy (§5.7); rebuilding would absorb it. */
function refuseRollback(native: TakiApplicationCheckpoint | null | undefined, current: HindsightApplicationReplicaCheckpoint): void {
  if (!native || native.state_cursor >= current.checkpoint.state_cursor && native.native_cursor >= current.checkpoint.native_cursor) return;
  throw new HindsightRollbackError({ providerLineageId: current.namespace.provider_lineage, bankGeneration: current.namespace.bank_generation });
}

function bindingConflict(error: unknown): boolean {
  return error instanceof HindsightApplicationRefusal
    && (error.refusal.code === "native_version_conflict" || error.refusal.code === "artifact_conflict");
}

async function full(context: Context, reset: boolean): Promise<HindsightApplicationReplicaCheckpoint> {
  const { deps, input, client } = context;
  const previous = deps.repo.checkpoint(input.bank.bankId) ?? null;
  const native = deps.repo.nativeCheckpoint(input.bank.bankId) ?? null;
  const scope = await resolveSnapshotScope(context, reset ? null : previous);
  const head = await client.initializeApplication({ ...scope, context: context.request() });
  context.request();
  const sameGeneration = previous !== null && sameApplicationValue(previous.namespace, scope.namespace);
  if (sameGeneration) refuseRollback(head.checkpoint, previous);
  // One complete snapshot can span many individually bounded HTTP requests.
  // Passing only request() would turn its per-request cap into a second, shorter
  // deadline for the entire body closure and discard every partial cold read.
  const load = { ...scope, client, context: context.request(), request: context.request, ...bodyCache(context, scope) };
  const captured = sameGeneration ? { bundle: await snapshotHindsightApplication(load) }
    : await captureHindsightApplicationBaseline({ ...load, nativeClient: client });
  context.request();
  const publication = { ...scope, ...captured, authorityEpochId: context.authority.epochId,
    expectedBank: input.bank, expectedCheckpoint: previous, expectedNativeCheckpoint: native,
    ...publicationGuard(context), reset: reset || previous !== null && !sameGeneration };
  return previous ? deps.repo.reconcileVerifiedSnapshot(publication) : deps.repo.seedVerifiedSnapshot(publication);
}

async function resolveSnapshotScope(context: Context, previous: HindsightApplicationReplicaCheckpoint | null): Promise<HindsightApplicationScope> {
  const bankId = context.input.bank.bankId;
  if (previous) return { bankId, namespace: previous.namespace };
  const createNative = context.client.createLogicalSnapshot;
  if (!createNative) throw new Error("HINDSIGHT_SNAPSHOT_CLIENT_UNAVAILABLE");
  const native = await createNative({ bankId, pageSize: 1, ttlSeconds: HINDSIGHT_APPLICATION_DEFAULT_TTL_SECONDS, context: context.request() });
  context.request();
  if (native.manifest.bankId !== bankId || native.manifest.providerLineage !== context.authority.providerLineageId) {
    throw new Error("HINDSIGHT_REPLICA_LINEAGE_MISMATCH");
  }
  return { bankId, namespace: { application_id: "taki", provider_lineage: native.manifest.providerLineage,
    bank_generation: native.manifest.bankGeneration } };
}

async function incremental(context: Context, initial: HindsightApplicationReplicaCheckpoint): Promise<HindsightApplicationReplicaCheckpoint> {
  let checkpoint = initial;
  while (!checkpoint.bankDeleted) {
    const scope = { bankId: checkpoint.bankId, namespace: checkpoint.namespace };
    const page = await context.client.applicationChanges({ ...scope, afterStateCursor: checkpoint.checkpoint.state_cursor,
      limit: 128, context: context.request() });
    context.request(); requireApplicationScope(page, scope);
    if (!sameApplicationValue(page.from_checkpoint, checkpoint.checkpoint)
      || page.minimum_state_cursor > checkpoint.checkpoint.state_cursor) invalidPage();
    for (const manifest of page.changes) {
      if (!sameApplicationValue(manifest.from_checkpoint, checkpoint.checkpoint)) invalidPage();
      const event = await loadHindsightApplicationEvent({ ...scope, manifest, client: context.client,
        context: context.request(), request: context.request, ...bodyCache(context, scope) });
      context.request();
      checkpoint = context.deps.repo.applyEvent({ ...scope, event, authorityEpochId: context.authority.epochId,
        expectedBank: context.input.bank, expectedCheckpoint: checkpoint, expectedNativeCheckpoint: checkpoint.native,
        ...publicationGuard(context) });
    }
    if (!sameApplicationValue(page.to_checkpoint, checkpoint.checkpoint) || page.has_more && page.changes.length === 0) invalidPage();
    if (!page.has_more) return checkpoint;
  }
  return checkpoint;
}

function bodyCache(context: Context, scope: HindsightApplicationScope) {
  const repo = context.deps.repo;
  const guard = { ...scope, authorityEpochId: context.authority.epochId, expectedBank: context.input.bank,
    expectedCheckpoint: repo.checkpoint(scope.bankId) ?? null, expectedNativeCheckpoint: repo.nativeCheckpoint(scope.bankId) ?? null };
  // Namespace and exact descriptor checks permit retrying a partially downloaded
  // cold snapshot, while a replacement generation cannot inherit former bytes.
  return {
    cachedBody: (ref: Parameters<typeof repo.cachedBody>[0]["ref"]) => repo.cachedBody({ ...guard, ...publicationGuard(context), ref }),
    cacheBodies: (bodies: Parameters<typeof repo.cacheBodies>[0]["bodies"]) => repo.cacheBodies({ ...guard, ...publicationGuard(context), bodies }),
  };
}

function invalidPage(): never { throw new Error("HINDSIGHT_APPLICATION_CHANGE_PAGE_INVALID"); }
