/**
 * INPUT:  Local canonical repositories, active authority, Character scope and structured blocks
 * OUTPUT: revision-frozen T5 report view and private canonical maintenance tools
 * POS:    core/memory — Local tidy adapter; all mutations remain authority/CAS fenced and transactional
 */
import { randomUUID } from "node:crypto";
import { tool, type ToolSet } from "ai";
import { z } from "zod";
import { MemoryErrorCodeSchema, TakiMemoryPolicyProjectionSchema, type CanonicalMemoryRecord } from "@taki/shared";
import type { CanonicalMemoryAuthorityRepo } from "../db/canonical-memory-authority-repo.ts";
import type { CanonicalMemoryMaintenanceRepo } from "../db/canonical-memory-maintenance-contract.ts";
import { stableRequestHash, type CanonicalMemoryRepo } from "../db/canonical-memory-repo.ts";
import type { MemoryEntryRow } from "../db/memory-repo.ts";
import type { BlockScope, StructuredMemoryBlock, StructuredMemoryBlockRepo } from "../db/structured-memory-block-repo.ts";
import { V1_BLOCKS, getBlock } from "./block-registry.ts";
import { canonicalMemoryRow, parseCanonicalMemoryReference } from "./canonical-memory-view.ts";
import { getLayer, WRITABLE_LAYER_IDS } from "./layer-registry.ts";
import { projectRetention } from "./local-memory-provider.ts";
import type { TidyEngineView } from "./memory-engine.ts";
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
  failed: boolean;
  receipts: Map<string, { hash: string; output: ToolOutput }>;
}
type ToolOutput = { ok: true; [key: string]: unknown } | { ok: false; code: string; message: string };
const RowInput = z.object({ id: z.string().min(1).max(8192) });
const Layer = z.enum(WRITABLE_LAYER_IDS as [string, ...string[]]);
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
      character: banks.find((bank) => bank.scope.kind === "character")?.bankId }, failed: false, receipts: new Map() };
  const requireCharacter = (id: string) => { if (id !== characterId) throw new Error("MEMORY_INVALID_REQUEST"); };
  return {
    listActive: (id) => { requireCharacter(id); return review.rows.map((row) => ({ ...row })); },
    countSince: (id, since) => { requireCharacter(id); return review.rows.filter((row) => (row.updatedAt ?? row.createdAt) > (since ?? "")).length; },
    readBlock: (ref) => ref.characterId !== undefined && ref.characterId !== characterId ? undefined : review.blocks.get(ref.id)?.content,
    createTools: (id) => { requireCharacter(id); return reviewTools(review); },
    reviewHealthy: () => reviewHealthy(review),
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
      inputSchema: z.object({ id: z.enum(V1_BLOCKS.map((block) => block.id) as [string, ...string[]]), content: z.string().min(1).max(100_000) }),
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
        referenceResult(review.input.repo.reinforce({ ...target(review, args.id, requestId), mode: "tidy" }).record)),
    }),
    memory_set_disclosure: tool({
      description: "Replace the recall trigger while preserving the memory's content. Phrase it the way the user would ask the question.",
      inputSchema: RowInput.extend({ disclosure: Disclosure.min(1) }),
      execute: (args, options) => guarded(review, { tool: "disclosure", callId: options.toolCallId, args }, (requestId) =>
        referenceResult(review.input.repo.policyEdit({ ...target(review, args.id, requestId), patch: { disclosure: args.disclosure } }).record)),
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
    ? review.input.repo.policyEdit({ ...common, patch: policy }).record
    : review.input.repo.copyToBank({ ...common, destinationBankId: to.bankId, policy }).record;
  return referenceResult(changed);
}

function supersede(review: Review, input: { id: string; replacement?: ReplacementInput; requestId: string }): ToolOutput {
  const common = target(review, input.id, input.requestId);
  if (!input.replacement) return referenceResult(review.input.repo.invalidate({ ...common, reason: "tidy" }).record);
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
    return { ...referenceResult(updated.record), archived: input.id };
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

function referenceResult(record: CanonicalMemoryRecord): ToolOutput {
  return { ok: true, id: canonicalMemoryRow(record, record.provenance.characterId).id,
    bankId: record.unit.bankId, memoryId: record.unit.memoryId, revision: record.unit.revision, layer: record.policy.layerId };
}

function reviewHealthy(review: Review): boolean {
  if (review.failed) return false;
  try { review.input.authority.activeEpoch(review.input.epochId); return true; }
  catch { review.failed = true; return false; }
}

function guarded(review: Review, input: { tool: string; callId: string; args: unknown }, run: (requestId: string) => ToolOutput): ToolOutput {
  const requestId = `tidy:${stableRequestHash({ pass: review.passId, tool: input.tool, call: input.callId })}`;
  const hash = stableRequestHash(input.args);
  try {
    review.input.authority.activeEpoch(review.input.epochId);
    const old = review.receipts.get(requestId);
    if (old && old.hash !== hash) throw new Error("MEMORY_REQUEST_ID_CONFLICT");
    if (old) return old.output;
    const output = run(requestId);
    // Only successful row operations can extend the captured review. Never
    // trust a supplied/archived reference or a Block ID as a new row admission.
    if (output.ok && typeof output.id === "string" && typeof output.memoryId === "string") review.references.add(output.id);
    review.receipts.set(requestId, { hash, output });
    return output;
  } catch (error) {
    review.failed = true;
    const parsed = MemoryErrorCodeSchema.safeParse(error instanceof Error ? error.message.split(":")[0] : "");
    return { ok: false, code: parsed.success ? parsed.data : "MEMORY_INTERNAL_ERROR", message: "Memory maintenance was not applied." };
  }
}
