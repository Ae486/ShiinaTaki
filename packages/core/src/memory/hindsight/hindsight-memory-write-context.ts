/**
 * INPUT:  captured provider identity, trusted Bank routing and exact D77 application evidence
 * OUTPUT: guarded write contexts and verified mutation targets shared by admission and recovery
 * POS:    core/memory/hindsight — foreground write boundary; no Authority fallback or fabricated policy
 */
import type { CanonicalMemoryBank, MemoryReplicaBank, PendingMemoryOperation, TakiApplicationNamespace } from "@taki/shared";
import type { Database } from "../../db/sqlite.ts";
import type { HindsightApplicationReplicaRepo } from "../../db/hindsight-application-replica-contract.ts";
import type { HindsightApplicationCommandGuard } from "../../db/hindsight-application-command-contract.ts";
import type { HindsightMemoryWriteRepo } from "../../db/hindsight-memory-write-repo.ts";
import type { HindsightMemoryWriteIdentity, HindsightMemoryWriteTarget } from "../../db/hindsight-memory-write-contract.ts";
import type { PendingMemoryRepo } from "../../db/pending-memory-repo.ts";
import type { PendingMemoryWriter } from "../pending-memory-writer.ts";
import type { MemoryProviderCallContext } from "../memory-provider.ts";
import type { HindsightCallContext, HindsightClient } from "./hindsight-client.ts";
import type { HindsightApplicationWriter } from "./hindsight-application-writer.ts";
import { hindsightApplicationDeadline } from "./hindsight-application-body-transfer.ts";
import { hindsightApplicationArtifactVersion, hindsightApplicationEvidenceReader } from "./hindsight-application-binding-context.ts";
import { readHindsightApplicationNative } from "./hindsight-application-projection.ts";
import { sameApplicationValue } from "./hindsight-application-integrity.ts";
import { hindsightError } from "./hindsight-errors.ts";

export interface HindsightMemoryWriteDeps {
  db: Database; epochId: string; journal: HindsightMemoryWriteRepo; replica: HindsightApplicationReplicaRepo;
  pending: PendingMemoryRepo; pendingWriter: PendingMemoryWriter; writer: HindsightApplicationWriter; client: HindsightClient;
  requestTimeoutMs: number; intentionsDefaultDays?: number;
  bank(bankId: string): MemoryReplicaBank;
  assertActive(input: HindsightApplicationCommandGuard): void;
  recover(input: { bankId: string; context: HindsightCallContext }): Promise<void>;
  now?: () => string;
}
export interface HindsightMemoryWriteContext {
  deps: HindsightMemoryWriteDeps; identity: HindsightMemoryWriteIdentity; bank: CanonicalMemoryBank; route: MemoryReplicaBank;
  request(): HindsightCallContext;
  /** Local receipt readback keeps cancellation and Authority guards without spending an expired I/O budget. */
  assertActive(): void;
}
export interface HindsightMemoryWriteAdvance {
  bankId: string; context: HindsightCallContext;
  /** Reuses the currently held Bank lease. Acquiring another lease here would deadlock recovery. */
  refresh(): Promise<void>;
}

export function captureHindsightMemoryWrite(deps: HindsightMemoryWriteDeps, input: {
  call: MemoryProviderCallContext; operation: PendingMemoryOperation;
}): HindsightMemoryWriteContext {
  if (input.call.authorityEpochId !== deps.epochId) throw new Error("MEMORY_AUTHORITY_MISMATCH");
  const bankId = input.operation.request.bankId; const route = deps.bank(bankId);
  const bound = deps.replica.bankBinding(bankId);
  if (!bound?.bank || bound.bankDeleted || bound.bindingState !== "bound") throw new Error("HINDSIGHT_APPLICATION_BANK_UNAVAILABLE");
  if (bound.authorityEpochId !== deps.epochId || route.bankId !== bankId
    || bound.scope.kind !== route.scope || bound.scope.characterId !== route.characterId) throw new Error("MEMORY_AUTHORITY_MISMATCH");
  const identity: HindsightMemoryWriteIdentity = { key: { authorityEpochId: deps.epochId, bankId, requestId: input.call.requestId },
    namespace: bound.namespace, actor: input.call.actor, operation: input.operation };
  const remaining = hindsightApplicationDeadline({ timeoutMs: deps.requestTimeoutMs, signal: input.call.signal });
  const assertActive = () => {
    if (input.call.signal?.aborted) throw hindsightError("HINDSIGHT_CANCELLED");
    deps.assertActive(identity);
  };
  const request = () => { const context = remaining(); assertActive(); return context; };
  request(); return { deps, identity, bank: bound.bank, route, request, assertActive };
}

export function readHindsightMemoryWriteTarget(deps: HindsightMemoryWriteDeps, input: {
  bankId: string; namespace: TakiApplicationNamespace; memoryId: string;
}): HindsightMemoryWriteTarget | undefined {
  const head = deps.replica.nativeHead({ ...input, objectKind: "memory_unit", objectId: input.memoryId });
  if (!head || head.binding_state === "tombstoned") return undefined;
  if (!head.version || head.binding_state !== "bound" || !head.bound_artifact) throw new Error("HINDSIGHT_APPLICATION_BINDING_EVIDENCE_INVALID");
  const evidence = hindsightApplicationEvidenceReader(deps.replica, input);
  const native = readHindsightApplicationNative({ ...input, head, evidence });
  const artifact = evidence.artifact(head.bound_artifact); const content = evidence.body(artifact.body_ref).content;
  const record = deps.replica.record({ ...input, includeInvalidated: true, includeHidden: true });
  if (!record || content.body_schema !== "application-memory.v1" || artifact.binding.kind !== "exact_native"
    || !sameApplicationValue(artifact.binding.native, native.version)) throw new Error("MEMORY_INTEGRITY_ERROR");
  return { native: native.version, artifact: hindsightApplicationArtifactVersion(artifact), body: content.value, record };
}
