/**
 * INPUT: exact Source artifact plus verified D77 body/artifact dependency reader
 * OUTPUT: original source evidence with its physical-document association independently validated
 * POS: core/memory/hindsight — current alias payload never substitutes for physical document content
 */
import type { TakiApplicationArtifact, TakiApplicationSourceBody } from "@taki/shared";
import type { HindsightApplicationEvidenceReader } from "./hindsight-application-projection.ts";
import { hindsightApplicationHash, sameApplicationValue, type HindsightApplicationScope } from "./hindsight-application-integrity.ts";

export function readHindsightApplicationSourceArtifact(input: HindsightApplicationScope & {
  artifact: TakiApplicationArtifact; evidence: HindsightApplicationEvidenceReader;
}): { source: TakiApplicationSourceBody; evidenceOnly: boolean } {
  const { artifact, evidence } = input;
  const body = evidence.body(artifact.body_ref).content;
  if (artifact.key.artifact_kind !== "source") invalid();
  if (body.body_schema === "application-source.v1") return { source: body.value, evidenceOnly: false };
  if (body.body_schema !== "application-source-evidence.v1" || artifact.binding.kind !== "exact_native"
    || !sameApplicationValue(artifact.binding.native, body.value.associated_native)) invalid();
  const source = evidence.body(body.value.source_ref).content;
  const previous = evidence.artifact(body.value.previous);
  if (source.body_schema !== "application-source.v1" || source.value.original_witness !== null
    || source.value.operation_id !== null || source.value.encoded_metadata !== null
    || !sameApplicationValue(previous.key, artifact.key) || previous.revision >= artifact.revision
    || previous.body_ref.bytes_sha256 !== body.value.previous_body_hash || previous.binding.kind !== "exact_native"
    || previous.binding.native.object_id !== body.value.associated_native.object_id
    || hindsightApplicationHash({ ...input, domain: "transition-source-evidence", value: source.value.original_source }) !== body.value.source_record_hash) invalid();
  return { source: source.value, evidenceOnly: true };
}
function invalid(): never { throw new Error("HINDSIGHT_APPLICATION_SOURCE_BINDING_INVALID"); }
