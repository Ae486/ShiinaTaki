/**
 * INPUT: owned W3 native/application fixture with one original document and memory
 * OUTPUT: two revisions of an appended D77 Source alias and ordered historical Memory references
 * POS: core/testing — synthetic closure fixture; actual uploader/native semantics have separate HTTP tests
 */
import { applicationTestArtifact, applicationTestBody, applicationTestNative, type ApplicationArtifactFixture,
  type ApplicationNativeFixture } from "./hindsight-application-fixtures.ts";
import { applicationTestBind } from "./hindsight-application-runtime-fixtures.ts";
import { randomUUID } from "node:crypto";
import { hindsightApplicationHash } from "../memory/hindsight/hindsight-application-integrity.ts";

export interface TransitionSourceFixtureOptions { retired?: boolean; evidenceOnly?: boolean; stalePhysical?: boolean; conflictingOriginal?: boolean; foreignOriginal?: boolean }
export function addTransitionSourceAliases(input: { native: ApplicationNativeFixture[]; artifacts: ApplicationArtifactFixture[] }, options: TransitionSourceFixtureOptions = {}): void {
  let document = input.native.find((row) => row.head.object_kind === "document")!;
  const original = input.artifacts.find((row) => row.artifact.key.artifact_kind === "source")!;
  const memory = input.artifacts.find((row) => row.artifact.key.artifact_kind === "memory")!;
  if (original.body.content.body_schema !== "application-source.v1" || memory.body.content.body_schema !== "application-memory.v1") throw new Error("fixture input");
  const scope = { bankId: original.artifact.bank_id, namespace: original.artifact.namespace };
  if (options.stalePhysical) {
    if (document.body.content.body_schema !== "application-native-record.v1") throw new Error("fixture document");
    const replacement = applicationTestNative({ scope, kind: "document", revision: 2, cursor: 4,
      payload: document.body.content.value.payload, source: { text: "Newer full native document", context: "native context", metadata: {} } });
    input.native.splice(input.native.indexOf(document), 1, replacement); document = replacement;
  }
  if (options.conflictingOriginal || options.foreignOriginal) input.artifacts.push(applicationTestArtifact({ scope,
    key: { artifact_kind: "source", artifact_id: "conflicting-physical-original" }, binding: original.artifact.binding,
    body: applicationTestBody("application-source.v1", { ...original.body.content.value, original_source: {
      ...original.body.content.value.original_source, retainedText: "Conflicting purported original",
      ...(options.foreignOriginal ? { bankId: "foreign-original-bank" } : {}) } }, scope) }));
  const source = { ...original.body.content.value.original_source, authorityEpochId: "hindsight-provider-epoch", bankId: scope.bankId,
    documentId: document.head.object_id, retainedText: "append fragment one", metadata: { fragment: 1 }, revision: 1 };
  const key = { artifact_kind: "source" as const, artifact_id: "retain:owned-fragment" };
  const versions = [1, 2].map((revision) => applicationTestArtifact({ scope, key, revision,
    binding: { kind: "exact_native", native: document.head.version! }, body: applicationTestBody("application-source.v1",
      { original_source: { ...source, retainedText: revision === 1 ? "append fragment one" : "append fragment two", revision },
        encoded_metadata: null, original_witness: null, operation_id: null }, scope) }));
  const latest = options.evidenceOnly ? sourceEvidenceFixture(versions[1]!, scope) : versions[1]!;
  const refs = [original, versions[0]!, latest, versions[0]!].map(({ artifact }) =>
    ({ key: artifact.key, revision: artifact.revision, record_hash: artifact.record_hash }));
  const replacement = applicationTestArtifact({ scope, key: memory.artifact.key, binding: memory.artifact.binding,
    body: applicationTestBody("application-memory.v1", { ...memory.body.content.value, source_artifacts: refs }, scope) });
  input.artifacts.splice(input.artifacts.indexOf(memory), 1, replacement); input.artifacts.push(...versions);
  if (options.evidenceOnly) input.artifacts.push(latest);
  applicationTestBind(input.native.find((row) => row.head.object_kind === "memory_unit")!, replacement.artifact);
  if (options.retired) input.artifacts.push(applicationTestArtifact({ scope, key, revision: 3, tombstoned: true,
    binding: versions[1]!.artifact.binding, body: versions[1]!.body }));
  else applicationTestBind(document, latest.artifact);
}
function sourceEvidenceFixture(previous: ApplicationArtifactFixture, scope: NonNullable<Parameters<typeof applicationTestArtifact>[0]["scope"]>) {
  if (previous.body.content.body_schema !== "application-source.v1" || previous.artifact.binding.kind !== "exact_native") throw new Error("source fixture");
  const artifact = previous.artifact;
  return applicationTestArtifact({ scope, key: artifact.key, revision: artifact.revision + 1, binding: artifact.binding,
    body: applicationTestBody("application-source-evidence.v1", { source_ref: previous.body.ref,
      source_record_hash: hindsightApplicationHash({ ...scope, domain: "transition-source-evidence", value: previous.body.content.value.original_source }),
      previous: { key: artifact.key, revision: artifact.revision, record_hash: artifact.record_hash }, previous_body_hash: previous.body.ref.bytes_sha256,
      associated_native: previous.artifact.binding.native }, scope) });
}
export function addTransitionAwaitingSource(input: { artifacts: ApplicationArtifactFixture[] }): void {
  const original = input.artifacts.find((row) => row.artifact.key.artifact_kind === "source")!;
  if (original.body.content.body_schema !== "application-source.v1") throw new Error("fixture source");
  const operationId = randomUUID(); const documentId = "never-dispatched-document";
  const scope = { bankId: original.artifact.bank_id, namespace: original.artifact.namespace };
  const source = { ...original.body.content.value.original_source, authorityEpochId: "actual-old-hindsight-epoch", bankId: scope.bankId,
    documentId, retainedText: "Admitted source bytes without confirmed native effects", metadata: { pending: true } };
  input.artifacts.push(applicationTestArtifact({ scope, key: { artifact_kind: "source", artifact_id: `retain:${operationId}` },
    binding: { kind: "awaiting_native", operation_id: operationId, document_id: documentId },
    body: applicationTestBody("application-source.v1", { original_source: source, encoded_metadata: null, original_witness: null, operation_id: operationId }, scope) }));
}
