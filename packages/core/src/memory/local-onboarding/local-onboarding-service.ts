/**
 * INPUT:  the Core workspace root, the on-demand B2 runner, the composition's binding snapshot / binding recovery / custody,
 *         the Core-owned lease owner and the onboarding invalidation publisher
 * OUTPUT: createLocalOnboardingService() — preview/discover/run/receipt/exceptions reads, the exclusion command, the
 *         prepare/resumePreparation/activate/repairBinding producers with invalidations after durable checkpoints, stop() for shutdown
 * POS:    core/memory/local-onboarding — the only caller of the runner's mutations; owns no timers and no second outcome ledger
 */
import type {
  MemoryMigrationActivation, MemoryMigrationReport, MemoryMigrationStatus, MemoryOnboardingChanged, MemoryOnboardingExceptionsParams,
  MemoryOnboardingExceptionsResult, MemoryOnboardingRun,
} from "@taki/shared";
import type { PrimaryCustodyStatus, PrimaryMemoryCustody } from "../../db/primary-memory-custody-repo.ts";
import type { Database } from "../../db/sqlite.ts";
import { readMemoryAuthoritySelection, type MemoryAuthoritySelection } from "../legacy-migration/legacy-activation-repo.ts";
import type { MemoryAuthorityVerification } from "../runtime-authority-verification.ts";
import { excludeLegacySource } from "../legacy-migration/legacy-migration-exclusion.ts";
import { previewLegacyMigration, readMigrationReceipt, type MigrationReceipt } from "../legacy-migration/legacy-migration-reads.ts";
import type { LegacyMigrationRunner } from "../legacy-migration/legacy-migration-runner.ts";
import type { LocalBindingSnapshot } from "../local-runtime-binding.ts";
import type { LocalBindingRecovery } from "../runtime-composition.ts";
import { discoverOnboardingRun, readOnboardingExceptions, readOnboardingRun } from "./local-onboarding-reads.ts";

export type OnboardingChangeReason = MemoryOnboardingChanged["reason"];
export interface LocalProducerControl { onProgress?: (status: MemoryMigrationStatus) => void }
export interface LocalPrepareInput extends LocalProducerControl { runId: string; previewId: string; replaceRunId?: string }
export interface LocalResumeInput extends LocalProducerControl { runId: string }
export interface LocalActivateInput { runId: string; transactionId: string }
export interface LocalExclusionInput { runId: string; sourceId: string; reason: string; actor: string }

export interface LocalOnboardingService {
  workspaceRoot: string;
  preview(): Promise<MemoryMigrationReport>;
  authority(): MemoryAuthoritySelection;
  binding(): LocalBindingSnapshot;
  custody(): PrimaryCustodyStatus;
  /** The selected/latest relevant run, including runs an older raw B2 RPC created. */
  discover(): MemoryOnboardingRun | null;
  run(runId: string): MemoryOnboardingRun | null;
  /** The positive commit proof joined on run, snapshot, epoch and transaction; null is "not proven", never "not committed". */
  receipt(runId: string): MigrationReceipt | null;
  exceptions(params: MemoryOnboardingExceptionsParams): MemoryOnboardingExceptionsResult;
  exclude(input: LocalExclusionInput): MemoryMigrationStatus;
  prepare(input: LocalPrepareInput): Promise<MemoryMigrationStatus>;
  /** Finishes the same immutable snapshot/run; never adopts changed live files. */
  resumePreparation(input: LocalResumeInput): Promise<MemoryMigrationStatus>;
  activate(input: LocalActivateInput): Promise<MemoryMigrationActivation>;
  repairBinding(epochId: string): LocalBindingRecovery;
  /** True once shutdown began: no new claim may start and conversion stops at the next source boundary. */
  stopRequested(): boolean;
  /** Refuses new producers and resolves once every in-flight producer has settled or checkpointed. */
  stop(): Promise<void>;
}

export interface LocalOnboardingServiceInput {
  db: Database;
  workspaceRoot: string;
  runner(): Promise<LegacyMigrationRunner>;
  runtime: {
    verifySelectedAuthority?: MemoryAuthorityVerification["verifySelectedAuthority"];
    bindingSnapshot(): LocalBindingSnapshot;
    recoverLocalBinding(epochId: string): LocalBindingRecovery;
    custody: Pick<PrimaryMemoryCustody, "status">;
  };
  /** Lease owner recorded on every producer write; Core-minted, never a client value. */
  owner: string;
  onChanged(reason: OnboardingChangeReason): void;
  now?: () => string;
}

const ACTIVATION_QUIESCENCE_MS = 30_000;

interface Service { input: LocalOnboardingServiceInput; now: () => string; stopping: boolean; inflight: Set<Promise<unknown>> }

export function createLocalOnboardingService(input: LocalOnboardingServiceInput): LocalOnboardingService {
  const service: Service = { input, now: input.now ?? (() => new Date().toISOString()), stopping: false, inflight: new Set() };
  const { db } = input;
  return {
    workspaceRoot: input.workspaceRoot,
    preview: () => previewLegacyMigration(input.workspaceRoot, service.now()),
    authority: () => input.runtime.verifySelectedAuthority?.() ?? readMemoryAuthoritySelection(db),
    binding: input.runtime.bindingSnapshot,
    custody: () => input.runtime.custody.status(),
    discover: () => discoverOnboardingRun(db, service.now()),
    run: (runId) => readOnboardingRun(db, runId, service.now()),
    receipt: (runId) => readMigrationReceipt(db, runId),
    exceptions: (params) => readOnboardingExceptions(db, params),
    exclude: (exclusion) => {
      const status = excludeLegacySource(db, { ...exclusion, now: service.now() });
      input.onChanged("exclusion");
      return status;
    },
    prepare: (prepare) => produce(service, ["candidate", "producer"], async () =>
      (await input.runner()).prepare({ ...prepare, workspaceRoot: input.workspaceRoot, ...control(service, prepare) })),
    resumePreparation: (resume) => produce(service, ["producer"], async () =>
      (await input.runner()).resumePreparation({ ...resume, ...control(service, resume) })),
    activate: (activation) => produce(service, ["candidate", "binding"], async () =>
      (await input.runner()).activate({ ...activation, workspaceRoot: input.workspaceRoot, timeoutMs: ACTIVATION_QUIESCENCE_MS, owner: input.owner })),
    repairBinding: (epochId) => {
      try { return input.runtime.recoverLocalBinding(epochId); }
      finally { input.onChanged("binding"); }
    },
    stopRequested: () => service.stopping,
    stop: async () => { service.stopping = true; await Promise.allSettled([...service.inflight]); },
  };
}

function control(service: Service, producer: LocalProducerControl) {
  return {
    owner: service.input.owner, stopRequested: () => service.stopping,
    onProgress: (status: MemoryMigrationStatus) => { producer.onProgress?.(status); service.input.onChanged("producer"); },
  };
}

/** Every producer publishes its invalidations after it settles either way: a failed prepare may still have created a run. */
async function produce<T>(service: Service, reasons: OnboardingChangeReason[], work: () => Promise<T>): Promise<T> {
  if (service.stopping) throw new Error("MIGRATION_INTERRUPTED");
  const promise = work();
  service.inflight.add(promise);
  try {
    return await promise;
  } finally {
    service.inflight.delete(promise);
    for (const reason of reasons) service.input.onChanged(reason);
  }
}
