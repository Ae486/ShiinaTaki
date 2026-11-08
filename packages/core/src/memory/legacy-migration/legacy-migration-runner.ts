/**
 * INPUT:  Core-minted run/transaction identities, the Core workspace root, Database, the shared authority fence, a live clock
 *         and the optional custody reconciler run before resume/activation
 * OUTPUT: cooperative prepare/resume conversion, pure verify, exclusion, and the fenced activation commit + Local bind callback
 * POS:    core/memory/legacy-migration — on-demand offline orchestrator driven only by the Local onboarding service
 */
import type { MemoryMigrationActivation, MemoryMigrationReport, MemoryMigrationStatus, MemoryMigrationVerify } from "@taki/shared";
import type { Database } from "../../db/sqlite.ts";
import { activateCanonicalLocal, readCurrentMemoryAuthorityIdentity } from "./legacy-activation-repo.ts";
import { ensureManifestInventory, publishMigrationBlocks, publishMigrationCandidate, requireMigrationRun } from "./legacy-candidate-repo.ts";
import { excludeLegacySource, type ExclusionInput } from "./legacy-migration-exclusion.ts";
import { sourceIdentity } from "./legacy-identities.ts";
import { createLegacyMigrationLedgerRepo, type Lease, type LegacyMigrationLedgerRepo } from "./legacy-migration-ledger-repo.ts";
import {
  BLOCKING_DISPOSITIONS, dryRunLegacyMigration, previewLegacyMigration, readMigrationExceptions, readMigrationStatus, type MigrationExceptionPage,
} from "./legacy-migration-reads.ts";
import { publishMigrationReadiness, snapshotDirectory, verifyLegacyMigration } from "./legacy-migration-verification.ts";
import { stageLegacySource } from "./legacy-source-stage.ts";
import { publishLegacySnapshotCooperatively, readLegacySnapshot, type LegacySnapshotManifest } from "./legacy-snapshot.ts";
import type { MemoryAuthorityFence } from "./memory-authority-fence.ts";

export interface ProducerControl {
  owner: string;
  onProgress?: (status: MemoryMigrationStatus) => void;
  /** Shutdown checkpoint: conversion stops between sources and the run stays resumable. */
  stopRequested?: () => boolean;
}
export interface PrepareInput extends ProducerControl { runId: string; workspaceRoot: string; previewId: string; replaceRunId?: string }
export interface ResumeInput extends ProducerControl { runId: string }
export interface ActivateInput { runId: string; workspaceRoot: string; timeoutMs: number; transactionId: string; owner: string }

export interface LegacyMigrationRunner {
  dryRun(workspaceRoot: string): MemoryMigrationReport;
  preview(workspaceRoot: string): Promise<MemoryMigrationReport>;
  prepare(input: PrepareInput): Promise<MemoryMigrationStatus>;
  /** Finishes the same immutable snapshot/run; never adopts changed live files. */
  resumePreparation(input: ResumeInput): Promise<MemoryMigrationStatus>;
  status(runId: string): MemoryMigrationStatus;
  verify(runId: string): MemoryMigrationVerify;
  exceptions(input: { runId: string; cursor: string | null; limit: number }): MigrationExceptionPage;
  exclude(input: Omit<ExclusionInput, "now">): MemoryMigrationStatus;
  activate(input: ActivateInput): Promise<MemoryMigrationActivation>;
}

export interface RunnerDeps {
  db: Database;
  destinationRoot: string;
  fence: MemoryAuthorityFence;
  now?: () => string;
  onActivated?: (epochId: string) => void | Promise<void>;
  /** Finalizes dead/settled trusted primary groups before activation or an explicit resume; active producers stay open. */
  reconcileCustody?: () => void;
}
interface Runner extends RunnerDeps { now: () => string; ledger: LegacyMigrationLedgerRepo }

const LEASE_MS = 600_000;

export function createLegacyMigrationRunner(deps: RunnerDeps): LegacyMigrationRunner {
  const runner: Runner = { ...deps, now: deps.now ?? (() => new Date().toISOString()), ledger: createLegacyMigrationLedgerRepo(deps.db) };
  return {
    dryRun: (workspaceRoot) => dryRunLegacyMigration(workspaceRoot, runner.now()),
    preview: (workspaceRoot) => previewLegacyMigration(workspaceRoot, runner.now()),
    prepare: (input) => prepare(runner, input),
    resumePreparation: async (input) => { deps.reconcileCustody?.(); return resume(runner, input); },
    status: (runId) => readMigrationStatus(deps.db, runId),
    verify: (runId) => verifyLegacyMigration(deps.db, { runId, destinationRoot: deps.destinationRoot }),
    exceptions: (input) => readMigrationExceptions(deps.db, input),
    exclude: (input) => excludeLegacySource(deps.db, { ...input, now: runner.now() }),
    activate: async (input) => {
      deps.reconcileCustody?.();
      return deps.fence.quiesce({ timeoutMs: input.timeoutMs }, async () => {
        try {
          const result = await activate(runner, input);
          deps.fence.retire();
          if (result.epochId) await deps.onActivated?.(result.epochId);
          return result;
        } finally { retireUnlessLegacy(deps.db, deps.fence); }
      });
    },
  };
}

function retireUnlessLegacy(db: Database, fence: MemoryAuthorityFence): void {
  // Even the marker read after COMMIT can fail. Only a positively verified legacy selection permits reopening.
  let legacy = false;
  try { legacy = readCurrentMemoryAuthorityIdentity(db).mode === "legacy-markdown"; }
  finally { if (!legacy) fence.retire(); }
}

async function prepare(runner: Runner, input: PrepareInput): Promise<MemoryMigrationStatus> {
  const snapshot = await publishLegacySnapshotCooperatively({ workspaceRoot: input.workspaceRoot, destinationRoot: runner.destinationRoot, now: runner.now() });
  if (!snapshot.directory || snapshot.manifest.snapshotId !== input.previewId) throw new Error("SNAPSHOT_CHANGED");
  const epochId = publishMigrationCandidate(runner.db, { runId: input.runId, replaceRunId: input.replaceRunId,
    workspaceRoot: input.workspaceRoot, manifest: snapshot.manifest, now: runner.now() });
  const lease = acquire(runner, { runId: input.runId, owner: input.owner, recoverFailed: false });
  return withLease(runner, lease, async () => {
    await convertSources(runner, { manifest: snapshot.manifest, directory: snapshot.directory as string, epochId, lease, control: input });
    return finishPreparation(runner, lease);
  });
}

async function resume(runner: Runner, input: ResumeInput): Promise<MemoryMigrationStatus> {
  const run = requireMigrationRun(runner.db, input.runId);
  if (run.status === "completed" || !run.epoch_id) throw new Error("MEMORY_AUTHORITY_MISMATCH");
  const directory = snapshotDirectory(runner.destinationRoot, String(run.snapshot_id));
  const manifest = readLegacySnapshot(directory, String(run.snapshot_id));
  const lease = acquire(runner, { runId: input.runId, owner: input.owner, recoverFailed: true });
  return withLease(runner, lease, async () => {
    // A crash between run publication and inventory registration leaves manifest sources unregistered; fill them first.
    runner.db.transaction(() => ensureManifestInventory(runner.db, { runId: input.runId, manifest, now: runner.now(), fill: true }));
    if (run.status !== "ready") {
      const unresolved = new Set(runner.db.prepare(`SELECT source_id FROM memory_migration_sources WHERE run_id=:run AND disposition IN ${BLOCKING_DISPOSITIONS}`)
        .all({ run: input.runId }).map((row) => String(row.source_id)));
      await convertSources(runner, { manifest, directory, epochId: String(run.epoch_id), lease, control: input, only: unresolved });
    }
    return finishPreparation(runner, lease);
  });
}

function acquire(runner: Runner, input: { runId: string; owner: string; recoverFailed: boolean }): Lease {
  const at = runner.now();
  return runner.ledger.acquireLease({ ...input, now: at, expiresAt: future(at, LEASE_MS) });
}

async function withLease<T>(runner: Runner, lease: Lease, work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } finally {
    // Best effort: a lost lease already means another writer owns the run, and the original failure must surface.
    try { runner.ledger.releaseLease({ lease, now: runner.now() }); } catch { /* the lease is already foreign or expired */ }
  }
}

interface ConversionInput {
  manifest: LegacySnapshotManifest; directory: string; epochId: string; lease: Lease; control: ProducerControl; only?: Set<string>;
}

async function convertSources(runner: Runner, input: ConversionInput): Promise<void> {
  for (const item of input.manifest.entries) {
    if (input.only && !input.only.has(sourceIdentity(item.relativePath, item.rawSha256))) continue;
    await new Promise<void>((done) => setImmediate(done));
    if (input.control.stopRequested?.()) throw new Error("MIGRATION_INTERRUPTED");
    const at = runner.now();
    runner.ledger.renewLease({ lease: input.lease, now: at, expiresAt: future(at, LEASE_MS) });
    stageLegacySource(runner.db, { directory: input.directory, item, epochId: input.epochId, lease: input.lease, now: at });
    input.control.onProgress?.(readMigrationStatus(runner.db, input.lease.runId));
  }
}

function finishPreparation(runner: Runner, lease: Lease): MemoryMigrationStatus {
  const proof = verifyLegacyMigration(runner.db, { runId: lease.runId, destinationRoot: runner.destinationRoot });
  publishMigrationReadiness(runner.db, { lease, proof, now: runner.now() });
  return readMigrationStatus(runner.db, lease.runId);
}

async function activate(runner: Runner, input: ActivateInput): Promise<MemoryMigrationActivation> {
  const run = requireMigrationRun(runner.db, input.runId);
  if (run.status === "completed") throw new Error("MEMORY_AUTHORITY_MISMATCH");
  const live = await publishLegacySnapshotCooperatively({ workspaceRoot: input.workspaceRoot, destinationRoot: input.workspaceRoot, now: runner.now(), dryRun: true });
  if (live.manifest.snapshotId !== run.snapshot_id) throw new Error("SNAPSHOT_CHANGED");
  const lease = acquire(runner, { runId: input.runId, owner: input.owner, recoverFailed: false });
  return withLease(runner, lease, async () => {
    const proof = verifyLegacyMigration(runner.db, { runId: input.runId, destinationRoot: runner.destinationRoot });
    // Fresh verification is authoritative: a failed proof retracts stale readiness before the refusal surfaces.
    publishMigrationReadiness(runner.db, { lease, proof, now: runner.now() });
    if (!proof.verified || !proof.manifestDigest || !proof.readinessDigest) throw new Error("MIGRATION_NOT_READY");
    let epochId: string | null = null;
    runner.db.transaction(() => {
      publishMigrationBlocks(runner.db, input.runId);
      const selection = activateCanonicalLocal(runner.db, { lease, manifestDigest: proof.manifestDigest as string,
        readinessDigest: proof.readinessDigest as string, transactionId: input.transactionId, now: runner.now() });
      if (selection.mode !== "canonical-local") throw new Error("MEMORY_INTEGRITY_ERROR");
      epochId = selection.epochId;
    });
    return { runId: input.runId, activated: true, mode: "canonical-local", epochId };
  });
}

function future(now: string, ms: number): string {
  return new Date(Date.parse(now) + ms).toISOString();
}
