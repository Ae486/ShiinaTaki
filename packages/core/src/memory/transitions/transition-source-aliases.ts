/**
 * INPUT: complete D77 Source inventory, exact Memory source lists and physical document mappings
 * OUTPUT: independent logical Source aliases and ordered version-pinned reference snapshots
 * POS: core/memory/transitions — append fragments remain original evidence, never whole-document replacements
 */
import { HindsightCurrentCanonicalSourceSchema, MemoryTransitionSourceAliasSchema, type CanonicalMemorySource, type CanonicalMemoryRecord,
  type MemoryTransitionSourceAlias, type MemoryTransitionSourceSet, type TakiApplicationArtifact } from "@taki/shared";
import { readHindsightApplicationSourceArtifact } from "../hindsight/hindsight-application-source-evidence.ts";
import { originalId, stableDerivedId, transitionObjectKey, type LocalBankProjectionInput,
  type TransitionProjectionContext } from "./transition-local-projection.ts";
import { transitionLocalHash } from "./transition-local-encoding.ts";
import { canonicalEvidenceTargets } from "../../db/canonical-memory-maintenance-evidence.ts";

type Input = LocalBankProjectionInput;
type Context = TransitionProjectionContext;
type Projection = { sources: CanonicalMemorySource[]; records: CanonicalMemoryRecord[] };
export function projectTransitionSourceState(input: Input, context: Context, target: { output: Projection; ids: Map<string, string> }) {
  const { output, ids } = target;
  const latest = new Map<string, TakiApplicationArtifact>();
  for (const artifact of context.artifacts.values()) if (artifact.key.artifact_kind === "source") {
    const key = JSON.stringify(artifact.key); const old = latest.get(key);
    if (!old || old.revision < artifact.revision) latest.set(key, artifact);
  }
  const aliases: MemoryTransitionSourceAlias[] = []; const artifactIds = new Map<string, string>();
  const referenced = new Set(output.records.flatMap((record) => {
    const head = context.heads.find((row) => row.object_kind === "memory_unit" && ids.get(transitionObjectKey("memory_unit", row.object_id)) === record.unit.memoryId);
    const body = head ? context.body(head) : null;
    return body?.body_schema === "application-memory.v1" ? body.value.source_artifacts.map((ref) => JSON.stringify(ref.key)) : [];
  }));
  for (const artifact of latest.values()) {
    if (artifact.tombstoned && !referenced.has(JSON.stringify(artifact.key))) continue;
    // These artifacts are classified separately with exact Pending/operation evidence. Their mere
    // presence cannot invent a physical document or grant confirmation to an unexecuted retain.
    if (artifact.binding.kind === "awaiting_native") continue;
    if (artifact.binding.kind !== "exact_native" || artifact.binding.native.object_kind !== "document") invalid();
    const physicalId = ids.get(transitionObjectKey("document", artifact.binding.native.object_id));
    if (!physicalId) invalid();
    const source = sourceForArtifact(input, context, artifact);
    const nativeId = artifact.binding.native.object_id;
    const physical = context.heads.find((row) => row.object_kind === "document" && row.object_id === nativeId);
    if (!physical) invalid();
    const logicalId = originalId({ body_schema: "application-source.v1", value: source }, input)
      ?? stableDerivedId([input.namespace.provider_lineage, input.scope.nativeBankId,
        input.scope.nativeGeneration, "source-artifact", JSON.stringify(artifact.key)]);
    artifactIds.set(JSON.stringify(artifact.key), logicalId);
    if (logicalId === physicalId && physical.version) continue;
    const value = relocateSource(source.original_source, input, logicalId);
    const existing = output.sources.find((row) => row.documentId === logicalId);
    if (existing && transitionLocalHash(existing) !== transitionLocalHash(value)) invalid();
    if (!existing) output.sources.push(value);
    aliases.push(MemoryTransitionSourceAliasSchema.parse({ bankId: input.scope.localBankId, documentId: logicalId,
      physicalDocumentId: physicalId, artifact: version(artifact), native: artifact.binding.native,
      evidenceId: input.evidenceId, retired: artifact.tombstoned || physical.version === null }));
  }
  const sets = projectSourceSets(input, { context, output, ids, artifactIds });
  appendOriginalEvidenceTargets(input, { context, output, ids, artifactIds, latest, sets });
  return { aliases, sets };
}
function appendOriginalEvidenceTargets(input: Input, state: { context: Context; output: Projection; ids: Map<string, string>;
  artifactIds: Map<string, string>; latest: Map<string, TakiApplicationArtifact>; sets: MemoryTransitionSourceSet[] }): void {
  for (const artifact of state.latest.values()) {
    const documentId = state.artifactIds.get(JSON.stringify(artifact.key));
    if (!documentId || artifact.tombstoned) continue;
    const original = sourceForArtifact(input, state.context, artifact).original_source;
    for (const target of canonicalEvidenceTargets(original)) {
      let memoryId: string | undefined;
      if (target.bankId === input.scope.localBankId && (target.epochId === input.scope.originEpochId || input.localEpochIds?.includes(target.epochId))) {
        memoryId = target.memoryId;
      } else if (target.bankId === input.scope.nativeBankId && target.epochId === original.authorityEpochId && original.bankId === target.bankId) {
        memoryId = state.ids.get(transitionObjectKey("memory_unit", target.memoryId));
      }
      const set = state.sets.find((row) => row.memoryId === memoryId);
      if (!set || set.references.some((ref) => ref.documentId === documentId)) continue;
      set.references.push({ documentId, artifact: version(artifact), intent: "existing",
        source: relocateSource(original, input, documentId) });
    }
  }
}
function projectSourceSets(input: Input, state: { context: Context; output: Projection; ids: Map<string, string>; artifactIds: Map<string, string> }): MemoryTransitionSourceSet[] {
  const { context, output, ids, artifactIds } = state;
  return output.records.map((record) => {
    const head = context.heads.find((row) => row.object_kind === "memory_unit"
      && ids.get(transitionObjectKey("memory_unit", row.object_id)) === record.unit.memoryId);
    if (!head) invalid();
    const body = context.body(head);
    const references = body?.body_schema === "application-memory.v1" ? body.value.source_artifacts.map((ref) => {
      const artifact = context.reader.artifact(ref);
      const id = artifactIds.get(JSON.stringify(artifact.key)); if (!id || artifact.tombstoned) invalid();
      return { documentId: id, artifact: ref, intent: "existing" as const,
        source: relocateSource(sourceForArtifact(input, context, artifact).original_source, input, id) };
    }) : record.unit.documentId === null ? [] : [{ documentId: record.unit.documentId, artifact: null, intent: "local" as const,
      source: output.sources.find((source) => source.documentId === record.unit.documentId) ?? invalid() }];
    return { bankId: record.unit.bankId, memoryId: record.unit.memoryId, references };
  });
}
function sourceForArtifact(input: Input, context: Context, artifact: TakiApplicationArtifact) {
  return readHindsightApplicationSourceArtifact({ bankId: input.scope.nativeBankId,
    namespace: input.namespace, artifact, evidence: context.reader }).source;
}
function relocateSource(source: CanonicalMemorySource, input: Input, documentId: string): CanonicalMemorySource {
  return HindsightCurrentCanonicalSourceSchema.parse({ ...source, authorityEpochId: input.epochId, bankId: input.scope.localBankId, documentId });
}
function version(artifact: TakiApplicationArtifact) { return { key: artifact.key, revision: artifact.revision, record_hash: artifact.record_hash }; }
function invalid(): never { throw new Error("MEMORY_TRANSITION_PROOF_INVALID"); }
