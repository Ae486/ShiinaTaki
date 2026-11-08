/**
 * INPUT: stored evidence rows and pure Bank projection inputs within one synchronous validation boundary
 * OUTPUT: exact byte comparison, deep JSON freezing and complete semantic projection keys
 * POS: core/memory/transitions — pure helpers for the expiring evidence context; no cross-read store or verdict
 */
import type { MemoryTransitionNativeEvidence } from "@taki/shared";
import type { SqlRow } from "../../db/sqlite.ts";
import type { HindsightApplicationBundle } from "../hindsight/hindsight-application-bundle.ts";
import type { projectTransitionLocalBank } from "./transition-local-projection.ts";
import { transitionLocalHash } from "./transition-local-encoding.ts";

export interface VerifiedEvidenceArtifact {
  evidence: MemoryTransitionNativeEvidence; bundle: HindsightApplicationBundle; row: SqlRow & { body: Uint8Array };
}
type ProjectionInput = Omit<Parameters<typeof projectTransitionLocalBank>[0], "verification">;
export function assertEvidenceBytes(row: SqlRow & { body: Uint8Array }, prior: SqlRow & { body: Uint8Array }): void {
  if (row.id !== prior.id || row.transition_id !== prior.transition_id || row.slot !== prior.slot
    || !Buffer.from(row.body).equals(prior.body)) invalid();
}
/** Pure identity shared with fresh synchronous contexts; no read-owner lifetime or stored verdict escapes. */
export function transitionProjectionKey(input: ProjectionInput): string {
  const { evidence, nativeBaseline, ...rest } = input;
  const identity = { ...rest, evidence: evidence.evidenceId,
    nativeBaseline: nativeBaseline ? { ...nativeBaseline, evidence: nativeBaseline.evidence.evidenceId } : nativeBaseline };
  // Rest includes future semantic fields automatically. Keep explicit undefined different from an omitted key.
  const entries = Object.entries(identity).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([key, value]) => [key, value === undefined ? ["undefined"] : ["value", value]]);
  return transitionLocalHash(["taki-transition-observation-bank.v1", entries]);
}
export function freezeEvidenceJson(value: unknown): void {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return;
  for (const item of Object.values(value)) freezeEvidenceJson(item);
  Object.freeze(value);
}
function invalid(): never { throw new Error("MEMORY_TRANSITION_PROOF_INVALID"); }
