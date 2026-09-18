/**
 * INPUT:  native recall candidates and a complete authenticated joint hydration bundle
 * OUTPUT: exact current Canonical hits admitted by persisted Taki policy before result limits
 * POS:    core/memory/hindsight — candidate hydration never borrows an older replica revision or fabricates missing policy
 */
import type { CanonicalMemoryUnit, HindsightNativeRecallResponse, MemoryBankScope, RecallRequest, RecallResult,
  TakiApplicationArtifactVersion } from "@taki/shared";
import type { HindsightApplicationBundle } from "./hindsight-application-bundle.ts";
import { verifyHindsightApplicationBundle } from "./hindsight-application-bundle.ts";
import { projectHindsightApplicationRecord, readHindsightApplicationNative,
  type HindsightApplicationEvidenceReader } from "./hindsight-application-projection.ts";
import { hindsightApplicationPolicyContext } from "./hindsight-application-binding-context.ts";
import { hindsightPolicyAdmission } from "./hindsight-policy-admission.ts";
import { sameApplicationValue, type HindsightApplicationScope } from "./hindsight-application-integrity.ts";

type Candidate = HindsightNativeRecallResponse["results"][number];
interface Input extends HindsightApplicationScope {
  bundle: HindsightApplicationBundle; authorityEpochId: string; bankScope: MemoryBankScope;
  candidates: Candidate[]; request: RecallRequest; at: string;
}

export function projectHindsightRecall(input: Input): { hits: RecallResult["hits"]; needsBinding: boolean; stale: boolean } {
  verifyHindsightApplicationBundle(input.bundle, input);
  const descriptors = input.bundle.pages.flatMap((page) => page.records);
  const heads = new Map(descriptors.flatMap((entry) => entry.kind === "native" ? [[`${entry.head.object_kind}:${entry.head.object_id}`, entry.head] as const] : []));
  const evidence = bundleEvidence(input.bundle);
  const bankHead = heads.get(`bank:${input.bankId}`);
  if (!bankHead?.version || bankHead.binding_state === "tombstoned") invalid();
  if (bankHead.binding_state !== "bound") return { hits: [], needsBinding: true, stale: false };
  const bankProjection = projectHindsightApplicationRecord({ ...input, evidence, bank: undefined, head: bankHead });
  if (bankProjection.status !== "projected" || bankProjection.record.payload?.kind !== "bank") invalid();
  const bank = bankProjection.record.payload.value;
  const result: ReturnType<typeof projectHindsightRecall> = { hits: [], needsBinding: false, stale: false };
  for (const candidate of input.candidates) {
    const head = heads.get(`memory_unit:${candidate.id}`);
    if (!head || head.binding_state === "tombstoned") { result.stale = true; continue; }
    if (head.binding_state !== "bound" || !head.bound_artifact) { result.needsBinding = true; continue; }
    const native = readHindsightApplicationNative({ ...input, evidence, head });
    const context = hindsightApplicationPolicyContext({ ...input, bank }, native);
    if (!candidateStillMatches(candidate, context.native.unit)) { result.stale = true; continue; }
    const artifact = evidence.artifact(head.bound_artifact); const content = evidence.body(artifact.body_ref).content;
    if (content.body_schema !== "application-memory.v1") invalid();
    if (!input.request.factTypes.includes(context.native.unit.factType)
      || !hindsightPolicyAdmission({ context, state: { status: "present", namespace: input.namespace, bankId: input.bankId,
        native: native.version, artifact: head.bound_artifact, body: content.value }, at: input.at,
      query: input.request.query, layerIds: input.request.layerIds }).eligible) continue;
    const projected = projectHindsightApplicationRecord({ ...input, evidence, bank, head });
    if (projected.status !== "projected" || projected.record.payload?.kind !== "memory_unit") invalid();
    result.hits.push({ record: projected.record.payload.value, confirmed: true,
      scores: candidate.scores ? [{ source: "provider", value: candidate.scores.final, higherIsBetter: true }] : [] });
  }
  return result;
}

export function bundleEvidence(bundle: HindsightApplicationBundle): HindsightApplicationEvidenceReader {
  const artifacts = new Map(bundle.pages.flatMap((page) => page.records).flatMap((entry) =>
    entry.kind === "artifact" ? [[artifactKey(entry.artifact), entry.artifact] as const] : []));
  return {
    body: (ref) => {
      const body = bundle.bodies.get(ref.body_id);
      if (!body || !sameApplicationValue(body.ref, ref)) invalid();
      return body;
    },
    artifact: (version) => {
      const artifact = artifacts.get(artifactKey(version));
      if (!artifact || artifact.record_hash !== version.record_hash) invalid();
      return artifact;
    },
  };
}

function candidateStillMatches(candidate: Candidate, unit: CanonicalMemoryUnit): boolean {
  if (candidate.id !== unit.memoryId || candidate.text !== unit.text) return false;
  const fields = { type: unit.factType, context: unit.context, document_id: unit.documentId, chunk_id: unit.chunkId,
    occurred_start: unit.occurredStart, occurred_end: unit.occurredEnd, mentioned_at: unit.mentionedAt,
    tags: unit.tags, metadata: unit.metadata, source_fact_ids: unit.sourceMemoryIds, entities: unit.entities };
  return Object.entries(fields).every(([key, value]) => {
    const actual = candidate[key as keyof Candidate];
    // Some native recall options omit these fields. Supplied fields must agree
    // with the exact hydration version; absent fields cannot prove a revision.
    return actual === undefined || actual === null && ["tags", "metadata", "entities", "source_fact_ids"].includes(key)
      || sameApplicationValue(actual, value);
  });
}

function artifactKey(value: Pick<TakiApplicationArtifactVersion, "key" | "revision">): string {
  return JSON.stringify([value.key.artifact_kind, value.key.artifact_id, value.revision]);
}
function invalid(): never { throw new Error("HINDSIGHT_APPLICATION_RECALL_EVIDENCE_INVALID"); }
