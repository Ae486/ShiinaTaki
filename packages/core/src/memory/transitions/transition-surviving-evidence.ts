/**
 * INPUT:  typed surviving replica heads, artifacts, body bytes and paired local coordinates
 * OUTPUT: independently verified immutable evidence access for emergency reconstruction
 * POS:    core/memory/transitions — does not mint or impersonate a healthy native final proof
 */
import { MemorySurvivingBankEvidenceSchema, type MemorySurvivingBankEvidence, type TakiApplicationBodyRef } from "@taki/shared";
import { transitionDocumentHash } from "../../db/memory-transition-document-repo.ts";
import { validateApplicationHead } from "../../db/hindsight-application-replica-heads.ts";
import { requireApplicationArtifactClosure } from "../../db/hindsight-application-replica-evidence.ts";
import { applicationArtifactVersionKey } from "../hindsight/hindsight-application-bundle.ts";
import { decodeHindsightApplicationBody, hindsightApplicationHash, requireApplicationScope,
  withoutApplicationHash } from "../hindsight/hindsight-application-integrity.ts";
import { transitionLocalHash } from "./transition-local-encoding.ts";

export function verifySurvivingBankEvidence(raw: MemorySurvivingBankEvidence) {
  const evidence = MemorySurvivingBankEvidenceSchema.parse(raw); const { evidenceId, ...body } = evidence;
  if (evidenceId !== transitionDocumentHash("surviving_evidence", body)) invalid();
  return verifyReplicaClosure(evidence);
}
/** Full body/artifact closure validation is also required before an offline paired restore starts writers. */
export function verifyReplicaClosure(evidence: Pick<MemorySurvivingBankEvidence,
  "bankId" | "namespace" | "nativeCursor" | "heads" | "artifacts" | "bodies" | "nativeRecords">) {
  const scope = { bankId: evidence.bankId, namespace: evidence.namespace };
  const bodies = new Map(evidence.bodies.map((entry) => [entry.ref.body_id,
    decodeHindsightApplicationBody({ ...scope, ref: entry.ref, bytes: Buffer.from(entry.base64, "base64") })]));
  const artifacts = new Map(evidence.artifacts.map((artifact) => [applicationArtifactVersionKey(artifact), artifact]));
  const heads = evidence.heads;
  if (bodies.size !== evidence.bodies.length || artifacts.size !== evidence.artifacts.length
    || new Set(heads.map((head) => JSON.stringify([head.object_kind, head.object_id]))).size !== heads.length) invalid();
  const reader = { body: (ref: TakiApplicationBodyRef) => {
    const value = bodies.get(ref.body_id);
    if (!value || transitionLocalHash(value.ref) !== transitionLocalHash(ref)) invalid();
    return value;
  },
    artifact: (version: Parameters<typeof applicationArtifactVersionKey>[0]) => artifacts.get(applicationArtifactVersionKey(version)) ?? invalid() };
  for (const artifact of artifacts.values()) {
    requireApplicationScope(artifact, scope);
    if (artifact.record_hash !== hindsightApplicationHash({ ...scope, domain: "record", value: withoutApplicationHash(artifact, "record_hash") })) invalid();
    requireApplicationArtifactClosure(reader, artifact);
  }
  const native = [];
  for (const head of heads) {
    validateApplicationHead(reader, head);
    const cursor = head.version?.native_cursor ?? head.tombstone?.native_cursor;
    if (cursor !== null && cursor !== undefined && cursor > evidence.nativeCursor) invalid();
    if (!head.version) continue;
    const record = head.body_ref ? reader.body(head.body_ref).content : null;
    if (record?.body_schema !== "application-native-record.v1") invalid();
    native.push({ object_kind: head.object_kind, object_id: head.object_id,
      object_revision: head.version.object_revision, payload: record.value.payload });
  }
  if (transitionLocalHash(native) !== transitionLocalHash(evidence.nativeRecords)) invalid();
  const bound = (head: typeof heads[number]) => head.bound_artifact ? reader.artifact(head.bound_artifact) : null;
  const content = (head: typeof heads[number]) => { const artifact = bound(head); return artifact ? reader.body(artifact.body_ref).content : null; };
  return { heads, artifacts, reader, bound, body: content };
}
function invalid(): never { throw new Error("MEMORY_TRANSITION_PROOF_INVALID"); }
