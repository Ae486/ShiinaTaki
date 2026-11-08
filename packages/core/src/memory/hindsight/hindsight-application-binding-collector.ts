/**
 * INPUT:  paired replica state, immutable originals and current Bank/label routing
 * OUTPUT: bounded ordered binding candidates with verified unit contexts for batch label requests
 * POS:    core/memory/hindsight — read-only collection; the runner owns byte packing, durable execution and pull boundaries
 */
import type {
  TakiApplicationArtifact, TakiApplicationArtifactKey, TakiApplicationNativeHead, TakiApplicationNativeRecord,
  TakiApplicationBlockBody, TakiApplicationBodySchema, HindsightTemplateLabelGroup, TakiApplicationNamespace,
} from "@taki/shared";
import type { HindsightApplicationReplicaRepo, HindsightApplicationBindingWork } from "../../db/hindsight-application-replica-contract.ts";
import type { HindsightApplicationBootstrapEvidence, HindsightApplicationBootstrapScope } from "../../db/hindsight-application-bootstrap-evidence.ts";
import type { HindsightClient } from "./hindsight-client.ts";
import type { HindsightApplicationBindingPass } from "./hindsight-application-sync-runner.ts";
import type { HindsightApplicationWriter } from "./hindsight-application-writer.ts";
import { hindsightApplicationBindingBody, hindsightApplicationPolicyContext,
  type HindsightApplicationBindingContext } from "./hindsight-application-binding-context.ts";
import { readHindsightApplicationNative } from "./hindsight-application-projection.ts";
import { proveHindsightAwaitingSource, readHindsightApplicationSourceEvidence } from "./hindsight-application-source-binding.ts";
import { sameApplicationValue } from "./hindsight-application-integrity.ts";
import type { VerifiedHindsightPolicyContext } from "./hindsight-policy-context.ts";
import type { HindsightTrustedUnitLabel } from "./hindsight-application-policy.ts";

export const HINDSIGHT_BINDING_BATCH_SIZE = 8;
export interface HindsightApplicationBindingDependencies {
  repo: HindsightApplicationReplicaRepo; writer: HindsightApplicationWriter; client: HindsightClient;
  bootstrap(scope: HindsightApplicationBootstrapScope): HindsightApplicationBootstrapEvidence | undefined;
  blocks?: (scope: HindsightApplicationBootstrapScope) => TakiApplicationBlockBody[];
  templateLabelGroup?: (input: { bankId: string; namespace: TakiApplicationNamespace }) => HindsightTemplateLabelGroup | null;
}
export interface HindsightApplicationBindingCollection extends HindsightApplicationBindingContext {
  input: HindsightApplicationBindingPass; deps: HindsightApplicationBindingDependencies;
}
export interface HindsightApplicationBindingCandidate {
  key: TakiApplicationArtifactKey; prior: TakiApplicationArtifact | null; native: TakiApplicationNativeRecord | null;
  purpose: "bind-native" | "bind-retained-source" | "preserve-block";
  labelContext?: VerifiedHindsightPolicyContext;
  body(at: string, label?: HindsightTrustedUnitLabel): { schema: TakiApplicationBodySchema; value: unknown };
}
type Context = HindsightApplicationBindingCollection;
type Candidate = HindsightApplicationBindingCandidate;

export async function* collectHindsightApplicationBindings(context: Context, bank: TakiApplicationNativeHead) {
  if (needsBinding(bank)) yield [bindHead(context, bank)];
  yield* batches(bindAwaitingSources(context));
  yield* batches(preserveBlocks(context));
  // Sources must reach the verified replica before dependent Memory bodies
  // freeze their exact source-artifact references.
  yield* batches(bindKind(context, "document"));
  yield* batches(bindKind(context, "memory_unit"));
}

async function* batches(candidates: Iterable<Candidate> | AsyncIterable<Candidate>) {
  let batch: Candidate[] = [];
  for await (const candidate of candidates) {
    batch.push(candidate);
    if (batch.length === HINDSIGHT_BINDING_BATCH_SIZE) { yield batch; batch = []; }
  }
  if (batch.length) yield batch;
}

function* bindKind(context: Context, objectKind: "document" | "memory_unit"): Generator<Candidate> {
  let after: HindsightApplicationBindingWork["cursor"] | undefined;
  for (;;) {
    const work = context.repo.bindingWork({ ...context, objectKind, limit: HINDSIGHT_BINDING_BATCH_SIZE, after });
    if (work.length === 0) return;
    for (const item of work) {
      context.input.request(); after = item.cursor;
      if (!needsBinding(item.head) || !item.head.version || item.head.object_kind !== objectKind) continue;
      const native = readHindsightApplicationNative({ ...context, head: item.head });
      if (native.version.object_kind === "memory_unit" && "state" in native.payload && native.payload.state === "invalidated"
        && item.artifact === null && !context.original?.memories.has(item.head.object_id)) continue;
      yield bindHead(context, item.head);
    }
  }
}

function bindHead(context: Context, head: TakiApplicationNativeHead): Candidate {
  const native = readHindsightApplicationNative({ ...context, head });
  const prior = head.bound_artifact ? context.evidence.artifact(head.bound_artifact) : null;
  const kind = head.object_kind === "bank" ? "bank" : head.object_kind === "document" ? "source" : "memory";
  if (!["bank", "document", "memory_unit"].includes(head.object_kind)) throw new Error("HINDSIGHT_APPLICATION_BINDING_EVIDENCE_INVALID");
  const key: TakiApplicationArtifactKey = prior?.key ?? { artifact_kind: kind, artifact_id: head.object_id };
  const latest = context.repo.latestArtifact({ ...context, key });
  if (!sameApplicationValue(latest ?? null, prior)) throw new Error("HINDSIGHT_APPLICATION_BINDING_EVIDENCE_INVALID");
  return { key, prior, native, purpose: "bind-native",
    labelContext: !prior && kind === "memory" && !context.original?.memories.has(head.object_id)
      ? hindsightApplicationPolicyContext(context, native) : undefined,
    body: (at, label) => hindsightApplicationBindingBody(context, { native, head, prior, at, label }) };
}

async function* bindAwaitingSources(context: Context): AsyncGenerator<Candidate> {
  for (const artifact of context.repo.sourceArtifacts({ ...context, bindingKind: "awaiting_native" })) {
    if (artifact.binding.kind !== "awaiting_native") continue;
    const head = context.repo.nativeHead({ ...context, objectKind: "document", objectId: artifact.binding.document_id });
    if (!head?.version || head.binding_state === "tombstoned") continue;
    const native = readHindsightApplicationNative({ ...context, head });
    const source = context.evidence.body(artifact.body_ref).content;
    if (source.body_schema !== "application-source.v1") throw new Error("HINDSIGHT_APPLICATION_SOURCE_BINDING_INVALID");
    const body = await proveHindsightAwaitingSource({ ...context, client: context.deps.client, artifact, source: source.value,
      native, evidence: readHindsightApplicationSourceEvidence({ ...context, native }), request: context.input.request });
    if (!body) continue;
    yield { key: artifact.key, prior: artifact, native, purpose: "bind-retained-source",
      body: () => ({ schema: "application-source.v1", value: body }) };
  }
}

function* preserveBlocks(context: Context): Generator<Candidate> {
  const existing = context.repo.blockArtifacts(context);
  const blocks = context.deps.blocks?.(context) ?? context.original?.blocks ?? [];
  for (const block of blocks) {
    if (!sameApplicationValue(block.scope, context.bankScope)) throw new Error("HINDSIGHT_APPLICATION_BLOCK_BINDING_INVALID");
    const prior = existing.find((artifact) => {
      const body = context.evidence.body(artifact.body_ref).content;
      if (body.body_schema !== "application-block.v1") throw new Error("HINDSIGHT_APPLICATION_BLOCK_BINDING_INVALID");
      return body.value.block_id === block.block_id && sameApplicationValue(body.value.scope, block.scope);
    });
    if (prior) {
      const body = context.evidence.body(prior.body_ref).content;
      if (body.body_schema !== "application-block.v1") throw new Error("HINDSIGHT_APPLICATION_BLOCK_BINDING_INVALID");
      if (block.block_revision < body.value.block_revision) continue;
      if (block.block_revision === body.value.block_revision) {
        if (!sameApplicationValue(block, body.value)) throw new Error("HINDSIGHT_APPLICATION_BLOCK_BINDING_INVALID");
        continue;
      }
    }
    // Preserve the real revision and writer after restoring newer remote revisions.
    yield { key: prior?.key ?? { artifact_kind: "block", artifact_id: block.block_id }, prior: prior ?? null, native: null,
      purpose: "preserve-block", body: () => ({ schema: "application-block.v1", value: block }) };
  }
}

function needsBinding(head: TakiApplicationNativeHead): boolean {
  return head.binding_state === "binding_missing" || head.binding_state === "rebind_required";
}
