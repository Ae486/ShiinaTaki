/**
 * INPUT:  complete current Local state, prior final D77 history and the compiled native descriptor set
 * OUTPUT: complete artifact reuse/upsert/retire descriptors with exact original input and predecessor byte hashes
 * POS:    core/memory/transitions — W3 application delta; preserves all historical versions and policy ownership
 */
import type { HindsightTransitionDeltaRequest, MemoryTransitionCandidate, MemoryTransitionLocalCapture,
  MemoryTransitionNativeEvidence, MemoryTransitionSourceUpload, TakiApplicationArtifact, TakiApplicationArtifactKey } from "@taki/shared";
import { transitionProjectionContext, transitionSemanticHash } from "./transition-local-projection.ts";
import { transitionLocalObjects, transitionRetirement, type LocalObject } from "./transition-delta-rows.ts";
import { transitionLocalHash } from "./transition-local-encoding.ts";
import { compileTransitionSourceAliases, transitionMemorySourceSelectors, transitionSourceReferencesChanged } from "./transition-delta-sources.ts";

type Descriptor = HindsightTransitionDeltaRequest["application"][number];
export function compileTransitionApplicationDelta(input: { capture: MemoryTransitionLocalCapture; baseline: MemoryTransitionCandidate;
  evidence: MemoryTransitionNativeEvidence; localBankId: string; localLineageId: string; native: HindsightTransitionDeltaRequest["native"];
  uploads?: MemoryTransitionSourceUpload[] }): Descriptor[] {
  const context = transitionProjectionContext(input.evidence);
  const latest = latestArtifacts(context.artifacts.values());
  const current = transitionLocalObjects(input.capture.state, input.localBankId);
  const previous = transitionLocalObjects(input.baseline.state, input.localBankId);
  const descriptors = compileTransitionSourceAliases({ ...input, latest, uploads: input.uploads ?? [] });
  const consumed = new Set(descriptors.map((row) => JSON.stringify(row.key)));
  for (const object of current.filter((row) => !["mental_model", "directive"].includes(row.kind))) {
    const mapping = input.baseline.mappings.find((row) => row.localBankId === input.localBankId && row.kind === object.kind && row.localId === object.id);
    const mappedArtifact = mapping?.application ? latest.get(JSON.stringify(mapping.application.key)) : undefined;
    const artifact = mappedArtifact && !consumed.has(JSON.stringify(mappedArtifact.key)) ? mappedArtifact : undefined;
    const key: TakiApplicationArtifactKey = artifact?.key ?? { artifact_kind: artifactKind(object.kind), artifact_id: object.id };
    const old = previous.find((row) => row.kind === object.kind && row.id === object.id);
    const native = input.native.find((row) => row.source.source_kind === object.kind && row.source.source_id === object.id);
    // A fragment may be the physical head's latest association. Its own alias descriptor already owns that
    // artifact; unchanged physical documents need no invented second Source artifact.
    if (object.kind === "document" && !artifact && mappedArtifact && native?.disposition === "reuse") continue;
    const reuse = artifact && !artifact.tombstoned && old && native?.disposition === "reuse"
      && transitionSemanticHash(object.value) === transitionSemanticHash(old.value)
      && (object.kind !== "memory_unit" || !transitionSourceReferencesChanged(input, object.id));
    const body = reuse ? null : applicationBody(object, { ...input, sources: descriptors });
    descriptors.push(descriptor({ key, artifact, object, body, nativeSourceId: object.id }));
    consumed.add(JSON.stringify(key));
  }
  for (const block of input.capture.state.blocks.filter((block) => scopeForBank(input.capture, input.localBankId) === JSON.stringify(block.scope))) {
    const artifact = [...latest.values()].find((entry) => entry.key.artifact_kind === "block"
      && context.reader.body(entry.body_ref).content.body_schema === "application-block.v1"
      && (context.reader.body(entry.body_ref).content.value as { block_id?: string }).block_id === block.block_id);
    const prior = artifact ? context.reader.body(artifact.body_ref).content : null;
    const reuse = artifact && !artifact.tombstoned && prior?.body_schema === "application-block.v1"
      && transitionLocalHash(prior.value) === transitionLocalHash(block);
    const key = artifact?.key ?? { artifact_kind: "block" as const, artifact_id: block.block_id };
    descriptors.push({ key, expected_artifact: artifact ? version(artifact) : null, expected_body_hash: artifact?.body_ref.bytes_sha256 ?? null,
      source_record_hash: transitionLocalHash(block), disposition: reuse ? "reuse" : "upsert", native_source_id: null,
      body: reuse ? null : { artifact_kind: "block", body: block }, retirement: null });
    consumed.add(JSON.stringify(key));
  }
  for (const [key, artifact] of latest) if (!consumed.has(key)) {
    const mapped = input.baseline.mappings.find((row) => row.application && JSON.stringify(row.application.key) === key);
    const old = mapped && previous.find((row) => row.kind === mapped.kind && row.id === mapped.localId);
    const retired = !artifact.tombstoned && old ? transitionRetirement(input.capture, old) : null;
    // A live Block has no deletion producer; absence cannot silently delete it. Non-consumable original/history
    // artifacts remain explicit reuse descriptors instead of disappearing from the complete D77 inventory.
    if (!artifact.tombstoned && artifact.key.artifact_kind === "block") throw new Error("MEMORY_TRANSITION_PROOF_INVALID");
    descriptors.push({ key: artifact.key, expected_artifact: version(artifact), expected_body_hash: artifact.body_ref.bytes_sha256,
      source_record_hash: old ? transitionLocalHash(old.value) : artifact.record_hash, disposition: retired ? "retire" : "reuse",
      native_source_id: mapped?.localId ?? null, body: null, retirement: retired });
  }
  return descriptors;
}
function latestArtifacts(artifacts: Iterable<TakiApplicationArtifact>) {
  const latest = new Map<string, TakiApplicationArtifact>();
  for (const artifact of artifacts) {
    const key = JSON.stringify(artifact.key); const previous = latest.get(key);
    if (!previous || previous.revision < artifact.revision) latest.set(key, artifact);
  }
  return latest;
}
function descriptor(input: { key: TakiApplicationArtifactKey; artifact: TakiApplicationArtifact | undefined;
  object: LocalObject; body: Descriptor["body"]; nativeSourceId: string }): Descriptor {
  return { key: input.key, expected_artifact: input.artifact ? version(input.artifact) : null,
    expected_body_hash: input.artifact?.body_ref.bytes_sha256 ?? null, source_record_hash: transitionLocalHash(input.object.value),
    disposition: input.body ? "upsert" : "reuse", native_source_id: input.nativeSourceId, body: input.body, retirement: null };
}
function applicationBody(object: LocalObject, input: Parameters<typeof compileTransitionApplicationDelta>[0] & {
  sources: Descriptor[];
}): Descriptor["body"] {
  if (object.kind === "bank") {
    const bank = input.capture.state.banks.find((row) => row.bankId === object.id); if (!bank) invalid();
    return { artifact_kind: "bank", body: { scope: bank.scope, original_bank: bank,
      original_authority_epoch_id: input.capture.epochId, original_provider_lineage: input.localLineageId } };
  }
  if (object.kind === "document") {
    const source = input.capture.state.sources.find((row) => row.bankId === input.localBankId && row.documentId === object.id); if (!source) invalid();
    return { artifact_kind: "source", body: { original_source: source, encoded_metadata: source.metadata, original_witness: null, operation_id: null } };
  }
  const record = input.capture.state.records.find((row) => row.unit.bankId === input.localBankId && row.unit.memoryId === object.id); if (!record) invalid();
  const selectors = transitionMemorySourceSelectors({ ...input, memoryId: object.id });
  const body = { policy_basis: "curated" as const, policy: record.policy, provenance: record.provenance,
    original_record: record, encoded_metadata: record.unit.metadata };
  if (selectors.every((ref) => ref.kind === "delta")) return { artifact_kind: "memory",
    body: { ...body, source_artifacts: selectors.map((ref) => ref.key) } };
  return { artifact_kind: "memory_evidence", body: { ...body, source_artifacts: selectors } };
}
function artifactKind(kind: LocalObject["kind"]): TakiApplicationArtifactKey["artifact_kind"] {
  if (kind === "bank") return "bank"; if (kind === "document") return "source"; if (kind === "memory_unit") return "memory";
  return invalid();
}
function scopeForBank(capture: MemoryTransitionLocalCapture, id: string): string {
  const bank = capture.state.banks.find((row) => row.bankId === id); if (!bank) invalid(); return JSON.stringify(bank.scope);
}
function version(artifact: TakiApplicationArtifact) { return { key: artifact.key, revision: artifact.revision, record_hash: artifact.record_hash }; }
function invalid(): never { throw new Error("MEMORY_TRANSITION_PROOF_INVALID"); }
