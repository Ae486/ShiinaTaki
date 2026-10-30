/**
 * INPUT:  one validated original retain or mutation under a verified Hindsight Bank
 * OUTPUT: atomic parent intent plus required native/source children, or a stable no-dispatch result
 * POS:    core/memory/hindsight — preflight before native I/O; layer changes never become fake native entity edits
 */
import { createHash } from "node:crypto";
import { MutationRequestSchema, type MutationRequest, type PendingMemoryOperation } from "@taki/shared";
import { hindsightMemoryWriteIntentHash, type HindsightMemoryWriteJob } from "../../db/hindsight-memory-write-contract.ts";
import { getLayer } from "../layer-registry.ts";
import { requireLayerOwnership } from "../canonical-layer-policy.ts";
import { prepareTrackedDispatch } from "./hindsight-native-proof.ts";
import { prepareHindsightPendingSource } from "./hindsight-application-source-write.ts";
import { readHindsightMemoryWriteTarget, type HindsightMemoryWriteContext } from "./hindsight-memory-write-context.ts";
import { preflightHindsightMemoryLayer } from "./hindsight-memory-write-policy.ts";

export function admitHindsightMemoryWrite(context: HindsightMemoryWriteContext): HindsightMemoryWriteJob {
  context.request();
  const previous = context.deps.journal.get(context.identity.key);
  if (previous) {
    if (previous.intentHash !== hindsightMemoryWriteIntentHash(context.identity)) throw new Error("MEMORY_REQUEST_ID_CONFLICT");
    return previous;
  }
  let result: HindsightMemoryWriteJob | undefined;
  context.deps.db.transaction(() => { context.request(); result = prepare(context); context.request(); });
  if (!result) throw new Error("MEMORY_INTERNAL_ERROR"); return result;
}

function prepare(context: HindsightMemoryWriteContext): HindsightMemoryWriteJob {
  const operation = context.identity.operation; const { deps, identity } = context;
  if (operation.kind === "retain") {
    if (context.route.scope === "character" && operation.request.provenance.characterId !== context.route.characterId) {
      throw new Error("MEMORY_INVALID_REQUEST");
    }
    const layer = getLayer(operation.request.policy.layerId);
    if (operation.request.policy.layerId !== "unclassified") {
      if (!layer) throw new Error("MEMORY_INVALID_REQUEST"); requireLayerOwnership(context.bank, layer);
    }
    const row = enqueueNative(context, { operation, operationId: identity.key.requestId });
    // Both envelopes are preflighted inside this transaction. An unsupported
    // source cannot leave a native child that a scheduler might dispatch later.
    prepareTrackedDispatch(row, null);
    prepareHindsightPendingSource({ writer: deps.writer, record: row });
    return deps.journal.prepare({ identity, nativeOperationId: row.intent.operationId, target: null });
  }
  return prepareMutation(context, operation.request);
}

function prepareMutation(context: HindsightMemoryWriteContext, request: MutationRequest): HindsightMemoryWriteJob {
  const { deps, identity } = context;
  const target = readHindsightMemoryWriteTarget(deps, { bankId: identity.key.bankId, namespace: identity.namespace, memoryId: request.memoryId });
  if (!target || target.native.object_revision !== request.expectedRevision) {
    return deps.journal.prepare({ identity, target: null, nativeOperationId: null,
      terminal: { kind: "mutation", result: target ? { outcome: "superseded", record: target.record } : { outcome: "not_found", record: null } } });
  }
  if (target.record.unit.factType === "observation") throw new Error("MEMORY_CAPABILITY_UNSUPPORTED");
  if (request.kind === "edit" && request.patch.layerId !== undefined) {
    const layer = getLayer(request.patch.layerId); if (!layer) throw new Error("MEMORY_INVALID_REQUEST");
    requireLayerOwnership(context.bank, layer);
    preflightHindsightMemoryLayer({ identity, target, bank: context.bank, at: deps.now?.() ?? new Date().toISOString(),
      intentionsDefaultDays: deps.intentionsDefaultDays });
  }
  const native = hindsightNativeMutationRequest(request);
  const operationId = native === null ? null : `native:${createHash("sha256").update(hindsightMemoryWriteIntentHash(identity)).digest("hex")}`;
  if (native && operationId) {
    const child = enqueueNative(context, { operation: { kind: "mutation", request: native }, operationId });
    prepareTrackedDispatch(child, native);
  }
  return deps.journal.prepare({ identity, target, nativeOperationId: operationId });
}

function enqueueNative(context: HindsightMemoryWriteContext, input: { operation: PendingMemoryOperation; operationId: string }) {
  return context.deps.pendingWriter.enqueue(input.operation, { authorityEpochId: context.identity.key.authorityEpochId,
    requestId: input.operationId, actor: context.identity.actor, signal: context.request().signal }, context.route);
}

export function hindsightNativeMutationRequest(request: MutationRequest): MutationRequest | null {
  if (request.kind !== "edit") return request;
  const patch = { ...request.patch }; delete patch.layerId;
  return Object.keys(patch).length === 0 ? null : MutationRequestSchema.parse({ ...request, patch });
}
