/**
 * INPUT:  exact verified policy/Block targets, active namespace guard and bounded model/publication outcomes
 * OUTPUT: fenced durable claims/results, original command identities, retry/terminal progress and committed review hints
 * POS:    core/db — atomic entry/exit guard private reads; public reads and claim expiry stay independently guarded
 */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { REPLICA_RETRY_DELAYS_MS, TakiApplicationTimeSchema } from "@taki/shared";
import type { Database } from "./sqlite.ts";
import { HindsightPolicyWorkScopeSchema, HindsightPolicyWorkKeySchema, HindsightPolicyWorkTargetSchema,
  HindsightPolicyPromptEvidenceSchema, HindsightPolicyWorkResultSchema, hindsightPolicyWorkIdentity,
  validateHindsightPolicyWorkTarget, validateHindsightPolicyWorkResult,
  type HindsightPolicyWorkScope, type HindsightPolicyWorkKey, type HindsightPolicyWorkTarget,
  type HindsightPolicyWorkRecord, type HindsightPolicyWorkResult, type HindsightPolicyPromptEvidence } from "./hindsight-policy-work-contract.ts";
import { insertPolicyWork, readPolicyWork, listPolicyWork, savePolicyWork } from "./hindsight-policy-work-storage.ts";
import { sameApplicationValue } from "../memory/hindsight/hindsight-application-integrity.ts";

export interface HindsightPolicyWorkClaim { key: HindsightPolicyWorkKey; token: string; revision: number }
export interface HindsightPolicyWorkRepo {
  prepare(input: { scope: HindsightPolicyWorkScope; target: HindsightPolicyWorkTarget }): HindsightPolicyWorkRecord;
  get(key: HindsightPolicyWorkKey): HindsightPolicyWorkRecord | undefined;
  pending(input: HindsightPolicyWorkScope & { limit: number }): HindsightPolicyWorkRecord[];
  claim(input: { key: HindsightPolicyWorkKey; leaseMs: number }): HindsightPolicyWorkRecord | undefined;
  prompt(input: { claim: HindsightPolicyWorkClaim; prompt: HindsightPolicyPromptEvidence }): HindsightPolicyWorkRecord;
  saveResult(input: { claim: HindsightPolicyWorkClaim; result: HindsightPolicyWorkResult }): HindsightPolicyWorkRecord;
  defer(input: { claim: HindsightPolicyWorkClaim; failure: NonNullable<HindsightPolicyWorkRecord["lastFailure"]> }): HindsightPolicyWorkRecord;
  complete(claim: HindsightPolicyWorkClaim): HindsightPolicyWorkRecord;
  supersede(claim: HindsightPolicyWorkClaim): HindsightPolicyWorkRecord;
}
export interface HindsightPolicyWorkRepoDeps { db: Database; assertActive(scope: HindsightPolicyWorkScope): void; now?: () => string;
  admitMutation?<T>(action: () => T): T; onPolicyReviewChanged?: (bankId: string) => void }

export function createHindsightPolicyWorkRepo(deps: HindsightPolicyWorkRepoDeps): HindsightPolicyWorkRepo {
  return { prepare: (input) => prepare(deps, input), get: (key) => get(deps, key),
    pending: (input) => { assertActive(deps, input); z.int().min(1).max(1000).parse(input.limit); return listPolicyWork(deps.db, { ...input, at: now(deps) }); },
    claim: (input) => claim(deps, input), prompt: (input) => setPrompt(deps, input), saveResult: (input) => saveResult(deps, input),
    defer: (input) => defer(deps, input), complete: (input) => finish(deps, { claim: input, state: "completed" }),
    supersede: (input) => finish(deps, { claim: input, state: "superseded" }) };
}
export function policyWorkClaim(record: HindsightPolicyWorkRecord): HindsightPolicyWorkClaim {
  if (!record.claimToken) throw new Error("MEMORY_REVISION_MISMATCH");
  return { key: record.key, token: record.claimToken, revision: record.revision };
}
export function policyWorkRetryAt(at: string, attempts: number): string {
  const index = Math.min(Math.max(0, attempts - 1), REPLICA_RETRY_DELAYS_MS.length - 1);
  return new Date(Date.parse(TakiApplicationTimeSchema.parse(at)) + REPLICA_RETRY_DELAYS_MS[index]!).toISOString();
}

function prepare(deps: HindsightPolicyWorkRepoDeps, input: { scope: HindsightPolicyWorkScope; target: HindsightPolicyWorkTarget }): HindsightPolicyWorkRecord {
  const scope = HindsightPolicyWorkScopeSchema.parse(input.scope); const target = HindsightPolicyWorkTargetSchema.parse(input.target);
  if (target.kind === "policy" && target.memory.assessment.state !== "due" && target.memory.assessment.state !== "failed") {
    throw new Error("MEMORY_INVALID_REQUEST");
  }
  validateHindsightPolicyWorkTarget(scope, target);
  const key = { ...scope, workId: hindsightPolicyWorkIdentity(scope, target) };
  return atomic(deps, scope, () => {
    const prior = readPolicyWork(deps.db, key); if (prior) return prior;
    const at = now(deps);
    insertPolicyWork(deps.db, { key, target, state: "ready", revision: 1, claims: 0,
      claimToken: null, claimUntil: null, nextAttemptAt: null, prompt: null, result: null,
      commandRequestId: `hindsight-${key.workId}`, lastFailure: null, createdAt: at, updatedAt: at, finishedAt: null });
    return requireWork(deps, key);
  });
}
function get(deps: HindsightPolicyWorkRepoDeps, key: HindsightPolicyWorkKey): HindsightPolicyWorkRecord | undefined {
  HindsightPolicyWorkKeySchema.parse(key); assertActive(deps, key); return readPolicyWork(deps.db, key);
}
function requireWork(deps: HindsightPolicyWorkRepoDeps, key: HindsightPolicyWorkKey): HindsightPolicyWorkRecord {
  // Every private caller is inside atomic(); the storage reader still verifies the original bytes and hashes.
  const work = readPolicyWork(deps.db, key); if (!work) throw new Error("MEMORY_NOT_FOUND"); return work;
}

function claim(deps: HindsightPolicyWorkRepoDeps, input: { key: HindsightPolicyWorkKey; leaseMs: number }): HindsightPolicyWorkRecord | undefined {
  z.int().positive().max(4_294_967_294).parse(input.leaseMs);
  return atomic(deps, input.key, () => {
    const previous = requireWork(deps, input.key); const at = now(deps);
    if (previous.state === "completed" || previous.state === "superseded"
      || previous.nextAttemptAt !== null && Date.parse(previous.nextAttemptAt) > Date.parse(at)
      || previous.claimUntil !== null && Date.parse(previous.claimUntil) > Date.parse(at)) return;
    return update(deps, previous, { state: previous.result === null ? "claimed" : "saved", claims: previous.claims + 1,
      claimToken: randomUUID(), claimUntil: new Date(Date.parse(at) + input.leaseMs).toISOString(), nextAttemptAt: null,
      // A policy attempt admitted before a crash is first published as failed from this original prompt evidence.
      // It is not silently replaced by another model call under the same native/application assessment attempt.
      prompt: previous.result || previous.target.kind === "policy" ? previous.prompt : null });
  });
}
function setPrompt(deps: HindsightPolicyWorkRepoDeps, input: { claim: HindsightPolicyWorkClaim; prompt: HindsightPolicyPromptEvidence }): HindsightPolicyWorkRecord {
  return claimed(deps, input.claim, (previous) => {
    const prompt = HindsightPolicyPromptEvidenceSchema.parse(input.prompt);
    if (previous.result !== null || previous.prompt !== null && !sameApplicationValue(previous.prompt, prompt)) throw new Error("MEMORY_REQUEST_ID_CONFLICT");
    return previous.prompt ? previous : update(deps, previous, { prompt });
  });
}
function saveResult(deps: HindsightPolicyWorkRepoDeps, input: { claim: HindsightPolicyWorkClaim; result: HindsightPolicyWorkResult }): HindsightPolicyWorkRecord {
  let saved = false;
  const record = claimed(deps, input.claim, (previous) => {
    const result = HindsightPolicyWorkResultSchema.parse(input.result);
    validateHindsightPolicyWorkResult(previous, result);
    if (previous.result) {
      if (!sameApplicationValue(previous.result, result)) throw new Error("MEMORY_REQUEST_ID_CONFLICT");
      return previous;
    }
    saved = true;
    return update(deps, previous, { state: "saved", result, lastFailure: result.kind === "assessment-failure" ? result.failure : null });
  });
  if (saved) deps.onPolicyReviewChanged?.(record.key.bankId);
  return record;
}
function defer(deps: HindsightPolicyWorkRepoDeps, input: { claim: HindsightPolicyWorkClaim; failure: NonNullable<HindsightPolicyWorkRecord["lastFailure"]> }): HindsightPolicyWorkRecord {
  return claimed(deps, input.claim, (previous) => update(deps, previous, { state: previous.result ? "saved" : "ready",
    claimToken: null, claimUntil: null, nextAttemptAt: policyWorkRetryAt(now(deps), previous.claims), lastFailure: input.failure }));
}
function finish(deps: HindsightPolicyWorkRepoDeps, input: { claim: HindsightPolicyWorkClaim; state: "completed" | "superseded" }): HindsightPolicyWorkRecord {
  const record = claimed(deps, input.claim, (previous) => {
    if (input.state === "completed" && previous.result === null) throw new Error("MEMORY_INTEGRITY_ERROR");
    return update(deps, previous, { state: input.state, claimToken: null, claimUntil: null, nextAttemptAt: null,
      finishedAt: now(deps), lastFailure: input.state === "superseded" ? "revision_conflict" : previous.lastFailure });
  });
  deps.onPolicyReviewChanged?.(record.key.bankId);
  return record;
}

function claimed<T>(deps: HindsightPolicyWorkRepoDeps, input: HindsightPolicyWorkClaim, action: (work: HindsightPolicyWorkRecord) => T): T {
  return atomic(deps, input.key, () => {
    const work = requireWork(deps, input.key);
    if (work.claimToken !== input.token || work.revision !== input.revision || !work.claimUntil
      || Date.parse(work.claimUntil) <= Date.parse(now(deps)) || work.state === "completed" || work.state === "superseded") throw new Error("MEMORY_REVISION_MISMATCH");
    const result = action(work);
    if (Date.parse(work.claimUntil) <= Date.parse(now(deps))) throw new Error("MEMORY_REVISION_MISMATCH");
    return result;
  });
}
function update(deps: HindsightPolicyWorkRepoDeps, previous: HindsightPolicyWorkRecord, patch: Partial<HindsightPolicyWorkRecord>): HindsightPolicyWorkRecord {
  savePolicyWork(deps.db, { previous, next: { ...previous, ...patch, revision: previous.revision + 1, updatedAt: now(deps) } });
  return requireWork(deps, previous.key);
}
function now(deps: HindsightPolicyWorkRepoDeps): string { return TakiApplicationTimeSchema.parse(deps.now?.() ?? new Date().toISOString()); }
function assertActive(deps: HindsightPolicyWorkRepoDeps, input: HindsightPolicyWorkScope): void {
  const scope = HindsightPolicyWorkScopeSchema.parse({ authorityEpochId: input.authorityEpochId, bankId: input.bankId, namespace: input.namespace });
  if (Object.prototype.toString.call(deps.assertActive) === "[object AsyncFunction]") throw new Error("MEMORY_INVALID_REQUEST");
  const result: unknown = deps.assertActive(scope);
  if (result !== null && typeof result === "object" && "then" in result) throw new Error("MEMORY_INVALID_REQUEST");
}
function atomic<T>(deps: HindsightPolicyWorkRepoDeps, scope: HindsightPolicyWorkScope, action: () => T): T {
  let result: { value: T } | undefined;
  const transaction = () => deps.db.transaction(() => { assertActive(deps, scope); result = { value: action() }; assertActive(deps, scope); });
  if (deps.admitMutation) deps.admitMutation(transaction); else transaction();
  if (!result) throw new Error("MEMORY_INTERNAL_ERROR"); return result.value;
}
