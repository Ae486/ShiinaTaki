/**
 * INPUT:  synthetic D77 Bank state, owned SQLite path and controlled recovery faults
 * OUTPUT: real parent journal, Pending repository/writer, application outbox and G1 replay composition
 * POS:    core/memory/hindsight tests only — verified event publication; never patches Pending state with SQL
 */
import type { JsonValue, MemoryReplicaBank, PendingMemoryRecord, RetainRequest } from "@taki/shared";
import { createHindsightMemoryWriteRepo } from "../../db/hindsight-memory-write-repo.ts";
import type { HindsightMemoryWriteIdentity } from "../../db/hindsight-memory-write-contract.ts";
import type { HindsightApplicationCommandGuard } from "../../db/hindsight-application-command-contract.ts";
import { createPendingMemoryRepo } from "../../db/pending-memory-repo.ts";
import { createHindsightReplicaSyncRepo } from "../../db/hindsight-replica-sync-repo.ts";
import { createPendingMemoryWriter } from "../pending-memory-writer.ts";
import { createIntlSegmenterTokenizer } from "../search-tokenizer.ts";
import type { MemoryProviderCallContext } from "../memory-provider.ts";
import { APPLICATION_TEST_AT, applicationTestBody } from "../../testing/hindsight-application-fixtures.ts";
import { applicationTestBoundMemory } from "../../testing/hindsight-application-runtime-fixtures.ts";
import { curatorTestBank, curatorTestFixture, type CuratorTestBank } from "./hindsight-policy-curator-fixtures.ts";
import { sameApplicationValue } from "./hindsight-application-integrity.ts";
import { createHindsightMemoryWrites } from "./hindsight-memory-writes.ts";
import type { HindsightMemoryWriteDeps } from "./hindsight-memory-write-context.ts";
import type { HindsightCallContext, HindsightClient } from "./hindsight-client.ts";
import { ensureHindsightPendingSource } from "./hindsight-application-source-write.ts";
import { replayPendingNative, resolvePendingNative, type PendingReplayContext } from "./hindsight-pending-replay.ts";
import { writeNativeFixture } from "./hindsight-memory-write-native-fixtures.ts";

export const WRITE_TEST_MEMORY = "33333333-3333-4333-8333-333333333333";
export const WRITE_TEST_AT = APPLICATION_TEST_AT;
export function writeTestMetadata(depth = 0, special = false): Record<string, JsonValue> {
  let value: Record<string, JsonValue> = special ? JSON.parse('{"__proto__":{"data":[false,null,3]},"constructor":"data"}')
    : { flags: [false, null, 3.25, ""], literal: '{"is":"a string"}', constructor: "data" };
  for (let index = 0; index < depth; index++) value = { nested: value };
  return value;
}
export function writeTestBank(input: { bankId?: string; characterId?: string; metadata?: Record<string, JsonValue> } = {}) {
  const bank = curatorTestBank({ bankId: input.bankId, characterId: input.characterId, memories: [] });
  const memory = applicationTestBoundMemory({ scope: bank.scope, bankScope: bank.bankScope,
    payload: { memory_id: WRITE_TEST_MEMORY, text: "Original verified fact", metadata: input.metadata ?? {} } });
  bank.native.push(memory.native); bank.artifacts.push(memory.application); return bank;
}
export function writeTestRetain(bankId = "bank-a", metadata = writeTestMetadata()): RetainRequest {
  return { bankId, content: "An exact original source", context: "Source context", timestamp: null,
    tags: [], entities: [], metadata, observationScopes: null, documentId: "source-a", strategy: null, updateMode: "append",
    provenance: { actor: "user", origin: "explicit-user", characterId: null, timelineFromSeq: null, timelineToSeq: null,
      capturedAt: WRITE_TEST_AT, sanitized: true, sourceRef: null },
    policy: { layerId: "profile", importance: 5, visibility: "retrieved", disclosure: null, origin: "self",
      emotionalWeight: null, retention: { kind: "permanent" }, policyVersion: 1 } };
}
export function writeTestCall(requestId = "write-a"): MemoryProviderCallContext {
  return { requestId, authorityEpochId: "epoch", actor: "foreground-agent" };
}

export function memoryWriteFixture(input: { path?: string; bank?: CuratorTestBank } = {}) {
  const bank = input.bank ?? writeTestBank(); const base = curatorTestFixture({ path: input.path, banks: [bank] });
  const control = { replayNative: false, pullPolicy: true, loseApplicationAck: false,
    beforeRecovery: undefined as ((context: HindsightCallContext) => Promise<void>) | undefined,
    afterNativeRecovery: undefined as (() => Promise<void>) | undefined,
    extraGuard: undefined as ((guard: HindsightApplicationCommandGuard) => void) | undefined };
  const ports = createWritePorts(base, bank, control);
  const { route, journal, pending, pendingWriter, assertActive, client } = ports;
  const deps: HindsightMemoryWriteDeps = { db: base.db, epochId: "epoch", journal, replica: base.replica, pending,
    pendingWriter, writer: base.writer, client, requestTimeoutMs: 60_000,
    bank: (id) => { if (id !== route.bankId) throw new Error("MEMORY_AUTHORITY_MISMATCH"); return route; }, assertActive, now: () => base.clock.at,
    recover: async ({ bankId, context }) => {
      await control.beforeRecovery?.(context);
      if (control.replayNative) await replayWriteBank(base, ports, context);
      await control.afterNativeRecovery?.();
      await writes.advanceBank({ bankId, context, refresh: async () => {
        if (control.pullPolicy) await base.deps.refreshBank(bankId, context);
      } });
    } };
  const writes = createHindsightMemoryWrites(deps);
  return { base, bank, ...ports, deps, writes, control,
    refresh: () => base.deps.refreshBank(route.bankId, { timeoutMs: 60_000 }),
    call: writeTestCall,
    identity: (requestId = "write-a"): HindsightMemoryWriteIdentity => ({ key: { authorityEpochId: "epoch", bankId: route.bankId, requestId },
      namespace: bank.scope.namespace, actor: "foreground-agent", operation: { kind: "mutation", request: {
        kind: "edit", bankId: route.bankId, memoryId: WRITE_TEST_MEMORY, expectedRevision: 1, patch: { layerId: "profile" } } } }),
    close: async () => { await writes.stop(); await base.close(); } };
}
export type MemoryWriteFixture = ReturnType<typeof memoryWriteFixture>;

function createWritePorts(base: ReturnType<typeof curatorTestFixture>, bank: CuratorTestBank, control: {
  loseApplicationAck: boolean; extraGuard?: (guard: HindsightApplicationCommandGuard) => void;
}) {
  const now = () => base.clock.at;
  const route: MemoryReplicaBank = { bankId: bank.scope.bankId, scope: bank.bankScope.kind, characterId: bank.bankScope.characterId };
  const assertActive = (guard: HindsightApplicationCommandGuard) => {
    const epoch = base.authority.authorityEpoch(guard.key.authorityEpochId);
    const binding = base.replica.bankBinding(guard.key.bankId);
    if (epoch.providerId !== "hindsight" || epoch.providerLineageId !== guard.namespace.provider_lineage
      || binding?.authorityEpochId !== guard.key.authorityEpochId || !sameApplicationValue(binding.namespace, guard.namespace)
      || binding.bankDeleted) throw new Error("MEMORY_AUTHORITY_MISMATCH");
    control.extraGuard?.(guard);
  };
  const journal = createHindsightMemoryWriteRepo({ db: base.db, assertActive, now });
  const pending = createPendingMemoryRepo(base.db, now, (id) => base.replica.bankBinding(id)?.bank);
  const unused = (): never => { throw new Error("native-only B5 projection must not be used in the D77 fixture"); };
  const oldReplica = createHindsightReplicaSyncRepo({ db: base.db, tokenizer: createIntlSegmenterTokenizer({ stoplist: true }), now,
    projection: { bankScope: () => bank.bankScope, source: unused, memory: unused } });
  // Existing B5 replay consumes its native checkpoint/lease contract but the selected D77 read projection.
  // This delegates to the actual verified application repo; it never invents a Canonical target.
  const nativeReplica = { ...oldReplica, record: (query: Parameters<typeof oldReplica.record>[0]) =>
    base.replica.record({ ...bank.scope, ...query, includeHidden: true }) };
  const pendingWriter = createPendingMemoryWriter({ authority: base.authority, replica: nativeReplica, pending, now });
  const native = writeNativeFixture(bank, pending);
  const client = { ...bank.server.client, ...native.client } as HindsightClient;
  const commit = bank.server.client.commitApplication;
  bank.server.client.commitApplication = async (request) => {
    const result = await commit(request);
    if (control.loseApplicationAck) { control.loseApplicationAck = false; throw new Error("HINDSIGHT_UNREACHABLE"); }
    return result;
  };
  return { route, journal, pending, pendingWriter, nativeReplica, native, client, assertActive };
}

async function replayWriteBank(base: ReturnType<typeof curatorTestFixture>, ports: ReturnType<typeof createWritePorts>, context: HindsightCallContext): Promise<void> {
  const { pending, nativeReplica, client, route } = ports; const now = () => base.clock.at;
    const rows = pending.list({ authorityEpochId: "epoch", bankId: route.bankId, limit: 100 });
    for (const raw of rows) {
      if (raw.terminalAt !== null) continue;
      const lease = nativeReplica.leases.acquire({ bankId: route.bankId, ownerId: "write-g1-replay", durationMs: 60_000 });
      const guard = { lease, deadlineAt: new Date(Date.parse(now()) + 60_000).toISOString() };
      let row: PendingMemoryRecord | undefined;
      try {
        const request = () => {
          if (context.signal?.aborted) throw new Error("HINDSIGHT_CANCELLED");
          nativeReplica.leases.assert(lease); return context;
        };
        row = pending.claim({ record: raw, guard, forceRetry: true }); if (!row) continue;
        const replay: PendingReplayContext = { client, pending, replica: nativeReplica, guard, request, now,
          nativeResultSupported: true, beforeNativeDispatch: ({ record, context: call }) =>
            ensureHindsightPendingSource({ writer: base.writer, record, context: call }) };
        row = await replayPendingNative(replay, row);
        if (row.lease && row.phase === "submitted") row = await resolvePendingNative(replay, row);
      } finally { nativeReplica.leases.release(lease); }
      // Pull actual byte events before the second guarded confirmation. This deliberately uses a new lease
      // because the reusable curator fixture owns its pull lease; the final Bank service reuses one held lease.
      await base.deps.refreshBank(route.bankId, context);
      if (row?.phase !== "awaiting_pull") continue;
      const confirmLease = nativeReplica.leases.acquire({ bankId: route.bankId, ownerId: "write-g1-confirm", durationMs: 60_000 });
      const confirmGuard = { lease: confirmLease, deadlineAt: new Date(Date.parse(now()) + 60_000).toISOString() };
      try {
        const claimed = pending.claim({ record: row, guard: confirmGuard, forceRetry: true });
        if (claimed) pending.progress({ record: claimed, guard: confirmGuard, change: { kind: "confirm" },
          checkpoint: nativeReplica.checkpoint(route.bankId) });
      } finally { nativeReplica.leases.release(confirmLease); }
    }
}

export function readWriteSourceCommand(fixture: MemoryWriteFixture) {
  const rows = fixture.pending.list({ authorityEpochId: "epoch", bankId: fixture.route.bankId, limit: 100 });
  const row = rows.find((entry) => entry.intent.operation.kind === "retain"); if (!row) throw new Error("fixture source row missing");
  const job = fixture.base.writer.get({ authorityEpochId: "epoch", bankId: fixture.route.bankId, requestId: `source:${row.remoteOperationId}` });
  if (!job) throw new Error("fixture source command missing");
  const source = job.bodies.find((body) => body.content.body_schema === "application-source.v1");
  if (!source || source.content.body_schema !== "application-source.v1") throw new Error("fixture source body missing");
  // Re-encoding the stored content is a useful additional witness for tests inspecting complete typed originals.
  const encoded = applicationTestBody("application-source.v1", source.content.value, fixture.bank.scope);
  return { row, job, source, encoded };
}
