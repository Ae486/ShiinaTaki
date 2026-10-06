/**
 * INPUT: prepared application changes and the resulting synthetic native identities
 * OUTPUT: exact ordered Source references, original bodies and immutable artifact revisions
 * POS: core/testing — wire-shape fixture for composed Core transition tests
 */
import type { MemoryTransitionPreparation, TakiApplicationArtifactVersion, TakiApplicationArtifactKey } from "@taki/shared";
import { applicationTestArtifact, applicationTestBody, applicationTestMemoryBody,
  type ApplicationNativeFixture, type ApplicationArtifactFixture } from "./hindsight-application-fixtures.ts";
import { applicationTestBind } from "./hindsight-application-runtime-fixtures.ts";
import { hindsightTransitionHash } from "../memory/hindsight/hindsight-transition-proof.ts";

export function applyFixtureArtifactDelta(prepared: MemoryTransitionPreparation, bundle: {
  scope: NonNullable<Parameters<typeof applicationTestArtifact>[0]["scope"]>;
  native: ApplicationNativeFixture[]; artifacts: ApplicationArtifactFixture[];
}) {
  const changed = new Map<string, TakiApplicationArtifactVersion>();
  const currentSource = (key: TakiApplicationArtifactKey): TakiApplicationArtifactVersion => {
    const source = bundle.artifacts.filter((value) => JSON.stringify(value.artifact.key) === JSON.stringify(key))
      .sort((a, b) => b.artifact.revision - a.artifact.revision)[0]?.artifact;
    if (!source) throw new Error("fixture source missing");
    return { key: source.key, revision: source.revision, record_hash: source.record_hash };
  };
  // Resolve Sources before Memories without sorting or deduplicating each Memory's reference list.
  const descriptors = [...prepared.request.application].sort((a, b) => Number(a.key.artifact_kind === "memory") - Number(b.key.artifact_kind === "memory"));
  for (const descriptor of descriptors) {
    if (descriptor.disposition === "reuse") continue;
    const mapping = prepared.request.native.find((row) => row.source.source_id === descriptor.native_source_id);
    const node = bundle.native.find((row) => row.head.object_id === (mapping?.target?.object_id
      ?? `delta-${mapping?.source.source_kind}-${mapping?.source.source_id}`));
    const version = node?.head.version;
    const previous = descriptor.expected_artifact && bundle.artifacts.find((value) =>
      hindsightTransitionHash({ key: value.artifact.key, revision: value.artifact.revision, record_hash: value.artifact.record_hash })
        === hindsightTransitionHash(descriptor.expected_artifact));
    let body;
    if (descriptor.disposition === "retire") body = previous?.body;
    else if (descriptor.body?.artifact_kind === "bank") body = applicationTestBody("application-bank.v1", descriptor.body.body, bundle.scope);
    else if (descriptor.body?.artifact_kind === "source" && version) body = applicationTestBody("application-source.v1", {
      ...descriptor.body.body, original_witness: { source_kind: "document", source_id: version.object_id,
        source_revision: version.object_revision, source_payload_hash: version.payload_hash } }, bundle.scope);
    else if (descriptor.body?.artifact_kind === "source_evidence" && version) body = applicationTestBody("application-source-evidence.v1", {
      source_ref: descriptor.body.body.source_ref, source_record_hash: descriptor.source_record_hash, previous: descriptor.expected_artifact,
      previous_body_hash: descriptor.expected_body_hash, associated_native: version }, bundle.scope);
    else if ((descriptor.body?.artifact_kind === "memory" || descriptor.body?.artifact_kind === "memory_evidence") && version) {
      const input = descriptor.body;
      const refs = input.artifact_kind === "memory" ? input.body.source_artifacts.map(currentSource)
        : input.body.source_artifacts.map((ref) => ref.kind === "existing" ? ref.version : currentSource(ref.key));
      body = applicationTestBody("application-memory.v1", applicationTestMemoryBody(version, { ...input.body,
        source_artifacts: refs, assessment: { state: "not_required", target: version, attempts: 0, next_attempt_at: null,
          last_failure_code: null, prompt_version: null, prompt_hash: null, completed_at: null } }), bundle.scope);
    } else if (descriptor.body?.artifact_kind === "block") body = applicationTestBody("application-block.v1", descriptor.body.body, bundle.scope);
    if (!body) throw new Error(`unsupported fixture artifact ${descriptor.body?.artifact_kind}`);
    const artifact = applicationTestArtifact({ scope: bundle.scope, key: descriptor.key,
      revision: (descriptor.expected_artifact?.revision ?? 0) + 1, body, tombstoned: descriptor.disposition === "retire",
      binding: version ? { kind: "exact_native", native: version } : previous?.artifact.binding ?? { kind: "core_block" } });
    bundle.artifacts.push(artifact);
    if (node && version && descriptor.disposition !== "retire") applicationTestBind(node, artifact.artifact);
    changed.set(JSON.stringify(descriptor.key), { key: descriptor.key, revision: artifact.artifact.revision, record_hash: artifact.artifact.record_hash });
  }
  return changed;
}
