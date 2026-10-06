/**
 * INPUT:  active Hindsight connection, Core SQLite and immutable provider-specific configuration
 * OUTPUT: application replica, source/binding producer, Pending recovery, durable writes and real provider
 * POS:    core/memory/hindsight — storage/transport composition; constructors never dispatch work or change Authority
 */
import type { MemoryBankScope, TakiApplicationBlockBody } from "@taki/shared";
import type { MemoryConfig } from "../../config/memory-config.ts";
import { createHindsightApplicationReplicaRepo } from "../../db/hindsight-application-replica-repo.ts";
import { createHindsightApplicationCommandRepo } from "../../db/hindsight-application-command-repo.ts";
import type { HindsightApplicationCommandGuard } from "../../db/hindsight-application-command-contract.ts";
import { readHindsightApplicationBootstrapEvidence } from "../../db/hindsight-application-bootstrap-evidence.ts";
import { createHindsightMemoryWriteRepo } from "../../db/hindsight-memory-write-repo.ts";
import { createHindsightRuntimeAdmissionRepo } from "../../db/hindsight-runtime-admission-repo.ts";
import { createPendingMemoryRepo } from "../../db/pending-memory-repo.ts";
import { createStructuredMemoryBlockRepo } from "../../db/structured-memory-block-repo.ts";
import type { Database } from "../../db/sqlite.ts";
import { V1_BLOCKS } from "../block-registry.ts";
import { createMemoryCoordinator } from "../memory-coordinator.ts";
import { createPendingMemoryWriter } from "../pending-memory-writer.ts";
import { createIntlSegmenterTokenizer } from "../search-tokenizer.ts";
import { createHindsightApplicationCommandRunner } from "./hindsight-application-command-runner.ts";
import { requireHindsightApplicationClient } from "./hindsight-application-capability.ts";
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

interface Input { db: Database; runtime: HindsightRuntimeConnection; config: MemoryConfig; now?: () => string; workFence?: CanonicalLocalWriteFence }
export type HindsightRuntimeState = ReturnType<typeof createHindsightRuntimeState>;

export function createHindsightRuntimeState(input: Input) {
  const stores = createStores(input); const { runtime, db, config } = input;
  const { replica, writer, blocks, assertActive, bankScope, nativeReplica, pending, admission } = stores;
  const bind = createHindsightApplicationBindingRunner({ repo: replica, writer, client: runtime.client,
    bootstrap: (scope) => readHindsightApplicationBootstrapEvidence(db, scope),
    blocks: (scope) => readBlocks(blocks, scope.bankScope) });
  const sync = createHindsightApplicationSyncRunner({ client: runtime.client, repo: replica, authority: runtime.authority,
    bankScope, requestTimeoutMs: runtime.connection.requestTimeoutMs, bind, now: input.now,
    onAdmission: (manifest) => { runtime.assertConnection(); admission.save({ authorityEpochId: runtime.epoch.epochId,
      configFingerprint: runtime.configFingerprint, manifest, admittedAt: input.now?.() ?? new Date().toISOString() }); } });
  const unsupported = (): never => { throw new Error("HINDSIGHT_APPLICATION_NATIVE_PUBLICATION_REFUSED"); };
  const recovery = createHindsightPendingRecoveryRunner({ client: runtime.client, replica: nativeReplica, pending,
    authority: runtime.authority, projection: { bankScope, source: unsupported, memory: unsupported },
    connection: runtime.connection, secretMarker: runtime.secretMarker, syncRunner: sync, now: input.now,
    beforeNativeDispatch: (work) => ensureHindsightPendingSource({ writer, ...work }) });
  let advance: (work: HindsightMemoryWriteAdvance) => Promise<void> = async () => { throw new Error("MEMORY_RUNTIME_NOT_READY"); };
  const service = createHindsightRuntimeBankService({ replica, sync, recovery, bank: runtime.bank,
    assertConnection: runtime.assertConnection, onRecovered: (work) => advance(work), now: input.now, workFence: input.workFence });
  const writes = createHindsightMemoryWrites({ db, epochId: runtime.epoch.epochId, journal: createHindsightMemoryWriteRepo({ db, assertActive, now: input.now }),
    replica, pending, pendingWriter: createPendingMemoryWriter({ authority: runtime.authority, replica: nativeReplica, pending, now: input.now }),
    writer, client: runtime.client, bank: runtime.bank, assertActive, recover: service.recover,
    requestTimeoutMs: runtime.connection.requestTimeoutMs, intentionsDefaultDays: config.intentionsDefaultDays, now: input.now });
  advance = writes.advanceBank;
  const provider = createHindsightMemoryProvider({ ...runtime, epochId: runtime.epoch.epochId, replica, admission, pending, writes,
    synchronize: service.synchronize, now: input.now, workFence: input.workFence });
  const coordinator = createMemoryCoordinator({ authority: runtime.authority, providers: new Map([["hindsight", transitionQueuedProvider(db, provider)]]) });
  return { ...input, ...stores, sync, recovery, service, writes, provider, coordinator };
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
    runtime.assertConnection(); const checkpoint = replica.checkpoint(guard.key.bankId); const scope = bankScope(guard.key.bankId);
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
