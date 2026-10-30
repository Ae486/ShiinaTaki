/**
 * INPUT: a selected source occurrence, its Intention owner and the canonical wake reservation
 * OUTPUT: exact plan claim/link/release and terminal reconciliation around the existing Run adapter
 * POS: core/initiative/wake — coordinates domain ownership without a second execution ledger
 */
import type { InitiativeWakeDependencies, WakeSelection } from "./wake-contract.ts";
import { canonicalWakeKey, type WakePolicyRepo } from "./wake-policy-repo.ts";

export function hasIntentionSource(selection: WakeSelection): boolean {
  return selection.candidates.some((candidate) => candidate.source === "intention");
}

function claims(selection: WakeSelection) {
  const ids = new Set(selection.candidates.filter((candidate) => candidate.source === "intention").map((candidate) => candidate.occurrenceKey));
  return [...ids].map((intentionId) => ({ characterId: selection.characterId, intentionId,
    canonicalRunKey: canonicalWakeKey(selection.characterId, selection.opportunityId) }));
}

export function claimIntentionSelection(deps: InitiativeWakeDependencies, repo: WakePolicyRepo, selection: WakeSelection): boolean {
  if (!deps.intentions) return false;
  let claimed = false;
  deps.db.transaction(() => {
    const held = [];
    for (const input of claims(selection)) {
      if (!deps.intentions?.claim(input)) {
        for (const previous of held) deps.intentions?.releaseUnadmitted(previous);
        return;
      }
      held.push(input);
    }
    claimed = repo.claim(selection);
    if (!claimed) for (const input of held) deps.intentions?.releaseUnadmitted(input);
  });
  return claimed;
}

export function linkIntentionSelection(deps: InitiativeWakeDependencies, selection: WakeSelection, runId: string): boolean {
  if (!hasIntentionSource(selection)) return true;
  if (!deps.intentions) return false;
  return claims(selection).every((input) => deps.intentions?.link({ ...input, runId }) === true);
}

export function settleIntentionSelection(deps: InitiativeWakeDependencies, repo: WakePolicyRepo, selection: WakeSelection): void {
  if (!hasIntentionSource(selection) || !deps.intentions) { repo.settle(selection.opportunityId); return; }
  deps.db.transaction(() => {
    const inputs = claims(selection);
    const released = inputs.map((input) => deps.intentions?.releaseUnadmitted(input));
    if (released.every(Boolean)) repo.releaseUnadmitted(selection.opportunityId);
    else repo.settle(selection.opportunityId);
    for (const { characterId, intentionId } of inputs) deps.intentions?.settleLinked({ characterId, intentionId });
  });
}

export function currentIntentionSnapshot(deps: InitiativeWakeDependencies, selection: WakeSelection,
  current: WakeSelection["snapshot"]): WakeSelection["snapshot"] {
  if (!deps.intentions || !hasIntentionSource(selection)) return current;
  const retained = selection.snapshot.intentions.filter((fact) => claims(selection).some((claim) =>
    claim.intentionId === fact.intentionId && deps.intentions?.isCurrent(claim) === true));
  // Active -> claimed is not a source change. Retain only our own original, still-valid claim projection;
  // no newer source/window is captured to keep an old output alive.
  const byId = new Map(current.intentions.map((fact) => [fact.intentionId, fact]));
  for (const fact of retained) byId.set(fact.intentionId, fact);
  return { ...current, intentions: [...byId.values()] };
}
