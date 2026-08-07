/**
 * INPUT:  two consecutive observations of the frozen costume hook (switchingId / error / current) plus, for a command,
 *         the costume list + availability it exposes and whether the PetScene exists.
 * OUTPUT: costumeTransitions(prev, next) -> the result phases to publish; refusalFor(costumeId, view) -> a named reason
 *         or null.
 * POS:    ui/windows/pet — the node-testable core of the costume reporter. The hook owns the switch and keeps its own
 *         guard; this only classifies what that guard did so the home page never waits on silence.
 */

import type { CostumeAvailability } from "@taki/shared";
import type { CostumeResultPayload } from "@/lib/costume-switch-event.js";

export interface CostumeObservation {
  switchingId: string | null;
  error: string | null;
  current: string | null;
}

export const IDLE_OBSERVATION: CostumeObservation = { switchingId: null, error: null, current: null };

export interface CostumeCommandView {
  switchingId: string | null;
  costumes: string[];
  availability: Record<string, CostumeAvailability>;
  /** false = no live PetScene yet, so the switch path would drop the command. */
  ready: boolean;
}

export type CostumeRefusal = "busy" | "no-scene" | "unknown-costume" | "not-renderable";

/** The hook stamps its error as "<costume>: <cause>"; the page names the costume itself, so hand it the cause only. */
function reasonOf(costumeId: string, error: string): string {
  const prefix = `${costumeId}: `;
  return error.startsWith(prefix) ? error.slice(prefix.length) : error;
}

// The hook releases a switch in one batched update, so the settling render carries the verdict: an error means it threw,
// an advanced `current` means it landed, and neither means Cancel bumped the generation and swallowed the late outcome.
function settled(costumeId: string, next: CostumeObservation): CostumeResultPayload {
  if (next.error !== null) return { costumeId, phase: "failed", reason: reasonOf(costumeId, next.error) };
  if (next.current === costumeId) return { costumeId, phase: "succeeded" };
  return { costumeId, phase: "cancelled" };
}

export function costumeTransitions(prev: CostumeObservation, next: CostumeObservation): CostumeResultPayload[] {
  if (prev.switchingId === next.switchingId) return [];
  const events: CostumeResultPayload[] = [];
  if (prev.switchingId !== null) events.push(settled(prev.switchingId, next));
  if (next.switchingId !== null) events.push({ costumeId: next.switchingId, phase: "started" });
  return events;
}

/** Mirrors the switch path's own guards so a command it would drop is answered with a reason instead of silence. */
export function refusalFor(costumeId: string, view: CostumeCommandView): CostumeRefusal | null {
  if (view.switchingId !== null) return "busy";
  if (!view.ready) return "no-scene";
  if (!view.costumes.includes(costumeId)) return "unknown-costume";
  if (view.availability[costumeId]?.renderable === false) return "not-renderable";
  return null;
}
