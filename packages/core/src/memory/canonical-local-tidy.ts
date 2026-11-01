/**
 * INPUT:  Local canonical repositories, active authority, Character scope and structured blocks
 * OUTPUT: revision-frozen T5 report view and private canonical maintenance tools
 * POS:    core/memory — Local tidy adapter; all mutations remain authority/CAS fenced and transactional
 */
import { randomUUID } from "node:crypto";
import { tool, type ToolSet } from "ai";
import { z } from "zod";
import { MemoryErrorCodeSchema, TakiMemoryPolicyProjectionSchema, type MemoryTidyIssue } from "@taki/shared";
import type { CanonicalMemoryAuthorityRepo } from "../db/canonical-memory-authority-repo.ts";
import type { CanonicalMaintenanceResult, CanonicalMemoryMaintenanceRepo } from "../db/canonical-memory-maintenance-contract.ts";
import { stableRequestHash, type CanonicalMemoryRepo } from "../db/canonical-memory-repo.ts";
import type { MemoryEntryRow } from "../db/memory-repo.ts";
import type { BlockScope, StructuredMemoryBlock, StructuredMemoryBlockRepo } from "../db/structured-memory-block-repo.ts";
import { V1_BLOCKS, getBlock } from "./block-registry.ts";
import { canonicalMemoryRow, parseCanonicalMemoryReference } from "./canonical-memory-view.ts";
import { getLayer, WRITABLE_LAYER_IDS } from "./layer-registry.ts";
import { projectRetention } from "./local-memory-provider.ts";
import type { TidyEngineView, TidyReviewOutcome } from "./memory-engine.ts";
import type { SearchTokenizer } from "./search-tokenizer.ts";
import { FINISH_TOOL_NAME } from "./tidy-tools.ts";

interface TidyInput {
  repo: CanonicalMemoryMaintenanceRepo;
  records: CanonicalMemoryRepo;
  authority: CanonicalMemoryAuthorityRepo;
  blocks: StructuredMemoryBlockRepo;
  tokenizer: SearchTokenizer;
  epochId: string;
  now?: () => string;
}
interface Review {
  input: TidyInput;
  characterId: string;
  passId: string;
  at: string;
  rows: MemoryEntryRow[];
  references: Set<string>;
  blocks: Map<string, StructuredMemoryBlock | undefined>;
  bankIds: { global?: string; character?: string };
  finished: boolean;
  edits: number;
  issues: Map<string, MemoryTidyIssue>;
  receipts: Map<string, { hash: string; output: ToolOutput }>;
}
type ToolOutput = { ok: true; [key: string]: unknown } | { ok: false; code: string; message: string };
const TOOL_NAMES = {
  reinforce: "memory_reinforce", disclosure: "memory_set_disclosure", refile: "memory_refile",
  supersede: "memory_archive_supersede", block: "block_rethink", finish: FINISH_TOOL_NAME,
} as const satisfies Record<string, MemoryTidyIssue["toolName"]>;
interface GuardedInput { tool: keyof typeof TOOL_NAMES; callId: string; args: Record<string, unknown>; }
const RowInput = z.object({ id: z.string().min(1).max(8192) });
const Layer = z.enum(WRITABLE_LAYER_IDS as [string, ...string[]]);
const BackgroundBlock = z.enum(V1_BLOCKS.filter((block) => block.writer === "background").map((block) => block.id) as [string, ...string[]]);
const Disclosure = TakiMemoryPolicyProjectionSchema.shape.disclosure.unwrap();
const Replacement = z.object({ layer: Layer, content: z.string().min(1).max(100_000), importance: z.int().min(1).max(10), disclosure: Disclosure.optional() });
type ReplacementInput = z.infer<typeof Replacement>;

export function createCanonicalLocalTidyView(input: TidyInput): TidyEngineView {
  const capture = (characterId: string) => captureReview(input, characterId);
  return {
    captureReview: capture,
    listActive: (characterId) => capture(characterId).listActive(characterId),
    countSince: (characterId, since) => capture(characterId).listActive(characterId)
      .filter((row) => (row.updatedAt ?? row.createdAt) > (since ?? "")).length,
    readBlock: (ref) => input.blocks.read(ref.id, blockScope(ref.id, ref.characterId))?.content,
    createTools: (characterId) => capture(characterId).createTools(characterId),
  };
}

function captureReview(input: TidyInput, characterId: string): TidyEngineView {
  input.authority.activeEpoch(input.epochId);
  const banks = input.authority.listBanks(input.epochId).filter((bank) => bank.scope.kind === "global" || bank.scope.characterId === characterId);
  const scopes = new Map(banks.map((bank) => [bank.bankId, bank.scope.characterId]));
  // Hidden evidence can preserve another Character's support graph. Feeding it
  // to the model would bypass both foreground visibility and ownership policy.
  const rows = input.repo.list({ epochId: input.epochId, characterId })
    .filter((record) => record.policy.visibility !== "hidden")
    .map((record) => canonicalMemoryRow(record, scopes.get(record.unit.bankId) ?? null));
  const review: Review = { input, characterId, passId: randomUUID(), at: input.now?.() ?? new Date().toISOString(),
    rows, references: new Set(rows.map((row) => row.id)),
    blocks: new Map(V1_BLOCKS.map((block) => [block.id, input.blocks.read(block.id, blockScope(block.id, characterId))])),
    bankIds: { global: banks.find((bank) => bank.scope.kind === "global")?.bankId,
      character: banks.find((bank) => bank.scope.kind === "character")?.bankId },
    finished: false, edits: 0, issues: new Map(), receipts: new Map() };
  const requireCharacter = (id: string) => { if (id !== characterId) throw new Error("MEMORY_INVALID_REQUEST"); };
  return {
    listActive: (id) => { requireCharacter(id); return review.rows.map((row) => ({ ...row })); },
    countSince: (id, since) => { requireCharacter(id); return review.rows.filter((row) => (row.updatedAt ?? row.createdAt) > (since ?? "")).length; },
    readBlock: (ref) => ref.characterId !== undefined && ref.characterId !== characterId ? undefined : review.blocks.get(ref.id)?.content,
    createTools: (id) => { requireCharacter(id); return reviewTools(review); },
    reviewHealthy: () => reviewHealthy(review),
    reviewOutcome: () => reviewOutcome(review),
  };
}

function reviewTools(review: Review): ToolSet {
  return {
    ...rowTools(review),
    memory_archive_supersede: tool({
      description: "Reversibly archive a memory, optionally replacing it with a corrected fact. The original source remains preserved. Use the returned canonical reference for later edits.",
      inputSchema: RowInput.extend({ replacement: Replacement.optional() }),
      execute: (args, options) => guarded(review, { tool: "supersede", callId: options.toolCallId, args }, (requestId) => supersede(review, { ...args, requestId })),
    }),
    block_rethink: tool({
      description: "Replace one background-owned memory block in full. Preserve everything that should survive. The user-owned identity card cannot be changed. A concurrent edit is refused.",
      inputSchema: z.object({ id: BackgroundBlock, content: z.string().min(1).max(100_000) }),
      execute: (args, options) => guarded(review, { tool: "block", callId: options.toolCallId, args }, () => rethinkBlock(review, args)),
    }),
    [FINISH_TOOL_NAME]: tool({ description: "Finish the review when all useful edits are complete, including when no edit is needed.",
      inputSchema: z.object({}), execute: (args, options) => guarded(review, { tool: "finish", callId: options.toolCallId, args }, () => ({ ok: true })) }),
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

function target(review: Review, id: string, requestId: string) {
  const ref = parseCanonicalMemoryReference(id);
  if (ref.epochId !== review.input.epochId) throw new Error("MEMORY_AUTHORITY_MISMATCH");
  if (ref.bankId !== review.bankIds.global && ref.bankId !== review.bankIds.character) throw new Error("MEMORY_INVALID_REQUEST");
  if (!review.references.has(id)) throw new Error("MEMORY_INVALID_REQUEST");
  return { ...ref, characterId: review.characterId, requestId, now: review.at };
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
    retention: projectRetention(to.layer, current.policy.retention, review.at) };
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
      policy: { layerId: to.layer.id, visibility: to.layer.recallPolicy, retention: projectRetention(to.layer, current.policy.retention, review.at) } });
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
  const block = review.input.blocks.replace({ blockId: input.id, scope: blockScope(input.id, review.characterId),
    expectedRevision: review.blocks.get(input.id)?.revision ?? 0, actor: "background", content: input.content, now: review.at });
  review.blocks.set(input.id, block);
  return { ok: true, id: input.id, revision: block.revision };
}

function blockScope(id: string, characterId?: string): BlockScope {
  const definition = getBlock(id);
  if (!definition) throw new Error("MEMORY_INVALID_REQUEST");
  if (definition.ownership === "global") return { kind: "global", characterId: null };
  if (!characterId) throw new Error("MEMORY_INVALID_REQUEST");
  return { kind: "character", characterId };
}

function referenceResult(result: CanonicalMaintenanceResult): ToolOutput {
  const { record } = result;
  return { ok: true, applied: result.outcome === "applied", id: canonicalMemoryRow(record, record.provenance.characterId).id,
    bankId: record.unit.bankId, memoryId: record.unit.memoryId, revision: record.unit.revision, layer: record.policy.layerId };
}

function reviewHealthy(review: Review): boolean {
  return currentAuthority(review) && review.issues.size === 0;
}

function currentAuthority(review: Review): boolean {
  try { review.input.authority.activeEpoch(review.input.epochId); return true; }
  catch (error) {
    review.issues.set("authority", { toolName: "unknown", code: failureCode(error) });
    return false;
  }
}

function reviewOutcome(review: Review): TidyReviewOutcome {
  const current = currentAuthority(review);
  const reason = !current ? "review-stale" : review.issues.size > 0 ? "tool-errors" : !review.finished ? "unfinished" : undefined;
  return { complete: reason === undefined, edits: review.edits, reason,
    issues: [...review.issues.values()].slice(0, 20), issueCount: review.issues.size };
}

function guarded(review: Review, input: GuardedInput, run: (requestId: string) => ToolOutput): ToolOutput {
  const requestId = `tidy:${stableRequestHash({ pass: review.passId, tool: input.tool, call: input.callId })}`;
  const hash = stableRequestHash(input.args);
  let action: string | undefined;
  try {
    review.input.authority.activeEpoch(review.input.epochId);
    const old = review.receipts.get(requestId);
    if (old && old.hash !== hash) throw new Error("MEMORY_REQUEST_ID_CONFLICT");
    if (old) return old.output;
    action = actionIdentity(review, input);
    const output = run(requestId);
    // Only successful row operations can extend the captured review. Never
    // trust a supplied/archived reference or a Block ID as a new row admission.
    if (output.ok && typeof output.id === "string" && typeof output.memoryId === "string") review.references.add(output.id);
    review.receipts.set(requestId, { hash, output });
    if (output.ok) {
      if (input.tool === "finish") review.finished = true;
      else if (output.applied !== false) review.edits += 1;
      // The cached return above cannot prove a later conflict was corrected.
      // Only this fresh execution can settle the exact admitted action.
      if (action) review.issues.delete(`revision:${action}`);
    }
    return output;
  } catch (error) {
    const code = failureCode(error);
    const key = code === "MEMORY_REVISION_MISMATCH" && action ? `revision:${action}` : `fatal:${requestId}:${code}`;
    review.issues.set(key, { toolName: TOOL_NAMES[input.tool], code });
    return { ok: false, code, message: "Memory maintenance was not applied." };
  }
}

function actionIdentity(review: Review, input: GuardedInput): string | undefined {
  if (input.tool === "finish") return undefined;
  const { id, ...payload } = input.args;
  if (typeof id !== "string") throw new Error("MEMORY_INVALID_REQUEST");
  if (input.tool === "block") {
    return stableRequestHash({ tool: input.tool, id, scope: blockScope(id, review.characterId), payload });
  }
  // Reuse admission before classifying an error as recoverable. Revision is
  // omitted only from matching identity, never from the write's captured-ref/CAS fence.
  const { epochId, bankId, memoryId } = target(review, id, "action-identity");
  return stableRequestHash({ tool: input.tool, epochId, bankId, memoryId, payload });
}

function failureCode(error: unknown): MemoryTidyIssue["code"] {
  const parsed = MemoryErrorCodeSchema.safeParse(error instanceof Error ? error.message.split(":")[0] : "");
  return parsed.success ? parsed.data : "MEMORY_INTERNAL_ERROR";
}
