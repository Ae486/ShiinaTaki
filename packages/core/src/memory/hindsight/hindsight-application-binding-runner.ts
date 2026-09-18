/**
 * INPUT:  paired replica state, immutable original evidence and durable application command execution
 * OUTPUT: first policy, source association, exact rebinding and Core Block preservation without model work
 * POS:    core/memory/hindsight — deterministic binding pass between complete pulls; model assessment remains an independent curator
 */
import { createHash } from "node:crypto";
import {
  hindsightApplicationTaggedJson, MemoryBankScopeSchema, type TakiApplicationArtifact, type TakiApplicationArtifactKey,
  type TakiApplicationNativeHead, type TakiApplicationNativeRecord, type TakiApplicationBlockBody,
  type TakiApplicationCommand, type TakiApplicationBodySchema,
} from "@taki/shared";
import type { HindsightApplicationReplicaRepo, HindsightApplicationBindingWork } from "../../db/hindsight-application-replica-contract.ts";
import type { HindsightApplicationBootstrapEvidence, HindsightApplicationBootstrapScope } from "../../db/hindsight-application-bootstrap-evidence.ts";
import type { HindsightClient } from "./hindsight-client.ts";
import { HindsightApplicationRefusal } from "./hindsight-application-client.ts";
import type { HindsightApplicationBindingPass } from "./hindsight-application-sync-runner.ts";
import type { HindsightApplicationWriter } from "./hindsight-application-writer.ts";
import { prepareHindsightApplicationBody } from "./hindsight-application-body-transfer.ts";
import { hindsightApplicationArtifactVersion, hindsightApplicationBindingBody, hindsightApplicationEvidenceReader,
  type HindsightApplicationBindingContext } from "./hindsight-application-binding-context.ts";
import { projectHindsightApplicationNativeBank, readHindsightApplicationNative } from "./hindsight-application-projection.ts";
import { proveHindsightAwaitingSource, readHindsightApplicationSourceEvidence } from "./hindsight-application-source-binding.ts";
import { sameApplicationValue } from "./hindsight-application-integrity.ts";
import { hindsightError } from "./hindsight-errors.ts";

interface Dependencies {
  repo: HindsightApplicationReplicaRepo; writer: HindsightApplicationWriter; client: HindsightClient;
  bootstrap(scope: HindsightApplicationBootstrapScope): HindsightApplicationBootstrapEvidence | undefined;
  blocks?: (scope: HindsightApplicationBootstrapScope) => TakiApplicationBlockBody[];
}
interface Context extends HindsightApplicationBindingContext { input: HindsightApplicationBindingPass; deps: Dependencies }
interface ArtifactWork {
  key: TakiApplicationArtifactKey; prior: TakiApplicationArtifact | null; native: TakiApplicationNativeRecord | null;
  purpose: "bind-native" | "bind-retained-source" | "preserve-block";
  body(at: string): { schema: TakiApplicationBodySchema; value: unknown };
}

export function createHindsightApplicationBindingRunner(deps: Dependencies) {
  const originals = new Map<string, HindsightApplicationBootstrapEvidence | undefined>();
  return async (input: HindsightApplicationBindingPass): Promise<boolean> => {
    input.request();
    const evidence = hindsightApplicationEvidenceReader(deps.repo, input);
    const head = deps.repo.nativeHead({ ...input, objectKind: "bank", objectId: input.bankId });
    if (!head?.version || head.binding_state === "tombstoned") throw new Error("HINDSIGHT_APPLICATION_BANK_UNAVAILABLE");
    const native = readHindsightApplicationNative({ ...input, head, evidence });
    const bankScope = MemoryBankScopeSchema.parse({ kind: input.bank.scope, characterId: input.bank.characterId });
    const key = JSON.stringify([input.authorityEpochId, input.bankId, input.namespace]);
    if (!originals.has(key)) originals.set(key, deps.bootstrap({ ...input, bankScope }));
    const context: Context = { ...input, input, deps, repo: deps.repo, bankScope, evidence, original: originals.get(key),
      bank: projectHindsightApplicationNativeBank({ ...input, native, bankScope }) };
    if (needsBinding(head)) return bindHead(context, head);
    if (await bindAwaitingSources(context)) return true;
    if (await preserveBlocks(context)) return true;
    return bindRemaining(context);
  };
}

async function bindRemaining(context: Context): Promise<boolean> {
  // Sources must reach the verified replica before dependent memory bodies
  // freeze their exact source-artifact references.
  for (const objectKind of ["document", "memory_unit"] as const) {
    if (await bindKind(context, objectKind)) return true;
  }
  return false;
}

async function bindKind(context: Context, objectKind: "document" | "memory_unit"): Promise<boolean> {
  let after: HindsightApplicationBindingWork["cursor"] | undefined;
  for (;;) {
    // This pass commits one exact binding before pulling its event. Select only
    // that kind and one candidate, rather than validating every unbound Memory
    // while asking whether any Source still needs work.
    const work = context.repo.bindingWork({ ...context, objectKind, limit: 1, after });
    if (work.length === 0) return false;
    for (const item of work) {
      context.input.request(); after = item.cursor;
      if (!needsBinding(item.head) || !item.head.version || item.head.object_kind !== objectKind) continue;
      const native = readHindsightApplicationNative({ ...context, head: item.head });
      if (native.version.object_kind === "memory_unit" && "state" in native.payload && native.payload.state === "invalidated"
        && item.artifact === null && !context.original?.memories.has(item.head.object_id)) continue;
      if (await bindHead(context, item.head)) return true;
    }
  }
}

async function bindHead(context: Context, head: TakiApplicationNativeHead): Promise<boolean> {
  const native = readHindsightApplicationNative({ ...context, head });
  const prior = head.bound_artifact ? context.evidence.artifact(head.bound_artifact) : null;
  const kind = head.object_kind === "bank" ? "bank" : head.object_kind === "document" ? "source" : "memory";
  if (!["bank", "document", "memory_unit"].includes(head.object_kind)) throw new Error("HINDSIGHT_APPLICATION_BINDING_EVIDENCE_INVALID");
  const key: TakiApplicationArtifactKey = prior?.key ?? { artifact_kind: kind, artifact_id: head.object_id };
  const latest = context.repo.latestArtifact({ ...context, key });
  if (!sameApplicationValue(latest ?? null, prior)) throw new Error("HINDSIGHT_APPLICATION_BINDING_EVIDENCE_INVALID");
  return commit(context, { key, prior, native, purpose: "bind-native",
    body: (at) => hindsightApplicationBindingBody(context, { native, head, prior, at }) });
}

async function bindAwaitingSources(context: Context): Promise<boolean> {
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
    if (await commit(context, { key: artifact.key, prior: artifact, native, purpose: "bind-retained-source",
      body: () => ({ schema: "application-source.v1", value: body }) })) return true;
  }
  return false;
}

async function preserveBlocks(context: Context): Promise<boolean> {
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
    // Core Block edits are published with the real revision and original writer.
    // A received snapshot already restores newer remote revisions before this pass.
    if (await commit(context, { key: prior?.key ?? { artifact_kind: "block", artifact_id: block.block_id }, prior: prior ?? null, native: null,
      purpose: "preserve-block", body: () => ({ schema: "application-block.v1", value: block }) })) return true;
  }
  return false;
}

async function commit(context: Context, work: ArtifactWork): Promise<boolean> {
  const expected = work.prior ? hindsightApplicationArtifactVersion(work.prior) : null;
  const intent = { purpose: work.purpose, artifact: work.key, expected_artifact: expected, expected_native: work.native?.version ?? null };
  const digest = createHash("sha256").update(hindsightApplicationTaggedJson({ domain: "taki-core-binding-intent.v1", intent })).digest("hex");
  const job = context.deps.writer.prepare({ namespace: context.namespace,
    key: { authorityEpochId: context.authorityEpochId, bankId: context.bankId, requestId: `binding:${digest}` }, intent,
    create: (at) => {
      const value = work.body(at); const body = prepareHindsightApplicationBody({ ...context, ...value });
      const actor = { kind: work.purpose === "preserve-block" ? "restore" as const : "background" as const, actor_ref: "taki-application-binding" };
      const command: TakiApplicationCommand = work.prior && work.native ? { command: "rebind_artifact", key: work.key,
        expected_artifact: hindsightApplicationArtifactVersion(work.prior), expected_native: work.native.version, body_ref: body.ref, actor }
        : { command: "put_artifact", key: work.key, expected_artifact: expected, expected_native: work.native?.version ?? null,
          body_ref: body.ref, binding: work.native ? { kind: "exact_native", native: work.native.version } : { kind: "core_block" }, actor };
      return { commands: [command], bodies: [body] };
    } });
  context.input.request();
  const result = await context.deps.writer.run({ key: job.key, context: context.input.request() });
  context.input.request();
  if (result.status === "pending") throw hindsightError(result.code);
  if (result.status === "refused") {
    if (!result.job.receipt?.refusal) throw new Error("MEMORY_INTEGRITY_ERROR");
    throw new HindsightApplicationRefusal(result.job.receipt.refusal);
  }
  return !context.deps.writer.applied(result.job);
}

function needsBinding(head: TakiApplicationNativeHead): boolean {
  return head.binding_state === "binding_missing" || head.binding_state === "rebind_required";
}
