/**
 * INPUT:  Local canonical repositories, active authority, Character scope, blocks and captured retention policy
 * OUTPUT: revision-frozen T5 report view and private canonical maintenance tools
 * POS:    core/memory — Local tidy adapter; all mutations remain authority/CAS fenced and transactional
 */
import { randomUUID } from "node:crypto";
import { tool, type ToolSet } from "ai";
import { z } from "zod";
import { TakiMemoryPolicyProjectionSchema } from "@taki/shared";
import type { CanonicalMaintenanceResult } from "../db/canonical-memory-maintenance-contract.ts";
import { stableRequestHash } from "../db/canonical-memory-repo.ts";
import { V1_BLOCKS } from "./block-registry.ts";
import { canonicalMemoryRow } from "./canonical-memory-view.ts";
import { getLayer, WRITABLE_LAYER_IDS } from "./layer-registry.ts";
import { canonicalLayerRetention } from "./canonical-layer-policy.ts";
import type { TidyEngineView, TidyReviewOptions } from "./memory-engine.ts";
import { createTidyIssueLedger, TidyFinishSchema } from "./tidy-issues.ts";
import { guardedTidy as guarded, tidyTarget as target, tidyBlockScope as blockScope, tidyReviewOutcome,
  reviewReference, tidyReviewReminder, finishTidyReview, type CanonicalTidyInput as TidyInput,
  type CanonicalTidyReview as Review, type TidyToolOutput as ToolOutput } from "./canonical-tidy-review.ts";
import { FINISH_TOOL_NAME } from "./tidy-tools.ts";

const RowInput = z.object({ id: z.string().min(1).max(8192) });
const Layer = z.enum(WRITABLE_LAYER_IDS as [string, ...string[]]);
const BackgroundBlock = z.enum(V1_BLOCKS.filter((block) => block.writer === "background").map((block) => block.id) as [string, ...string[]]);
const Disclosure = TakiMemoryPolicyProjectionSchema.shape.disclosure.unwrap();
const Replacement = z.object({ layer: Layer, content: z.string().min(1).max(100_000), importance: z.int().min(1).max(10), disclosure: Disclosure.optional() });
type ReplacementInput = z.infer<typeof Replacement>;

export function createCanonicalLocalTidyView(input: TidyInput): TidyEngineView {
  const capture = (characterId: string, options?: TidyReviewOptions) => captureReview(input, characterId, options);
  return {
    captureReview: capture,
    listActive: (characterId) => capture(characterId).listActive(characterId),
    countSince: (characterId, since) => capture(characterId).listActive(characterId)
      .filter((row) => (row.updatedAt ?? row.createdAt) > (since ?? "")).length,
    readBlock: (ref) => input.blocks.read(ref.id, blockScope(ref.id, ref.characterId))?.content,
    blockRevisions: (characterId) => V1_BLOCKS.filter((block) => block.ownership === "global" || characterId !== undefined).map((block) => ({
      blockId: block.id, revision: input.blocks.read(block.id, blockScope(block.id, characterId))?.revision ?? 0,
    })),
    createTools: (characterId) => capture(characterId).createTools(characterId),
  };
}

function captureReview(input: TidyInput, characterId: string, options: TidyReviewOptions = {}): TidyEngineView {
  options = { ...options };
  input.authority.activeEpoch(input.epochId);
  const banks = input.authority.listBanks(input.epochId).filter((bank) => bank.scope.kind === "global" || bank.scope.characterId === characterId);
  const scopes = new Map(banks.map((bank) => [bank.bankId, bank.scope.characterId]));
  // Hidden evidence can preserve another Character's support graph. Feeding it
  // to the model would bypass both foreground visibility and ownership policy.
  const rows = input.repo.list({ epochId: input.epochId, characterId })
    .filter((record) => record.policy.visibility !== "hidden")
    .map((record) => canonicalMemoryRow(record, scopes.get(record.unit.bankId) ?? null));
  const review: Review = { input, characterId, passId: randomUUID(), at: input.now?.() ?? new Date().toISOString(),
    rows, references: new Set(rows.map((row) => row.id)), results: new Set(), handles: new Map(), options,
    blocks: new Map(V1_BLOCKS.map((block) => [block.id, input.blocks.read(block.id, blockScope(block.id, characterId))])),
    bankIds: { global: banks.find((bank) => bank.scope.kind === "global")?.bankId,
      character: banks.find((bank) => bank.scope.kind === "character")?.bankId },
    finished: false, edits: 0, issues: createTidyIssueLedger(), receipts: new Map() };
  const requireCharacter = (id: string) => { if (id !== characterId) throw new Error("MEMORY_INVALID_REQUEST"); };
  return {
    listActive: (id) => { requireCharacter(id); return review.rows.map((row) => ({ ...row })); },
    countSince: (id, since) => { requireCharacter(id); return review.rows.filter((row) => (row.updatedAt ?? row.createdAt) > (since ?? "")).length; },
    readBlock: (ref) => ref.characterId !== undefined && ref.characterId !== characterId ? undefined : review.blocks.get(ref.id)?.content,
    createTools: (id) => { requireCharacter(id); return reviewTools(review); },
    reviewHealthy: () => tidyReviewOutcome(review).issueCount === 0,
    reviewOutcome: () => tidyReviewOutcome(review),
    recordIssue: (issue) => { review.issues.reject(issue); review.finished = false; },
    reviewReminder: () => tidyReviewReminder(review),
    reviewBlocked: () => review.issues.blocked(),
    renderReference: (id) => reviewReference(review, id),
    setVisibleReferences: (ids) => { review.references = new Set(ids); },
    resultingReferences: () => [...review.results],
    blockRevisions: () => [...review.blocks].map(([blockId, block]) => ({ blockId, revision: block?.revision ?? 0 })),
  };
}

function reviewTools(review: Review): ToolSet {
  return {
    ...rowTools(review),
    memory_archive_supersede: tool({
      description: "Reversibly archive a memory, optionally replacing it with a corrected fact. The original source remains preserved. Use the returned id reference for later edits.",
      inputSchema: RowInput.extend({ replacement: Replacement.optional() }),
      execute: (args, options) => guarded(review, { tool: "supersede", callId: options.toolCallId, args }, (requestId) => supersede(review, { ...args, requestId })),
    }),
    block_rethink: tool({
      description: "Replace one background-owned memory block in full. Preserve everything that should survive. The user-owned identity card cannot be changed. A concurrent edit is refused.",
      inputSchema: z.object({ id: BackgroundBlock, content: z.string().min(1).max(100_000) }),
      execute: (args, options) => guarded(review, { tool: "block", callId: options.toolCallId, args }, () => rethinkBlock(review, args)),
    }),
    [FINISH_TOOL_NAME]: tool({ description: "Finish this visible batch after useful edits are complete. Explicitly acknowledge unresolved no-write calls with resolutions; correctedBy must name a later successful callId. Unknown failures cannot be dismissed.",
      inputSchema: TidyFinishSchema, execute: (args, options) => guarded(review, { tool: "finish", callId: options.toolCallId, args }, () => finishTidyReview(review, args)) }),
  };
}

function rowTools(review: Review): ToolSet {
  return {
    memory_reinforce: tool({
      description: "Confirm that this memory is still current. Refresh recency and proof count without changing content or importance. Use the returned reference for later edits.",
      inputSchema: RowInput,
      execute: (args, options) => guarded(review, { tool: "reinforce", callId: options.toolCallId, args }, (requestId) =>
        referenceResult(review.input.repo.reinforce({ ...target(review, args.id, requestId), mode: "tidy" }))),
    }),
    memory_set_disclosure: tool({
      description: "Replace the recall trigger while preserving the memory's content. Phrase it the way the user would ask the question.",
      inputSchema: RowInput.extend({ disclosure: Disclosure.min(1) }),
      execute: (args, options) => guarded(review, { tool: "disclosure", callId: options.toolCallId, args }, (requestId) =>
        referenceResult(review.input.repo.policyEdit({ ...target(review, args.id, requestId), patch: { disclosure: args.disclosure } }))),
    }),
    memory_refile: tool({
      description: "Correct a memory's layer. Moving between Global and Character Banks copies its source/fact provenance and reversibly invalidates the original; use the new returned reference.",
      inputSchema: RowInput.extend({ layer: Layer }),
      execute: (args, options) => guarded(review, { tool: "refile", callId: options.toolCallId, args }, (requestId) => refile(review, { ...args, requestId })),
    }),
  };
}

function destination(review: Review, layerId: string) {
  const layer = getLayer(layerId);
  if (!layer || !WRITABLE_LAYER_IDS.includes(layer.id)) throw new Error("MEMORY_INVALID_REQUEST");
  const bankId = layer.ownership === "global" ? review.bankIds.global : review.bankIds.character;
  if (!bankId) throw new Error("MEMORY_NOT_FOUND");
  return { bankId, layer };
}

function refile(review: Review, input: { id: string; layer: string; requestId: string }): ToolOutput {
  const common = target(review, input.id, input.requestId);
  const to = destination(review, input.layer);
  const current = review.input.repo.record(common);
  if (!current) throw new Error("MEMORY_NOT_FOUND");
  const policy = { layerId: to.layer.id, visibility: to.layer.recallPolicy,
    retention: canonicalLayerRetention({ layer: to.layer, previous: current.policy.retention, at: review.at,
      intentionsDefaultDays: review.options.intentionsDefaultDays }) };
  const changed = common.bankId === to.bankId
    ? review.input.repo.policyEdit({ ...common, patch: policy })
    : review.input.repo.copyToBank({ ...common, destinationBankId: to.bankId, policy });
  return referenceResult(changed);
}

function supersede(review: Review, input: { id: string; replacement?: ReplacementInput; requestId: string }): ToolOutput {
  const common = target(review, input.id, input.requestId);
  if (!input.replacement) return referenceResult(review.input.repo.invalidate({ ...common, reason: "tidy" }));
  const replacement = input.replacement;
  const to = destination(review, replacement.layer);
  return review.input.repo.transaction(() => {
    const current = review.input.repo.record(common);
    if (!current) throw new Error("MEMORY_NOT_FOUND");
    const copied = review.input.repo.copyToBank({ ...common, destinationBankId: to.bankId,
      policy: { layerId: to.layer.id, visibility: to.layer.recallPolicy, retention: canonicalLayerRetention({ layer: to.layer,
        previous: current.policy.retention, at: review.at, intentionsDefaultDays: review.options.intentionsDefaultDays }) } });
    const patch = { text: replacement.content };
    const edited = review.input.records.edit({ epochId: common.epochId, bankId: to.bankId,
      memoryId: copied.record.unit.memoryId, expectedRevision: copied.record.unit.revision, requestId: `${input.requestId}:text`,
      requestHash: stableRequestHash(patch), now: review.at, patch,
      searchTerms: review.input.tokenizer.tokenize([replacement.content, copied.record.unit.context, copied.record.policy.disclosure].filter(Boolean).join(" ")).join(" ") });
    const updated = review.input.repo.policyEdit({ ...common, bankId: to.bankId, memoryId: edited.record.unit.memoryId,
      expectedRevision: edited.record.unit.revision, requestId: `${input.requestId}:policy`,
      patch: { importance: replacement.importance, disclosure: replacement.disclosure ?? copied.record.policy.disclosure } });
    return { ...referenceResult(updated), archived: input.id };
  });
}

function rethinkBlock(review: Review, input: { id: string; content: string }): ToolOutput {
  const current = review.input.blocks.read(input.id, blockScope(input.id, review.characterId));
  if (current?.content === input.content) {
    if (current.revision !== (review.blocks.get(input.id)?.revision ?? 0)) throw new Error("MEMORY_REVISION_MISMATCH");
    return { ok: true, applied: false, id: current.blockId, revision: current.revision };
  }
  const block = review.input.blocks.replace({ blockId: input.id, scope: blockScope(input.id, review.characterId),
    expectedRevision: review.blocks.get(input.id)?.revision ?? 0, actor: "background", content: input.content, now: review.at,
    expectedEpochId: review.input.epochId });
  review.blocks.set(input.id, block);
  return { ok: true, id: input.id, revision: block.revision };
}
function referenceResult(result: CanonicalMaintenanceResult): ToolOutput {
  const { record } = result;
  return { ok: true, applied: result.outcome === "applied", id: canonicalMemoryRow(record, record.provenance.characterId).id,
    bankId: record.unit.bankId, memoryId: record.unit.memoryId, revision: record.unit.revision, layer: record.policy.layerId };
}
