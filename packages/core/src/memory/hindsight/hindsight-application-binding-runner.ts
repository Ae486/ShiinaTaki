/**
 * INPUT:  paired replica state, eligible binding stages and durable original application jobs
 * OUTPUT: atomic eight-command/direct-closure-limited batches, one label request per pack and original-job recovery
 * POS:    core/memory/hindsight — commits between complete pulls; selection/evidence errors never dispatch a partial batch
 */
import { createHash } from "node:crypto";
import { HINDSIGHT_APPLICATION_UPLOAD_BYTES, hindsightApplicationTaggedJson, MemoryBankScopeSchema,
  type TakiApplicationCommand } from "@taki/shared";
import type { HindsightApplicationBootstrapEvidence } from "../../db/hindsight-application-bootstrap-evidence.ts";
import type { HindsightApplicationCommandJob } from "../../db/hindsight-application-command-contract.ts";
import { HindsightApplicationRefusal } from "./hindsight-application-client.ts";
import type { HindsightApplicationBindingPass } from "./hindsight-application-sync-runner.ts";
import { prepareHindsightApplicationBody } from "./hindsight-application-body-transfer.ts";
import { hindsightApplicationArtifactVersion, hindsightApplicationEvidenceReader } from "./hindsight-application-binding-context.ts";
import { projectHindsightApplicationNativeBank, readHindsightApplicationNative } from "./hindsight-application-projection.ts";
import { sameApplicationValue, type HindsightApplicationBody } from "./hindsight-application-integrity.ts";
import { hindsightError } from "./hindsight-errors.ts";
import { loadHindsightTemplateUnitLabels } from "./hindsight-template-label-evidence.ts";
import { collectHindsightApplicationBindings, type HindsightApplicationBindingDependencies as Dependencies,
  type HindsightApplicationBindingCollection as Context, type HindsightApplicationBindingCandidate as Candidate,
} from "./hindsight-application-binding-collector.ts";

interface Batch { commands: TakiApplicationCommand[]; bodies: HindsightApplicationBody[]; members: Candidate[] }

export function createHindsightApplicationBindingRunner(deps: Dependencies) {
  const originals = new Map<string, HindsightApplicationBootstrapEvidence | undefined>();
  return async (input: HindsightApplicationBindingPass): Promise<boolean> => {
    input.request();
    // The first pull may already have published a lost-ACK command. Recover its
    // original receipt before inspecting candidates, then keep looking if applied.
    for (let job = deps.writer.unfinishedBinding(input); job; job = deps.writer.unfinishedBinding(input)) {
      if (await run(deps.writer, input, job)) return true;
    }
    const evidence = hindsightApplicationEvidenceReader(deps.repo, input);
    const head = deps.repo.nativeHead({ ...input, objectKind: "bank", objectId: input.bankId });
    if (!head?.version || head.binding_state === "tombstoned") throw new Error("HINDSIGHT_APPLICATION_BANK_UNAVAILABLE");
    const native = readHindsightApplicationNative({ ...input, head, evidence });
    const bankScope = MemoryBankScopeSchema.parse({ kind: input.bank.scope, characterId: input.bank.characterId });
    const key = JSON.stringify([input.authorityEpochId, input.bankId, input.namespace]);
    if (!originals.has(key)) originals.set(key, deps.bootstrap({ ...input, bankScope }));
    const context: Context = { ...input, input, deps, repo: deps.repo, bankScope, evidence, original: originals.get(key),
      bank: projectHindsightApplicationNativeBank({ ...input, native, bankScope }) };
    for await (const candidates of collectHindsightApplicationBindings(context, head)) {
      if (await commit(context, candidates)) return true;
    }
    return false;
  };
}

async function commit(context: Context, candidates: Candidate[]): Promise<boolean> {
  while (candidates.length) {
    context.input.request();
    // A completed byte-limited prefix may still await publication. Check its
    // original intent before labels; singleton keys retain the historical format.
    const saved = savedPrefix(context, candidates);
    if (saved) {
      if (await run(context.deps.writer, context.input, saved.job)) return true;
      candidates = candidates.slice(saved.count);
      continue;
    }
    const batch = await pack(context, candidates);
    const identity = batchIdentity(context, batch.members);
    context.input.request();
    const job = context.deps.writer.prepare({ ...identity, namespace: context.namespace, create: () => batch });
    if (await run(context.deps.writer, context.input, job)) return true;
    candidates = candidates.slice(batch.members.length);
  }
  return false;
}

function savedPrefix(context: Context, candidates: Candidate[]) {
  for (let count = candidates.length; count > 0; count--) {
    const job = context.deps.writer.get(batchIdentity(context, candidates.slice(0, count)).key);
    if (job) return { job, count };
  }
  return undefined;
}

function memberIntent(work: Candidate) {
  return { purpose: work.purpose, artifact: work.key,
    expected_artifact: work.prior ? hindsightApplicationArtifactVersion(work.prior) : null,
    expected_native: work.native?.version ?? null };
}

function batchIdentity(context: Context, members: Candidate[]) {
  const intents = members.map(memberIntent);
  const intent = intents.length === 1 ? intents[0] : { purpose: "bind-batch", members: intents };
  if (!intent) throw new Error("MEMORY_INVALID_REQUEST");
  const digest = createHash("sha256").update(hindsightApplicationTaggedJson({ domain: "taki-core-binding-intent.v1", intent })).digest("hex");
  return { intent, key: { authorityEpochId: context.authorityEpochId, bankId: context.bankId, requestId: `binding:${digest}` } };
}

async function pack(context: Context, candidates: Candidate[]): Promise<Batch> {
  const batch: Batch = { commands: [], bodies: [], members: [] };
  const at = context.deps.writer.now();
  const contexts = candidates.flatMap((work) => work.labelContext ? [work.labelContext] : []);
  const hasLabels = contexts.length > 0;
  const group = hasLabels ? structuredClone(context.deps.templateLabelGroup?.(context) ?? null) : null;
  const labels = await loadHindsightTemplateUnitLabels({ client: context.deps.client, contexts,
    group: () => context.deps.templateLabelGroup?.(context) ?? null, request: context.input.request });
  for (const work of candidates) {
    context.input.request();
    const label = work.labelContext ? labels.get(work.labelContext.native.native.object_id) : undefined;
    if (hasLabels && !sameApplicationValue(group, context.deps.templateLabelGroup?.(context) ?? null)) throw new Error("MEMORY_TEMPLATE_IDENTITY_CHANGED");
    try {
      const body = prepareHindsightApplicationBody({ ...context, ...work.body(at, label) });
      const command = bindingCommand(work, body);
      const commands = prepareHindsightApplicationBody({ ...context, schema: "application-commands.v1",
        value: { commands: [...batch.commands, command] } });
      const closure = new Map([...batch.bodies, body, commands].map((entry) => [entry.ref.body_id, entry]));
      if ([...closure.values()].reduce((total, entry) => total + entry.bytes.byteLength, 0) > HINDSIGHT_APPLICATION_UPLOAD_BYTES) {
        throw new Error("HINDSIGHT_APPLICATION_PAYLOAD_TOO_LARGE");
      }
      batch.commands.push(command); batch.bodies.push(body); batch.members.push(work);
    } catch (error) {
      if (!(error instanceof Error) || error.message !== "HINDSIGHT_APPLICATION_PAYLOAD_TOO_LARGE" || batch.members.length === 0) throw error;
      break;
    }
  }
  return batch;
}

function bindingCommand(work: Candidate, body: HindsightApplicationBody): TakiApplicationCommand {
  const expected = work.prior ? hindsightApplicationArtifactVersion(work.prior) : null;
  const actor = { kind: work.purpose === "preserve-block" ? "restore" as const : "background" as const, actor_ref: "taki-application-binding" };
  return work.prior && work.native ? { command: "rebind_artifact", key: work.key,
    expected_artifact: hindsightApplicationArtifactVersion(work.prior), expected_native: work.native.version, body_ref: body.ref, actor }
    : { command: "put_artifact", key: work.key, expected_artifact: expected, expected_native: work.native?.version ?? null,
      body_ref: body.ref, binding: work.native ? { kind: "exact_native", native: work.native.version } : { kind: "core_block" }, actor };
}

async function run(writer: Dependencies["writer"], input: HindsightApplicationBindingPass, job: HindsightApplicationCommandJob): Promise<boolean> {
  const result = await writer.run({ key: job.key, context: input.request() });
  if (result.status === "pending") throw hindsightError(result.code);
  if (result.status === "refused") {
    if (!result.job.receipt?.refusal) throw new Error("MEMORY_INTEGRITY_ERROR");
    throw new HindsightApplicationRefusal(result.job.receipt.refusal);
  }
  // A failed write owns its result. Only successful continuation needs a fresh publication guard.
  input.request();
  return !writer.applied(result.job);
}
