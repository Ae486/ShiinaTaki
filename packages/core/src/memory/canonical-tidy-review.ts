/**
 * INPUT:  one captured Local review, classified tool attempts and explicit completion
 * OUTPUT: fenced transactional edits, short model references, exact effects and a recoverable issue ledger
 * POS:    core/memory — review lifetime and mutation accounting, separate from the maintenance verbs
 */
import { MemoryErrorCodeSchema, type MemoryTidyIssue } from "@taki/shared";
import type { CanonicalMemoryAuthorityRepo } from "../db/canonical-memory-authority-repo.ts";
import type { CanonicalMemoryMaintenanceRepo } from "../db/canonical-memory-maintenance-contract.ts";
import { stableRequestHash, type CanonicalMemoryRepo } from "../db/canonical-memory-repo.ts";
import type { MemoryEntryRow } from "../db/memory-repo.ts";
import type { BlockScope, StructuredMemoryBlock, StructuredMemoryBlockRepo } from "../db/structured-memory-block-repo.ts";
import { fenceUntrusted } from "../agents/untrusted-fence.ts";
import { getBlock } from "./block-registry.ts";
import { canonicalMemoryRow, parseCanonicalMemoryReference } from "./canonical-memory-view.ts";
import type { TidyReviewOptions, TidyReviewOutcome } from "./memory-engine.ts";
import type { SearchTokenizer } from "./search-tokenizer.ts";
import { createTidyIssueLedger, TidyFinishSchema, tidyIssueHint } from "./tidy-issues.ts";
import { FINISH_TOOL_NAME } from "./tidy-tools.ts";

export interface CanonicalTidyInput {
  repo: CanonicalMemoryMaintenanceRepo; records: CanonicalMemoryRepo;
  authority: CanonicalMemoryAuthorityRepo; blocks: StructuredMemoryBlockRepo;
  tokenizer: SearchTokenizer; epochId: string; now?: () => string;
}
export interface CanonicalTidyReview {
  input: CanonicalTidyInput; characterId: string; passId: string; at: string;
  rows: MemoryEntryRow[]; references: Set<string>; results: Set<string>;
  blocks: Map<string, StructuredMemoryBlock | undefined>;
  bankIds: { global?: string; character?: string }; finished: boolean; edits: number;
  issues: ReturnType<typeof createTidyIssueLedger>; options: TidyReviewOptions;
  handles: Map<string, string>; receipts: Map<string, { hash: string; output: TidyToolOutput }>;
}
export type TidyToolOutput = { ok: true; [key: string]: unknown } | { ok: false; code: string; message: string; [key: string]: unknown };
export const TIDY_TOOL_NAMES = {
  reinforce: "memory_reinforce", disclosure: "memory_set_disclosure", refile: "memory_refile",
  supersede: "memory_archive_supersede", block: "block_rethink", finish: FINISH_TOOL_NAME,
} as const satisfies Record<string, MemoryTidyIssue["toolName"]>;
export interface GuardedTidyInput { tool: keyof typeof TIDY_TOOL_NAMES; callId: string; args: Record<string, unknown>; }

class ReferenceError extends Error {}

export function reviewReference(review: CanonicalTidyReview, id: string): string {
  if (!review.options.modelReferences) return id;
  for (const [handle, reference] of review.handles) if (reference === id) return handle;
  const handle = `m${review.handles.size + 1}`;
  review.handles.set(handle, id);
  return handle;
}

export function tidyTarget(review: CanonicalTidyReview, id: string, requestId: string) {
  const reference = review.handles.get(id) ?? id;
  try {
    const ref = parseCanonicalMemoryReference(reference);
    if (ref.epochId !== review.input.epochId) throw new ReferenceError("MEMORY_AUTHORITY_MISMATCH");
    if (ref.bankId !== review.bankIds.global && ref.bankId !== review.bankIds.character || !review.references.has(reference)) {
      throw new ReferenceError("MEMORY_INVALID_REQUEST");
    }
    return { ...ref, characterId: review.characterId, requestId, now: review.at };
  } catch (error) {
    throw new ReferenceError(failureCode(error));
  }
}

export function tidyBlockScope(id: string, characterId?: string): BlockScope {
  const definition = getBlock(id);
  if (!definition) throw new Error("MEMORY_INVALID_REQUEST");
  if (definition.ownership === "global") return { kind: "global", characterId: null };
  if (!characterId) throw new Error("MEMORY_INVALID_REQUEST");
  return { kind: "character", characterId };
}

export function tidyReviewOutcome(review: CanonicalTidyReview): TidyReviewOutcome {
  let current = true;
  try { review.input.authority.activeEpoch(review.input.epochId); }
  catch (error) {
    current = false;
    review.issues.reject({ toolName: "unknown", callId: "authority", code: failureCode(error), stage: "write" });
  }
  const issues = review.issues.pending();
  const reason = !current ? "review-stale" : issues.length > 0 ? "tool-errors" : !review.finished ? "unfinished" : undefined;
  return { complete: reason === undefined, edits: review.edits, reason, issues: issues.slice(0, 20),
    issueCount: issues.length, recoveredIssues: review.issues.recovered(), skippedIssues: review.issues.skipped() };
}

export function tidyReviewReminder(review: CanonicalTidyReview): string {
  const issues = review.issues.pending();
  if (issues.length === 0) return "";
  return "Unresolved review calls (these are not applied edits):\n" + issues.slice(0, 20).map((issue) =>
    `${issue.issueId}: ${issue.toolName} ${issue.code}. ${tidyIssueHint(issue)}`).join("\n") +
    "\nAt finish, acknowledge each known no-write issue with resolutions: {issueId,status:'corrected',correctedBy:<later successful callId>} " +
    "or {issueId,status:'not-needed',reason:'already-satisfied'|'mistaken-request'|'no-useful-change'}. Unknown failures cannot be dismissed.";
}

export function finishTidyReview(review: CanonicalTidyReview, args: unknown): TidyToolOutput {
  const parsed = TidyFinishSchema.safeParse(args);
  if (!parsed.success || !review.issues.resolve(parsed.data.resolutions ?? [])) {
    return { ok: false, code: "MEMORY_INVALID_REQUEST", message: "Finish acknowledgements must reference unresolved issues and later successful calls on the same known target.",
      issues: review.issues.pending().slice(0, 20) };
  }
  if (review.issues.pending().length > 0) return { ok: false, code: "MEMORY_INVALID_REQUEST",
    message: "Review is not complete. Resolve or explicitly acknowledge the remaining rejected calls.", issues: review.issues.pending().slice(0, 20) };
  return { ok: true };
}

export function guardedTidy(review: CanonicalTidyReview, input: GuardedTidyInput, run: (requestId: string) => TidyToolOutput): TidyToolOutput {
  const requestId = `tidy:${stableRequestHash({ pass: review.passId, tool: input.tool, call: input.callId })}`;
  const hash = stableRequestHash(input.args);
  const priorBlocks = new Map(review.blocks);
  let action: string | undefined;
  let targetIdentity: string | undefined;
  try {
    review.input.authority.activeEpoch(review.input.epochId);
    const old = review.receipts.get(requestId);
    if (old && old.hash !== hash) throw new Error("MEMORY_REQUEST_ID_CONFLICT");
    if (old) return old.output;
    // SDK stop conditions run after a whole step; queued calls in that same step must stop here too.
    if (review.issues.blocked()) return { ok: false, code: "MEMORY_INTERNAL_ERROR",
      message: "Review stopped after an unresolved failure; no further mutation was attempted." };
    if (review.finished && input.tool !== "finish") throw new Error("MEMORY_INVALID_REQUEST");
    const identity = actionIdentity(review, input);
    action = identity?.action;
    targetIdentity = identity?.target;
    const output = review.input.repo.transaction(() => {
      const result = run(requestId);
      if (result.ok && input.tool !== "finish" && result.applied !== false) review.options.onEdits?.(review.edits + 1);
      return result;
    });
    return acceptResult(review, { input, output, requestId, hash, action, target: targetIdentity });
  } catch (error) {
    review.blocks = priorBlocks;
    review.finished = false;
    const code = failureCode(error);
    const issue = review.issues.reject({ toolName: TIDY_TOOL_NAMES[input.tool], callId: input.callId, code,
      stage: error instanceof ReferenceError ? "reference" : "write", field: error instanceof ReferenceError ? "id" : undefined,
      action, target: targetIdentity });
    const current = code === "MEMORY_REVISION_MISMATCH" ? refreshedEvidence(review, input) : undefined;
    return { ok: false, code, issueId: issue.issueId, message: tidyIssueHint(issue), ...(current ? { current } : {}) };
  }
}

function acceptResult(review: CanonicalTidyReview, value: {
  input: GuardedTidyInput; output: TidyToolOutput; requestId: string; hash: string; action?: string; target?: string;
}): TidyToolOutput {
  const { input, output } = value;
  if (!output.ok) return output;
  if (typeof output.id === "string" && typeof output.memoryId === "string") {
    review.references.add(output.id); review.results.add(output.id);
  }
  if (input.tool === "finish") review.finished = true;
  else {
    if (output.applied !== false) review.edits += 1;
    review.issues.success({ toolName: TIDY_TOOL_NAMES[input.tool], callId: input.callId, action: value.action, target: value.target });
  }
  const result = { ...output, callId: input.callId,
    ...(typeof output.id === "string" && typeof output.memoryId === "string" ? { id: reviewReference(review, output.id) } : {}) };
  review.receipts.set(value.requestId, { hash: value.hash, output: result });
  return result;
}

function actionIdentity(review: CanonicalTidyReview, input: GuardedTidyInput): { action: string; target: string } | undefined {
  if (input.tool === "finish") return undefined;
  const { id, ...payload } = input.args;
  if (typeof id !== "string") throw new ReferenceError("MEMORY_INVALID_REQUEST");
  const target = input.tool === "block"
    ? { id, scope: tidyBlockScope(id, review.characterId) }
    : memoryTargetIdentity(review, id);
  return { target: stableRequestHash(target), action: stableRequestHash({ tool: input.tool, ...target, payload }) };
}

function memoryTargetIdentity(review: CanonicalTidyReview, id: string) {
  const { epochId, bankId, memoryId } = tidyTarget(review, id, "action-identity");
  return { epochId, bankId, memoryId };
}

function refreshedEvidence(review: CanonicalTidyReview, input: GuardedTidyInput): object | undefined {
  try {
    if (typeof input.args.id !== "string") return undefined;
    if (input.tool === "block") {
      const current = review.input.blocks.read(input.args.id, tidyBlockScope(input.args.id, review.characterId));
      if (current) review.blocks.set(input.args.id, current);
      return current ? { id: current.blockId, revision: current.revision, content: current.content } : undefined;
    }
    const target = tidyTarget(review, input.args.id, "refresh");
    const record = review.input.repo.record(target);
    if (!record || record.unit.state !== "valid" || record.policy.visibility === "hidden") return undefined;
    const row = canonicalMemoryRow(record, record.provenance.characterId);
    review.references.add(row.id);
    return { id: reviewReference(review, row.id), layer: row.layer, importance: row.importance, disclosure: row.disclosure,
      content: row.origin === "observed" ? fenceUntrusted({ source: "memory", content: row.content }) : row.content };
  } catch { return undefined; }
}

function failureCode(error: unknown): MemoryTidyIssue["code"] {
  const parsed = MemoryErrorCodeSchema.safeParse(error instanceof Error ? error.message.split(":")[0] : "");
  return parsed.success ? parsed.data : "MEMORY_INTERNAL_ERROR";
}
