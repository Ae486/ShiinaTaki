/**
 * INPUT:  validated Bank-scoped recall results, current query/time, and one shared consumption budget
 * OUTPUT: policy-filtered Canonical hits and separate unconfirmed source/mutation intents
 * POS:    core/memory — read-only selection shared by automatic recall and explicit recall tools
 */
import type { CanonicalMemoryRecord, RecallPendingOverlayEntry, RecallResult, TakiMemoryPolicyProjection } from "@taki/shared";
import { normalizeForDedupe } from "./dedupe.ts";
import { disclosureMatches } from "./disclosure-gate.ts";
import { estimateTokens } from "./token-estimator.ts";

type Hit = RecallResult["hits"][number];
type Scope = "global" | "character";
export interface MemoryRecallBranch { scope: Scope; bankId: string; data: RecallResult }
export type MemoryRecallCandidate =
  | { kind: "hit"; scope: Scope; hit: Hit }
  | { kind: "pending"; scope: Scope; entry: RecallPendingOverlayEntry };
interface SelectionInput {
  branches: MemoryRecallBranch[]; query: string; now: number; limit: number; maxTokens: number;
  visibleContext?: string; tokens?: (candidates: MemoryRecallCandidate[]) => number;
}
interface PolicyInput { query: string; now: number }

export function recallMatchesNamespace(data: RecallResult, namespace: { authorityEpochId: string; bankId: string }): boolean {
  return data.hits.every(({ record }) => record.unit.authorityEpochId === namespace.authorityEpochId
    && record.unit.bankId === namespace.bankId)
    && (data.pending ?? []).every((entry) => entry.authorityEpochId === namespace.authorityEpochId
      && entry.bankId === namespace.bankId && entry.operation.request.bankId === namespace.bankId);
}

export function selectMemoryRecall(input: SelectionInput) {
  const hits = input.branches.flatMap((branch) => branch.data.hits);
  const visible = normalizeForDedupe(input.visibleContext ?? "");
  const candidates: MemoryRecallCandidate[] = []; const identities = new Set<string>(); const texts = new Set<string>();
  const tokens = input.tokens ?? ((items: MemoryRecallCandidate[]) => items.reduce((sum, item) => sum + memoryRecallTextTokens(item), 0));
  let truncated = false;
  for (const candidate of interleave(input.branches)) {
    const admitted = admit(candidate, hits, input);
    if (!admitted || duplicates({ candidate: admitted, visible, identities, texts })) continue;
    if (candidates.length >= input.limit || tokens([...candidates, admitted]) > input.maxTokens) { truncated = true; continue; }
    candidates.push(admitted);
    identities.add(candidateIdentity(admitted));
    const textKey = candidateTextKey(admitted);
    if (textKey) texts.add(textKey);
  }
  return { candidates, hits: candidates.flatMap((candidate) => candidate.kind === "hit" ? [candidate.hit] : []),
    pending: candidates.flatMap((candidate) => candidate.kind === "pending" ? [candidate.entry] : []), truncated };
}

function interleave(branches: MemoryRecallBranch[]): MemoryRecallCandidate[] {
  const lists = branches.map((branch) => [
    ...branch.data.hits.map((hit): MemoryRecallCandidate => ({ kind: "hit", scope: branch.scope, hit })),
    ...(branch.data.pending ?? []).map((entry): MemoryRecallCandidate => ({ kind: "pending", scope: branch.scope, entry })),
  ]);
  const candidates: MemoryRecallCandidate[] = [];
  const length = Math.max(0, ...lists.map((list) => list.length));
  for (let index = 0; index < length; index += 1) {
    for (const list of lists) { const candidate = list[index]; if (candidate) candidates.push(candidate); }
  }
  // Confirmed evidence wins display duplication without advancing any Pending recovery state.
  return candidates.sort((left, right) => Number(right.kind === "hit" && right.hit.confirmed)
    - Number(left.kind === "hit" && left.hit.confirmed));
}

function admit(candidate: MemoryRecallCandidate, hits: Hit[], input: PolicyInput): MemoryRecallCandidate | undefined {
  if (candidate.kind === "hit") return recordEligible(candidate.hit.record, input) ? candidate : undefined;
  const entry = candidate.entry;
  if (entry.operation.kind === "retain") {
    if (!policyEligible(entry.operation.request.policy, entry.originalAt, input) || sourceAlreadyRepresented(entry, hits, input)) return;
    return candidate;
  }
  const target = mutationTarget(entry, hits);
  // A mutation request contains no policy. Its own text/reason must never bypass a hidden or unverified target.
  if (!target || !recordEligible(target, input)) return;
  return { ...candidate, entry: { ...entry, targetRecord: target } };
}

function mutationTarget(entry: RecallPendingOverlayEntry, hits: Hit[]): CanonicalMemoryRecord | undefined {
  if (entry.operation.kind !== "mutation") return;
  const request = entry.operation.request;
  const current = hits.filter((hit) => hit.confirmed && sameNamespace(entry, hit.record)
    && hit.record.unit.memoryId === request.memoryId)
    .sort((left, right) => right.record.unit.revision - left.record.unit.revision)[0]?.record;
  // Current confirmed evidence overrides an older attachment, including app-only restrictive policy changes.
  const target = current ?? entry.targetRecord;
  return target && sameNamespace(entry, target) && target.unit.memoryId === request.memoryId
    && target.unit.revision === request.expectedRevision ? target : undefined;
}

function sourceAlreadyRepresented(entry: RecallPendingOverlayEntry, hits: Hit[], input: PolicyInput): boolean {
  if (entry.operation.kind !== "retain") return false;
  const request = entry.operation.request;
  const text = normalizeForDedupe(request.content);
  return hits.some((hit) => {
    if (!hit.confirmed || !sameNamespace(entry, hit.record)) return false;
    const documentId = hit.record.unit.documentId;
    const sameDocument = request.documentId !== null && documentId === request.documentId;
    // A confirmed restrictive fact from the same source forbids exposing that whole source through an overlay.
    if (sameDocument && !recordEligible(hit.record, input)) return true;
    if (request.documentId !== null && documentId !== null && !sameDocument) return false;
    return text.length > 0 && normalizeForDedupe(hit.record.unit.text) === text
      && (sameDocument || recordEligible(hit.record, input));
  });
}

function sameNamespace(entry: RecallPendingOverlayEntry, record: CanonicalMemoryRecord): boolean {
  return entry.authorityEpochId === record.unit.authorityEpochId && entry.bankId === record.unit.bankId;
}

export function recordEligible(record: CanonicalMemoryRecord, input: PolicyInput): boolean {
  return record.unit.state === "valid" && policyEligible(record.policy, record.unit.updatedAt, input);
}

function policyEligible(policy: Pick<TakiMemoryPolicyProjection, "visibility" | "disclosure" | "retention" | "importance">,
  updatedAt: string, input: PolicyInput): boolean {
  if (!Number.isFinite(input.now) || policy.visibility === "hidden") return false;
  if (policy.visibility === "mood-gated" && !disclosureMatches(policy.disclosure ?? "", input.query)) return false;
  const retention = policy.retention;
  if (retention.kind === "permanent") return true;
  if (retention.kind === "expiring") return Date.parse(retention.expiresAt) > input.now;
  const ageDays = (input.now - Date.parse(updatedAt)) / 86_400_000;
  if (retention.kind === "rolling-window") return ageDays <= retention.days;
  return policy.importance >= retention.archiveBelowImportance || ageDays <= retention.afterDays;
}

function duplicates(input: { candidate: MemoryRecallCandidate; visible: string; identities: Set<string>; texts: Set<string> }): boolean {
  if (input.identities.has(candidateIdentity(input.candidate))) return true;
  const text = candidateText(input.candidate);
  const key = candidateTextKey(input.candidate);
  return text !== null && (!text || input.visible.includes(text) || (key !== null && input.texts.has(key)));
}

function candidateIdentity(candidate: MemoryRecallCandidate): string {
  if (candidate.kind === "hit") {
    const unit = candidate.hit.record.unit;
    return JSON.stringify(["memory", unit.authorityEpochId, unit.bankId, unit.memoryId]);
  }
  const entry = candidate.entry;
  return JSON.stringify(["pending", entry.authorityEpochId, entry.bankId, entry.operationId]);
}

function candidateText(candidate: MemoryRecallCandidate): string | null {
  if (candidate.kind === "hit") return normalizeForDedupe(candidate.hit.record.unit.text);
  return candidate.entry.operation.kind === "retain" ? normalizeForDedupe(candidate.entry.operation.request.content) : null;
}

function candidateTextKey(candidate: MemoryRecallCandidate): string | null {
  const text = candidateText(candidate);
  if (candidate.kind === "hit") return text;
  const entry = candidate.entry;
  return entry.operation.kind === "retain"
    ? JSON.stringify([entry.authorityEpochId, entry.bankId, entry.operation.request.documentId, text]) : null;
}

function memoryRecallTextTokens(candidate: MemoryRecallCandidate): number {
  if (candidate.kind === "hit") return estimateTokens(candidate.hit.record.unit.text);
  const { entry } = candidate; const { operation } = entry;
  if (operation.kind === "retain") return estimateTokens([operation.request.content, operation.request.context ?? ""].join("\n"));
  // The structured tool result includes the eligibility attachment, so its text shares the intent's budget.
  const request = operation.request;
  const content = request.kind === "edit" ? JSON.stringify(request.patch) : request.kind === "invalidate" ? request.reason ?? "" : "";
  return estimateTokens([content, entry.targetRecord?.unit.text ?? "", entry.targetRecord?.unit.context ?? ""].join("\n"));
}
