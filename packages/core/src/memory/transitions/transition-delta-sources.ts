/**
 * INPUT: complete current Source aliases/reference sets and their exact common-baseline artifacts
 * OUTPUT: application-only Source descriptors and ordered existing-or-this-delta Memory selectors
 * POS: core/memory/transitions — fragment evidence changes never rewrite its physical native document
 */
import type { HindsightTransitionDeltaRequest, MemoryTransitionCandidate, MemoryTransitionLocalCapture,
  MemoryTransitionSourceUpload, TakiApplicationArtifact, TakiApplicationArtifactKey } from "@taki/shared";
import { transitionSemanticHash } from "./transition-local-projection.ts";
import { transitionLocalHash } from "./transition-local-encoding.ts";
import { transitionRetirement } from "./transition-delta-rows.ts";

type Descriptor = HindsightTransitionDeltaRequest["application"][number];
type Input = { capture: MemoryTransitionLocalCapture; baseline: MemoryTransitionCandidate; localBankId: string;
  latest: Map<string, TakiApplicationArtifact>; uploads: MemoryTransitionSourceUpload[];
  native: HindsightTransitionDeltaRequest["native"] };
export function compileTransitionSourceAliases(input: Input): Descriptor[] {
  return input.baseline.state.sourceAliases.filter((alias) => alias.bankId === input.localBankId).map((alias) => {
    const artifact = input.latest.get(JSON.stringify(alias.artifact.key));
    const old = input.baseline.state.sources.find((row) => row.bankId === alias.bankId && row.documentId === alias.documentId);
    const current = input.capture.state.sources.find((row) => row.bankId === alias.bankId && row.documentId === alias.documentId);
    if (!artifact || !old || transitionLocalHash(version(artifact)) !== transitionLocalHash(alias.artifact)) invalid();
    const changed = current && transitionSemanticHash(current) !== transitionSemanticHash(old);
    const upload = input.uploads.find((row) => row.documentId === alias.documentId && row.localBankId === alias.bankId);
    const physical = input.native.find((row) => row.source.source_kind === "document" && row.source.source_id === alias.physicalDocumentId);
    if (changed && (!upload || artifact.tombstoned || !physical?.target || physical.disposition === "delete")) invalid();
    const retirement = !current && !artifact.tombstoned ? transitionRetirement(input.capture,
      { kind: "document", id: old.documentId, revision: old.revision, value: old, native: {} }) : null;
    return { key: artifact.key, expected_artifact: version(artifact), expected_body_hash: artifact.body_ref.bytes_sha256,
      source_record_hash: changed ? upload?.sourceHash ?? invalid() : transitionLocalHash(current ?? old),
      native_source_id: alias.physicalDocumentId, disposition: changed ? "upsert" : retirement ? "retire" : "reuse",
      body: changed ? { artifact_kind: "source_evidence", body: { source_ref: upload?.ref ?? invalid(),
        expected_document: physical?.target ?? invalid() } } : null, retirement };
  });
}
export function transitionSourceReferencesChanged(input: Pick<Input, "capture" | "baseline" | "localBankId">, memoryId: string): boolean {
  const current = sourceSet(input.capture.state.sourceSets, input.localBankId, memoryId);
  const old = input.baseline.state.sourceSets.find((row) => row.bankId === input.localBankId && row.memoryId === memoryId);
  const hash = (references: typeof current.references) => transitionLocalHash(references.map((ref) =>
    ({ documentId: ref.documentId, artifact: ref.artifact, intent: ref.intent, source: transitionSemanticHash(ref.source) })));
  return !old || hash(current.references) !== hash(old.references);
}
export function transitionMemorySourceSelectors(input: Pick<Input, "capture" | "baseline" | "localBankId"> & {
  memoryId: string; sources: Descriptor[];
}) {
  const set = sourceSet(input.capture.state.sourceSets, input.localBankId, input.memoryId);
  return set.references.map((ref) => {
    if (ref.intent === "existing") {
      if (!ref.artifact) invalid();
      return { kind: "existing" as const, version: ref.artifact };
    }
    const alias = input.baseline.state.sourceAliases.find((row) => row.bankId === set.bankId && row.documentId === ref.documentId);
    const mapping = input.baseline.mappings.find((row) => row.localBankId === set.bankId && row.kind === "document" && row.localId === ref.documentId);
    const key: TakiApplicationArtifactKey = alias?.artifact.key ?? mapping?.application?.key ?? { artifact_kind: "source", artifact_id: ref.documentId };
    const source = input.sources.find((row) => JSON.stringify(row.key) === JSON.stringify(key));
    if (!source || source.disposition === "retire") invalid();
    if (source.disposition === "upsert") return { kind: "delta" as const, key };
    // A newly attached Local reference may select an unchanged Source only when the exact complete
    // baseline snapshot proves those bytes; merely finding a newer artifact with the key is insufficient.
    const prior = input.baseline.state.sources.find((row) => row.bankId === set.bankId && row.documentId === ref.documentId);
    if (!source.expected_artifact || !prior || transitionSemanticHash(prior) !== transitionSemanticHash(ref.source)) invalid();
    return { kind: "existing" as const, version: source.expected_artifact };
  });
}
function sourceSet(sets: MemoryTransitionLocalCapture["state"]["sourceSets"], bankId: string, memoryId: string) {
  return sets.find((row) => row.bankId === bankId && row.memoryId === memoryId) ?? invalid();
}
function version(artifact: TakiApplicationArtifact) { return { key: artifact.key, revision: artifact.revision, record_hash: artifact.record_hash }; }
function invalid(): never { throw new Error("MEMORY_TRANSITION_PROOF_INVALID"); }
