/**
 * INPUT:  active Hindsight connection, Core SQLite and immutable provider-specific configuration
 * OUTPUT: replica/binding, committed-application notifications, guarded admission, Pending recovery and real provider
 * POS:    core/memory/hindsight — storage/transport composition; constructors never dispatch work or change Authority
 */
import type { MemoryBankScope, TakiApplicationBlockBody } from "@taki/shared";
import type { MemoryConfig } from "../../config/memory-config.ts";
import { createHindsightApplicationReplicaRepo } from "../../db/hindsight-application-replica-repo.ts";
import { createHindsightApplicationCommandRepo } from "../../db/hindsight-application-command-repo.ts";
import type { HindsightApplicationCommandGuard } from "../../db/hindsight-application-command-contract.ts";
import { readHindsightApplicationBootstrapEvidence } from "../../db/hindsight-application-bootstrap-evidence.ts";
import { createHindsightMemoryWriteRepo } from "../../db/hindsight-memory-write-repo.ts";
import { createHindsightRuntimeAdmissionRepo, type HindsightRuntimeAdmissionRepo } from "../../db/hindsight-runtime-admission-repo.ts";
import { createPendingMemoryRepo } from "../../db/pending-memory-repo.ts";
import { createStructuredMemoryBlockRepo } from "../../db/structured-memory-block-repo.ts";
import type { Database } from "../../db/sqlite.ts";
import { V1_BLOCKS } from "../block-registry.ts";
import { createMemoryCoordinator } from "../memory-coordinator.ts";
import { createPendingMemoryWriter } from "../pending-memory-writer.ts";
import { createIntlSegmenterTokenizer } from "../search-tokenizer.ts";
import { createHindsightApplicationCommandRunner } from "./hindsight-application-command-runner.ts";
import { requireHindsightApplicationClient, resolveHindsightApplicationAdmission,
  type admitHindsightApplication, type HindsightApplicationAdmissionReader } from "./hindsight-application-capability.ts";
import { createHindsightApplicationWriter } from "./hindsight-application-writer.ts";
import { createHindsightApplicationBindingRunner } from "./hindsight-application-binding-runner.ts";
import { createHindsightApplicationSyncRunner } from "./hindsight-application-sync-runner.ts";
import { createHindsightApplicationRecoveryReplica } from "./hindsight-application-recovery-replica.ts";
import { ensureHindsightPendingSource } from "./hindsight-application-source-write.ts";
import { createHindsightPendingRecoveryRunner } from "./hindsight-pending-recovery-runner.ts";
import { createHindsightMemoryWrites } from "./hindsight-memory-writes.ts";
import { createHindsightMemoryProvider } from "./hindsight-memory-provider.ts";
import { createHindsightRuntimeBankService } from "./hindsight-runtime-bank-service.ts";
import type { HindsightRuntimeConnection } from "./hindsight-runtime-connection.ts";
import type { HindsightMemoryWriteAdvance } from "./hindsight-memory-write-context.ts";
import { sameApplicationValue } from "./hindsight-application-integrity.ts";
import { transitionQueuedProvider } from "../transitions/transition-queued-provider.ts";
import type { CanonicalLocalWriteFence } from "../canonical-local-write-fence.ts";
import { readSelectedTemplateLabelGroup } from "./template-lifecycle/template-runtime-selection.ts";
import { createRecallEvidenceRegistry } from "../memory-recall-evidence.ts";
import { createHindsightRecallEvidence } from "./hindsight-recall-evidence.ts";

interface Input { db: Database; runtime: HindsightRuntimeConnection; config: MemoryConfig; now?: () => string; workFence?: CanonicalLocalWriteFence;
  onReplicaApplied?: (bankId: string) => void }
export type HindsightRuntimeState = ReturnType<typeof createHindsightRuntimeState>;

export function createHindsightRuntimeState(input: Input) {
  const stores = createStores(input); const { runtime, db, config } = input;
  const { replica, writer, blocks, assertActive, bankScope, nativeReplica, pending, admission } = stores;
  const admitted = createRuntimeAdmission(input, admission);
  const bind = createHindsightApplicationBindingRunner({ repo: replica, writer, client: runtime.client,
    bootstrap: (scope) => readHindsightApplicationBootstrapEvidence(db, scope),
    templateLabelGroup: (scope) => runtime.templateExecution ? runtime.templateExecution.labelGroup(scope) : readSelectedTemplateLabelGroup(db, scope),
    blocks: (scope) => readBlocks(blocks, scope.bankScope) });
  const sync = createHindsightApplicationSyncRunner({ client: runtime.client, repo: replica, authority: runtime.authority,
    bankScope, requestTimeoutMs: runtime.connection.requestTimeoutMs, bind, now: input.now, resolveAdmission: admitted.resolve,
    onApplied: input.onReplicaApplied });
  const unsupported = (): never => { throw new Error("HINDSIGHT_APPLICATION_NATIVE_PUBLICATION_REFUSED"); };
  const recovery = createHindsightPendingRecoveryRunner({ client: runtime.client, replica: nativeReplica, pending,
    authority: runtime.authority, projection: { bankScope, source: unsupported, memory: unsupported },
    connection: runtime.connection, secretMarker: runtime.secretMarker, syncRunner: sync, now: input.now, readAdmission: admitted.read,
    beforeNativeDispatch: (work) => ensureHindsightPendingSource({ writer, ...work }) });
  let advance: (work: HindsightMemoryWriteAdvance) => Promise<void> = async () => { throw new Error("MEMORY_RUNTIME_NOT_READY"); };
  const service = createHindsightRuntimeBankService({ replica, sync, recovery, bank: runtime.bank,
    assertConnection: runtime.assertConnection, onRecovered: (work) => advance(work), now: input.now, workFence: input.workFence });
  const writes = createHindsightMemoryWrites({ db, epochId: runtime.epoch.epochId, journal: createHindsightMemoryWriteRepo({ db, assertActive, now: input.now }),
    replica, pending, pendingWriter: createPendingMemoryWriter({ authority: runtime.authority, replica: nativeReplica, pending, now: input.now }),
    writer, client: runtime.client, bank: runtime.bank, assertActive, recover: service.recover,
    requestTimeoutMs: runtime.connection.requestTimeoutMs, intentionsDefaultDays: config.intentionsDefaultDays, now: input.now });
  advance = writes.advanceBank;
  const recallEvidence = createRecallEvidenceRegistry(createHindsightRecallEvidence({ replica, assertCurrent: runtime.assertConnection,
    now: input.now ? () => Date.parse(input.now!()) : undefined }));
  const provider = createHindsightMemoryProvider({ ...runtime, epochId: runtime.epoch.epochId, replica, admission, pending, writes,
    synchronize: service.synchronize, readAdmission: admitted.read, now: input.now, workFence: input.workFence,
    observeRecallEvidence: recallEvidence.observe });
  const coordinator = createMemoryCoordinator({ authority: runtime.authority, providers: new Map([["hindsight", transitionQueuedProvider(db, provider, runtime.assertConnection)]]) });
  return { ...input, ...stores, sync, recovery, service, writes, provider, coordinator, recallEvidence };
}

function createRuntimeAdmission(input: Input, repo: HindsightRuntimeAdmissionRepo) {
  const { runtime } = input;
  const identity = { authorityEpochId: runtime.epoch.epochId, configFingerprint: runtime.configFingerprint };
  const read: HindsightApplicationAdmissionReader = (request) => {
    runtime.assertConnection(); request();
    const evidence = repo.read(identity);
    if (!evidence) throw new Error("HINDSIGHT_APPLICATION_ADMISSION_INVALID");
    return evidence.manifest;
  };
  const resolve: typeof admitHindsightApplication = async (work) => {
    const request = () => { runtime.assertConnection(); return work.request(); };
    request();
    const evidence = runtime.templateExecution ? undefined : repo.read(identity);
    const result = await resolveHindsightApplicationAdmission({ ...work, request, evidence: evidence?.manifest });
    request();
    const current = runtime.templateExecution ? undefined : repo.read(identity);
    if (!runtime.templateExecution && (!current || !sameApplicationValue(current.manifest, result.manifest))) {
      repo.save({ ...identity, manifest: result.manifest, admittedAt: input.now?.() ?? new Date().toISOString() });
    }
    return result;
  };
  return { resolve, read: runtime.templateExecution ? undefined : read };
}

function createStores(input: Input) {
  const { db, runtime } = input; const client = requireHindsightApplicationClient(runtime.client);
  if (!client.trackedNativeWrite || !client.nativeResult || !client.nativeResultPage || !client.recallNative) {
    throw new Error("HINDSIGHT_EXTENSION_UNSUPPORTED");
  }
  const bankScope = (bankId: string): MemoryBankScope => {
    const bank = runtime.bank(bankId);
    return bank.scope === "global" ? { kind: "global", characterId: null } : { kind: "character", characterId: bank.characterId as string };
  };
  const tokenizer = createIntlSegmenterTokenizer({ stoplist: input.config.stoplist });
  const replica = createHindsightApplicationReplicaRepo({ db, tokenizer, bankScope, now: input.now });
  const assertActive = (guard: HindsightApplicationCommandGuard) => {
    input.workFence?.admitSync(() => undefined);
    const scope = bankScope(guard.key.bankId); const checkpoint = replica.checkpoint(guard.key.bankId);
    if (guard.key.authorityEpochId !== runtime.epoch.epochId || !checkpoint || checkpoint.bankDeleted
      || checkpoint.authorityEpochId !== runtime.epoch.epochId || !sameApplicationValue(checkpoint.namespace, guard.namespace)
      || !sameApplicationValue(checkpoint.bankScope, scope)) throw new Error("MEMORY_AUTHORITY_MISMATCH");
  };
  const commands = createHindsightApplicationCommandRepo({ db, assertActive, now: input.now });
  const commandRunner = createHindsightApplicationCommandRunner({ repo: commands, client });
  const originalWriter = createHindsightApplicationWriter({ commands, runner: commandRunner, replica, now: input.now });
  const writer = { ...originalWriter,
    prepare: ((work) => input.workFence ? input.workFence.admitSync(() => originalWriter.prepare(work)) : originalWriter.prepare(work)) satisfies typeof originalWriter.prepare,
    run: ((work) => input.workFence ? input.workFence.admit(() => originalWriter.run(work)) : originalWriter.run(work)) satisfies typeof originalWriter.run };
  const nativeReplica = createHindsightApplicationRecoveryReplica({ db, replica });
  const pending = createPendingMemoryRepo(db, input.now, (bankId) => replica.bankBinding(bankId)?.bank);
  const blocks = createStructuredMemoryBlockRepo(db); const admission = createHindsightRuntimeAdmissionRepo(db);
  return { tokenizer, replica, commands, commandRunner, writer, nativeReplica, pending, blocks, admission, assertActive, bankScope };
}

function readBlocks(blocks: ReturnType<typeof createStructuredMemoryBlockRepo>, scope: MemoryBankScope): TakiApplicationBlockBody[] {
  return V1_BLOCKS.filter((block) => (block.ownership === "global" ? "global" : "character") === scope.kind).flatMap((definition) => {
    const block = blocks.read(definition.id, scope); if (!block) return [];
    return [{ block_id: block.blockId, scope: block.scope, content: block.content, block_revision: block.revision,
      updated_at: block.updatedAt, writer: definition.writer, block_contract_version: 1 as const }];
  });
}
