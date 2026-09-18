/**
 * INPUT:  a native-completed retain child, immutable G1 result pages and a verified application checkpoint
 * OUTPUT: complete original memory references and a stable retain result with an actually observed source revision
 * POS:    core/memory/hindsight — native confirmation is independent of model assessment and source provenance rebinding
 */
import type { HindsightNativeReference, PendingMemoryRecord } from "@taki/shared";
import type { HindsightMemoryWriteJob } from "../../db/hindsight-memory-write-contract.ts";
import { nativeProofHash, verifyNativeResultPages } from "./hindsight-native-proof.ts";
import type { HindsightCallContext } from "./hindsight-client.ts";
import type { HindsightMemoryWriteDeps } from "./hindsight-memory-write-context.ts";

export async function completeHindsightMemoryRetain(deps: HindsightMemoryWriteDeps, input: {
  job: HindsightMemoryWriteJob; child: PendingMemoryRecord; request(): HindsightCallContext;
}): Promise<void> {
  let job = input.job; const { child } = input;
  if (child.phase !== "completed" || child.intent.operation.kind !== "retain" || child.documentId === null) return;
  input.request();
  if (!job.references) {
    const value = await readReferences(deps, input); input.request();
    job = deps.journal.references({ key: job.identity.key, revision: job.revision, value });
  }
  const scope = { bankId: job.identity.key.bankId, namespace: job.identity.namespace };
  const head = deps.replica.nativeHead({ ...scope, objectKind: "document", objectId: child.documentId });
  const source = deps.replica.logicalRecord({ ...scope, objectKind: "document", objectId: child.documentId });
  if (!head?.version || head.binding_state !== "bound" || source?.payload?.kind !== "document") return;
  if (source.payload.value.revision !== head.version.object_revision || source.payload.value.documentId !== child.documentId) {
    throw new Error("MEMORY_INTEGRITY_ERROR");
  }
  // G1 proves the operation's complete historical references, not a document
  // revision. This is the real source revision observed at the confirming
  // application checkpoint. A later source edit never fabricates provenance
  // for the original source artifact, and replay returns this saved result.
  const memories = job.references?.memories; if (!memories) throw new Error("MEMORY_INTEGRITY_ERROR");
  input.request();
  deps.journal.finish({ key: job.identity.key, revision: job.revision, terminal: { kind: "retain", result: {
    status: "completed", documentId: child.documentId, sourceRevision: source.payload.value.revision,
    memories, ...(memories.length === 0 ? { zeroResult: true } : {}),
  } } });
}

async function readReferences(deps: HindsightMemoryWriteDeps, input: {
  child: PendingMemoryRecord; request(): HindsightCallContext;
}): Promise<NonNullable<HindsightMemoryWriteJob["references"]>> {
  const { child } = input;
  if (child.nativeResultReceipt) {
    const references: HindsightNativeReference[] = [];
    const read = deps.client.nativeResultPage; if (!read) throw new Error("HINDSIGHT_NATIVE_RESULT_UNAVAILABLE");
    await verifyNativeResultPages({ record: child, result: child.nativeResultReceipt.result, request: input.request,
      now: deps.now ?? (() => new Date().toISOString()), client: { ...deps.client, nativeResultPage: async (query) => {
        const page = await read(query); references.push(...page.references); return page;
      } } });
    return { resultHash: child.nativeResultReceipt.result.result_hash,
      memories: references.map((reference) => ({ memoryId: reference.memory_id, revision: reference.revision })) };
  }
  if (child.nativeReceipt?.kind !== "retain") throw new Error("MEMORY_INTEGRITY_ERROR");
  return { resultHash: nativeProofHash(child.nativeReceipt), memories: child.nativeReceipt.memories };
}
