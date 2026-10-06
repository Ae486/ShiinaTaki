/**
 * INPUT: one Database/service/selected-receipt lifetime and fully verified immutable native/Bank projection artifacts
 * OUTPUT: byte-matched evidence and frozen pure projections for synchronous observation only; no authority or SQL verdict
 * POS: core/memory/transitions — failed reads discard reuse; each successful read prunes its exact dependency closure
 */
import type { MemoryTransitionNativeEvidence } from "@taki/shared";
import type { Database, SqlRow } from "../../db/sqlite.ts";
import type { HindsightApplicationBundle } from "../hindsight/hindsight-application-bundle.ts";
import type { projectTransitionLocalBank } from "./transition-local-projection.ts";
import { transitionLocalHash } from "./transition-local-encoding.ts";

export interface VerifiedObservationEvidence {
  evidence: MemoryTransitionNativeEvidence; bundle: HindsightApplicationBundle; row: SqlRow & { body: Uint8Array };
}
type ProjectionInput = Omit<Parameters<typeof projectTransitionLocalBank>[0], "verification">;
type Projection = ReturnType<typeof projectTransitionLocalBank>;

/** Only the publication observer owns this store; ordinary verification contexts never create or consult one. */
export class TransitionObservationStore {
  readonly #db: Database;
  #receiptId: string | undefined;
  #active = false; #closed = false;
  readonly #evidence = new Map<string, VerifiedObservationEvidence>();
  readonly #projections = new Map<string, { key: string; value: Projection }>();
  readonly #usedEvidence = new Set<string>(); readonly #usedProjections = new Set<string>();
  constructor(db: Database) { this.#db = db; }

  begin(db: Database, receiptId: string): void {
    if (this.#closed || this.#active || db !== this.#db) invalid();
    if (this.#receiptId !== receiptId) { this.reset(); this.#receiptId = receiptId; }
    this.#active = true; this.#usedEvidence.clear(); this.#usedProjections.clear();
  }
  finish(success: boolean): void {
    this.#active = false;
    if (!success) { this.reset(); return; }
    for (const id of this.#evidence.keys()) if (!this.#usedEvidence.has(id)) this.#evidence.delete(id);
    for (const id of this.#projections.keys()) if (!this.#usedProjections.has(id)) this.#projections.delete(id);
  }
  reset(): void {
    this.#receiptId = undefined; this.#evidence.clear(); this.#projections.clear();
    this.#usedEvidence.clear(); this.#usedProjections.clear();
  }
  close(): void { this.reset(); this.#closed = true; }

  evidence(row: SqlRow & { body: Uint8Array }, load: () => VerifiedObservationEvidence): VerifiedObservationEvidence {
    if (!this.#active || this.#closed) invalid();
    const id = String(row.id); this.#usedEvidence.add(id);
    const saved = this.#evidence.get(id);
    if (saved) { assertObservationBytes(row, saved.row); return saved; }
    const value = load(); assertObservationBytes(row, value.row);
    this.#evidence.set(id, value); return value;
  }

  project(input: ProjectionInput, compute: () => Projection): Projection {
    if (!this.#active || this.#closed) invalid();
    // One current variant per Bank, never an unbounded cache of changing ancestry/mapping combinations.
    const slot = input.scope.localBankId; this.#usedProjections.add(slot);
    const key = projectionKey(input); const old = this.#projections.get(slot);
    if (old?.key === key) return old.value;
    const value = compute(); freezeObservationJson(value);
    this.#projections.set(slot, { key, value }); return value;
  }
}

export function assertObservationBytes(row: SqlRow & { body: Uint8Array }, prior: SqlRow & { body: Uint8Array }): void {
  if (row.id !== prior.id || row.transition_id !== prior.transition_id || row.slot !== prior.slot
    || !Buffer.from(row.body).equals(prior.body)) invalid();
}
function projectionKey(input: ProjectionInput): string {
  const { evidence, nativeBaseline, ...rest } = input;
  const identity = { ...rest, evidence: evidence.evidenceId,
    nativeBaseline: nativeBaseline ? { ...nativeBaseline, evidence: nativeBaseline.evidence.evidenceId } : nativeBaseline };
  // Rest includes future semantic fields automatically. Keep explicit undefined different from an omitted key.
  const entries = Object.entries(identity).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([key, value]) => [key, value === undefined ? ["undefined"] : ["value", value]]);
  return transitionLocalHash(["taki-transition-observation-bank.v1", entries]);
}
export function freezeObservationJson(value: unknown): void {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return;
  for (const item of Object.values(value)) freezeObservationJson(item);
  Object.freeze(value);
}
function invalid(): never { throw new Error("MEMORY_TRANSITION_PROOF_INVALID"); }
