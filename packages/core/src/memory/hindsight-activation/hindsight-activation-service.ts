/**
 * INPUT:  the database, the authenticated Hindsight client factory, the live connection fingerprint, the B3 setup read, the
 *         published Local runtime seam (write fence, maintenance settle, ingestion), the composition's binding seam, primary
 *         custody and Core-minted activation identities
 * OUTPUT: createHindsightActivationService() — plan/status/authority/runtime/binding reads plus start/resumeActivation/recover: drain
 *         Local writers, lease the cutover run, capture coverage, activate every Bank over the D78 primitives, promote with
 *         the PR03 custody carry, rebind and prepare the receipt Banks, checkpointing after each durable step; every pre-COMMIT
 *         failure maps to the closed activation code with Local reopened only on positive marker evidence; recovery reuses the same receipt
 * POS:    core/memory/hindsight-activation — the Stage 2b coordinator; owns no timers and no second outcome ledger
 */
import type { MemoryHindsightProducerRef } from "@taki/shared";
import { createHindsightCutoverRunRepo, type HindsightCutoverLease, type HindsightCutoverRunRepo } from "../../db/hindsight-cutover-run-repo.ts";
import { captureHindsightCurrentLocal } from "../../db/hindsight-current-capture-repo.ts";
import { createHindsightLocalCoverageRepo } from "../../db/hindsight-local-coverage-repo.ts";
import { readHindsightLocalBankBinding } from "../../db/hindsight-local-bank-binding.ts";
import type { PrimaryMemoryCustody } from "../../db/primary-memory-custody-repo.ts";
import type { Database } from "../../db/sqlite.ts";
import type { Logger } from "../../logging/logger.ts";
import type { CanonicalLocalIngestion } from "../canonical-local-ingestion.ts";
import type { CanonicalLocalWriteFence } from "../canonical-local-write-fence.ts";
import type { HindsightClient } from "../hindsight/hindsight-client.ts";
import type { HindsightCurrentStateClient } from "../hindsight/hindsight-current-client.ts";
import type { HindsightSetupService } from "../hindsight/hindsight-setup-service.ts";
import { hindsightRuntimeAvailability, type HindsightBindingSnapshot, type HindsightRuntimeAvailability } from "../hindsight-runtime-binding.ts";
import { readMemoryAuthoritySelection, type MemoryAuthoritySelection } from "../legacy-migration/legacy-activation-repo.ts";
import type { MemoryAuthorityVerification } from "../runtime-authority-verification.ts";
import { localRuntimeAvailability } from "../local-onboarding/local-onboarding-reads.ts";
import type { LocalBindingSnapshot } from "../local-runtime-binding.ts";
import type { BindingRecovery } from "../runtime-composition.ts";
import { activateBank, createActivationProgress, promoteActivation, type ActivationChainContext, type HindsightActivationIdentity,
  type HindsightActivationReceipt } from "./hindsight-activation-chain.ts";
import { drainCanonicalLocal, reopenCanonicalLocal } from "./hindsight-activation-drain.ts";
import { activationFailure } from "./hindsight-activation-errors.ts";
import { readCommittedHindsightProducer, readHindsightActivationPlan, readHindsightActivationRun, type HindsightActivationPlan,
  type HindsightActivationRunRead, type HindsightActivationRunScope } from "./hindsight-activation-reads.ts";

/** The published Local subsystem seam (`fence`, `ingestion`) plus the composition's auto-memory settle. */
export interface HindsightActivationLocalRuntime {
  fence: CanonicalLocalWriteFence;
  /** Detached maintenance chains (auto-memory) settle here before the forced drain. */
  settle(): Promise<void>;
  ingestion: Pick<CanonicalLocalIngestion, "run" | "settle">;
}
/** The composition's pure snapshots, post-COMMIT rebind, receipt-Bank preparation and same-epoch repair. */
export interface HindsightActivationRuntime {
  verifySelectedAuthority?: MemoryAuthorityVerification["verifySelectedAuthority"];
  bindingSnapshot(): LocalBindingSnapshot;
  hindsightBindingSnapshot(): HindsightBindingSnapshot;
  bindHindsight(epochId: string): void;
  recoverHindsightBinding(epochId: string): BindingRecovery;
  prepareHindsightActivation(input: { epochId: string; bankIds: readonly string[]; signal?: AbortSignal }): Promise<void>;
}
export interface HindsightActivationControl {
  checkpoint(producer: MemoryHindsightProducerRef): void;
  stopRequested(): boolean;
  /** resume only: the lease owner observed on the run when its operation is terminal or belongs to another boot. */
  takeOverFrom?: string;
}
export interface HindsightActivationService {
  plan(): HindsightActivationPlan;
  status(input: HindsightActivationRunScope): HindsightActivationRunRead;
  authority(): MemoryAuthoritySelection;
  /** The committed identity rebuilt from receipts when no operation row carries it (recover admission). */
  committedProducer(input: { epochId: string; transactionId: string }): MemoryHindsightProducerRef | null;
  binding(): HindsightBindingSnapshot;
  /** Availability of the selected authority's runtime: the Local binding under Local, the Hindsight binding under Hindsight. */
  runtime(): HindsightRuntimeAvailability;
  start(identity: HindsightActivationIdentity, control: HindsightActivationControl): Promise<HindsightActivationReceipt>;
  /** Continues a persisted run from its evidence (named apart from the privacy-pause `resume` mutator sweep). */
  resumeActivation(identity: HindsightActivationIdentity, control: HindsightActivationControl): Promise<HindsightActivationReceipt>;
  /** Binding repair and required preparation on the committed epoch; never a second promotion. */
  recover(epochId: string, bankIds: readonly string[]): Promise<BindingRecovery>;
  /** True once shutdown began: no new attempt may start and a running one stops at the next Bank boundary. */
  stopRequested(): boolean;
  /** Refuses new attempts and resolves once every in-flight attempt has settled or checkpointed. */
  stop(): Promise<void>;
}
export interface HindsightActivationServiceInput {
  db: Database;
  client(): HindsightClient;
  /** The live connection fingerprint (null while the connection is not configured); drift from the B3 snapshot refuses. */
  fingerprint(): string | null;
  setup: Pick<HindsightSetupService, "status">;
  localRuntime(): HindsightActivationLocalRuntime;
  runtime: HindsightActivationRuntime;
  custody: Pick<PrimaryMemoryCustody, "status">;
  now?: () => string;
  logger: Logger;
  quiesceTimeoutMs?: number;
}

const LEASE_TTL_MS = 600_000;
const QUIESCE_TIMEOUT_MS = 30_000;
const NATIVE_TIMEOUT_MS = 60_000;
const SNAPSHOT_TTL_SECONDS = 3_600;
type Mode = "start" | "resume";
interface Service {
  input: HindsightActivationServiceInput; now(): string; runs: HindsightCutoverRunRepo; stopping: boolean;
  inflight: Set<Promise<unknown>>; preparation: AbortController;
}
interface Attempt { mode: Mode; identity: HindsightActivationIdentity; control: HindsightActivationControl }

export function createHindsightActivationService(input: HindsightActivationServiceInput): HindsightActivationService {
  const service: Service = { input, now: input.now ?? (() => new Date().toISOString()), runs: createHindsightCutoverRunRepo(input.db),
    stopping: false, inflight: new Set(), preparation: new AbortController() };
  return {
    plan: () => readHindsightActivationPlan(input.db, { setup: input.setup, fingerprint: input.fingerprint },
      input.runtime.verifySelectedAuthority?.() ?? readMemoryAuthoritySelection(input.db)),
    status: (scope) => {
      const read = readHindsightActivationRun(input.db, scope);
      return { ...read, custody: { ...read.custody, openGroups: input.custody.status().openGroups } };
    },
    authority: () => input.runtime.verifySelectedAuthority?.() ?? readMemoryAuthoritySelection(input.db),
    committedProducer: (scope) => readCommittedHindsightProducer(input.db, scope),
    binding: input.runtime.hindsightBindingSnapshot,
    runtime: () => runtimeAvailability(input.runtime),
    start: (identity, control) => attempt(service, { mode: "start", identity, control }),
    resumeActivation: (identity, control) => attempt(service, { mode: "resume", identity, control }),
    recover: (epochId, bankIds) => recoverBinding(service, { epochId, bankIds }),
    stopRequested: () => service.stopping,
    stop: async () => { service.stopping = true; service.preparation.abort(); await Promise.allSettled([...service.inflight]); },
  };
}

function runtimeAvailability(runtime: HindsightActivationRuntime): HindsightRuntimeAvailability {
  const hindsight = runtime.hindsightBindingSnapshot();
  if (hindsight.selection === "hindsight") return hindsightRuntimeAvailability(hindsight);
  return localRuntimeAvailability(runtime.bindingSnapshot());
}

async function attempt(service: Service, input: Attempt): Promise<HindsightActivationReceipt> {
  if (service.stopping) throw new Error("HINDSIGHT_ACTIVATION_INTERRUPTED");
  const control = { ...input.control, stopRequested: () => service.stopping || input.control.stopRequested() };
  const promise = run(service, { ...input, control });
  service.inflight.add(promise);
  try { return await promise; } finally { service.inflight.delete(promise); }
}

async function recoverBinding(service: Service, input: { epochId: string; bankIds: readonly string[] }): Promise<BindingRecovery> {
  if (service.stopping) throw new Error("HINDSIGHT_ACTIVATION_INTERRUPTED");
  const promise = (async () => {
    const binding = service.input.runtime.recoverHindsightBinding(input.epochId);
    await prepareBinding(service, input);
    return binding;
  })();
  service.inflight.add(promise);
  try { return await promise; } finally { service.inflight.delete(promise); }
}

function prepareBinding(service: Service, input: { epochId: string; bankIds: readonly string[] }): Promise<void> {
  if (service.stopping) throw new Error("HINDSIGHT_ACTIVATION_INTERRUPTED");
  return service.input.runtime.prepareHindsightActivation({ ...input, signal: service.preparation.signal });
}

async function run(service: Service, attempt: Attempt): Promise<HindsightActivationReceipt> {
  const { db, logger } = service.input; const { identity, control } = attempt;
  const local = service.input.localRuntime();
  const setup = requireSetup(service, identity);
  const progress = createActivationProgress({ identity, configFingerprint: setup.configFingerprint, checkpoint: control.checkpoint });
  let lease: HindsightCutoverLease | undefined; let receipt: HindsightActivationReceipt;
  try {
    progress.phase("draining");
    await drainCanonicalLocal({ db, local, epochId: identity.predecessorEpochId, timeoutMs: service.input.quiesceTimeoutMs ?? QUIESCE_TIMEOUT_MS });
    lease = acquire(service, attempt);
    const ctx: ActivationChainContext = { db, client: requireCurrentClient(service.input.client()), lease, identity, progress,
      providerLineage: setup.providerLineage, configFingerprint: setup.configFingerprint, timeoutMs: NATIVE_TIMEOUT_MS,
      snapshotTtlSeconds: SNAPSHOT_TTL_SECONDS, now: service.now, renew: () => renew(service, lease!) };
    await activateBanks(service, ctx, control);
    receipt = promoteActivation(ctx);
    // COMMIT is durable: the fence never reopens, and the retired Local surfaces fail closed through the epoch guard.
    local.fence.retire();
    logger.info({ runId: identity.runId, transactionId: identity.transactionId, carried: receipt.carriedWitnessCount }, "Hindsight authority activated");
  } catch (error) {
    const failure = activationFailure(error);
    release(service, lease);
    reopenCanonicalLocal({ db, fence: local.fence, epochId: identity.predecessorEpochId });
    logger.warn({ runId: identity.runId, code: failure.message, phase: progress.current().progress.phase }, "Hindsight activation attempt failed");
    throw failure;
  }
  bind(service, receipt);
  await prepareBinding(service, { epochId: receipt.hindsightEpochId, bankIds: identity.banks.map((bank) => bank.nativeBankId) });
  progress.phase("completed");
  return receipt;
}

/** Post-COMMIT: the marker is durable, so a failed rebind propagates as this attempt's failure while Hindsight stays selected. */
function bind(service: Service, receipt: HindsightActivationReceipt): void {
  try { service.input.runtime.bindHindsight(receipt.hindsightEpochId); }
  catch (error) {
    service.input.logger.error({ runId: receipt.runId, epochId: receipt.hindsightEpochId, code: activationFailure(error).message }, "Hindsight runtime rebind failed after COMMIT; recover repairs the binding");
    throw error;
  }
}

async function activateBanks(service: Service, ctx: ActivationChainContext, control: HindsightActivationControl): Promise<void> {
  const { db, identity } = ctx;
  ctx.progress.phase("capturing");
  const manifest = currentCoverage(service, ctx.lease);
  const capture = captureHindsightCurrentLocal(db, { lease: ctx.lease, manifestId: manifest.manifestId, expectedEpochId: identity.predecessorEpochId, now: service.now() });
  ctx.progress.manifest(manifest.manifestId);
  const bindings = manifest.bankIds.map((sourceBankId) => readHindsightLocalBankBinding(db, { localEpochId: identity.predecessorEpochId, sourceBankId }));
  const expected = new Set(identity.banks.map((bank) => bank.nativeBankId));
  if (bindings.length !== expected.size || bindings.some((binding) => !expected.has(binding.nativeBankId))) throw new Error("HINDSIGHT_BANKS_INCOMPLETE");
  for (const binding of bindings) {
    if (control.stopRequested()) throw new Error("HINDSIGHT_ACTIVATION_INTERRUPTED");
    ctx.renew();
    const bank = identity.banks.find((candidate) => candidate.nativeBankId === binding.nativeBankId)!;
    await activateBank(ctx, { capture, sourceBankId: binding.sourceBankId, bank, previousPreparationId: previousPreparation(db, capture.captureId, bank.nativeBankId) });
  }
  if (control.stopRequested()) throw new Error("HINDSIGHT_ACTIVATION_INTERRUPTED");
}

/** The selected manifest is reused while current; staleness is an explicit recapture (new version), never a silent retry. */
function currentCoverage(service: Service, lease: HindsightCutoverLease) {
  const coverage = createHindsightLocalCoverageRepo(service.input.db);
  const selected = coverage.selected(lease.runId);
  if (selected && coverage.compareCurrent(selected.manifestId).matches) return selected;
  return service.runs.captureCoverage({ lease, now: service.now() });
}

/** An older capture's preparation for this Bank, if any, whose transfer the recaptured import must supersede. */
function previousPreparation(db: Database, captureId: string, nativeBankId: string): string | null {
  const row = db.prepare(`SELECT p.preparation_id FROM hindsight_current_preparations p JOIN hindsight_current_import_evidence e
    ON e.preparation_id=p.preparation_id WHERE p.bank_id=:bank AND p.capture_id<>:capture ORDER BY e.rowid DESC LIMIT 1`)
    .get({ bank: nativeBankId, capture: captureId });
  return row ? String(row.preparation_id) : null;
}

function requireSetup(service: Service, identity: HindsightActivationIdentity): { configFingerprint: string; providerLineage: string } {
  const selection = service.input.runtime.verifySelectedAuthority?.() ?? readMemoryAuthoritySelection(service.input.db);
  if (selection.mode !== "canonical-local" || selection.epochId !== identity.predecessorEpochId) throw activationFailure(new Error("HINDSIGHT_PREDECESSOR_STALE"));
  const { phase, configFingerprint, compatibility } = service.input.setup.status();
  if (phase !== "configured" || !configFingerprint || !compatibility?.providerLineage || service.input.fingerprint() !== configFingerprint) {
    throw activationFailure(new Error("HINDSIGHT_CONNECTION_NOT_VERIFIED"));
  }
  return { configFingerprint, providerLineage: compatibility.providerLineage };
}

function requireCurrentClient(client: HindsightClient): HindsightCurrentStateClient {
  const required = ["transferCurrentState", "currentTransferResult", "currentTransferPage", "prepareCurrentVerification",
    "advanceCurrentVerification", "currentVerification", "currentVerificationPage", "createCurrentSnapshot", "currentSnapshotPage"] as const;
  for (const method of required) if (typeof client[method] !== "function") throw new Error("HINDSIGHT_EXTENSION_UNSUPPORTED");
  return client as HindsightCurrentStateClient;
}

function acquire(service: Service, attempt: Attempt): HindsightCutoverLease {
  const { identity } = attempt; const now = service.now();
  const exists = service.input.db.prepare("SELECT 1 AS present FROM hindsight_cutover_runs WHERE run_id=:run").get({ run: identity.runId }) !== undefined;
  if (attempt.mode === "start" && exists) throw new Error("HINDSIGHT_PROMOTION_CONFLICT");
  if (attempt.mode === "resume" && !exists) throw new Error("HINDSIGHT_SOURCE_RUN_NOT_COMPLETED");
  if (!exists) service.runs.create({ runId: identity.runId, expectedPredecessorEpochId: identity.predecessorEpochId, now });
  return service.runs.acquireLease({ runId: identity.runId, owner: leaseOwner(identity.operationId), now, expiresAt: expiry(now),
    takeOverFrom: attempt.control.takeOverFrom });
}

function renew(service: Service, lease: HindsightCutoverLease): void {
  const now = service.now(); const expiresAt = expiry(now);
  service.runs.renewLease({ lease, now, expiresAt }); lease.expiresAt = expiresAt;
}

function release(service: Service, lease: HindsightCutoverLease | undefined): void {
  if (!lease) return;
  try { service.runs.releaseLease({ lease, now: service.now() }); }
  catch { /* a lost or completed lease needs no release; the failure code already names the cause */ }
}

export function leaseOwner(operationId: string): string { return `hindsight-activation:${operationId}`; }
function expiry(now: string): string { return new Date(Date.parse(now) + LEASE_TTL_MS).toISOString(); }
