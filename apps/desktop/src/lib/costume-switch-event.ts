/**
 * INPUT:  a costume pick or Cancel on the home window's costume page (outbound) + the pet's switch outcome (inbound);
 *         inside the pet window the same events arrive as Tauri payloads to be gated.
 * OUTPUT: the three event names + payload types, the emit helpers (requestCostumeSwitch / requestCostumeCancel /
 *         publishCostumeResult) and the listener bodies (handleCostumeSwitch / handleCostumeCancel / handleCostumeResult).
 * POS:    ui/lib — the BIDIRECTIONAL home<->pet costume seam. The live PetScene exists only in the pet window, so the page
 *         commands and the pet both executes AND reports back; without the return leg the page cannot tell a failed switch
 *         from a silent one. Presentation only: the state of record still rides the pet's WS persist (no second writer).
 */

import { emitTo } from "@tauri-apps/api/event";

const PET_LABEL = "pet";
const HOME_LABEL = "home";

export const COSTUME_SWITCH_EVENT = "pet:costume-switch";
export const COSTUME_CANCEL_EVENT = "pet:costume-cancel";
export const COSTUME_RESULT_EVENT = "pet:costume-result";

const PHASES = ["started", "succeeded", "failed", "cancelled"] as const;
export type CostumePhase = (typeof PHASES)[number];

export interface CostumeSwitchPayload {
  costumeId: string;
}

export interface CostumeResultPayload {
  costumeId: string;
  phase: CostumePhase;
  /** Why a `failed` phase failed: a refusal word or the switch's own error text. */
  reason?: string;
}

/** Commands the pet window to wear `costumeId`. Resolving means DELIVERED, not switched — only a result says that. */
export async function requestCostumeSwitch(costumeId: string): Promise<void> {
  await emitTo(PET_LABEL, COSTUME_SWITCH_EVENT, { costumeId } satisfies CostumeSwitchPayload);
}

/** Operator Cancel: asks the pet to abort its in-flight switch. The page releases itself without awaiting the answer. */
export async function requestCostumeCancel(costumeId: string): Promise<void> {
  await emitTo(PET_LABEL, COSTUME_CANCEL_EVENT, { costumeId } satisfies CostumeSwitchPayload);
}

/** The pet's report of what a commanded switch actually did — the page's ONLY truth about the worn costume. */
export async function publishCostumeResult(result: CostumeResultPayload): Promise<void> {
  await emitTo(HOME_LABEL, COSTUME_RESULT_EVENT, result);
}

function costumeIdOf(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null || !("costumeId" in payload)) return null;
  const { costumeId } = payload as { costumeId: unknown };
  return typeof costumeId === "string" && costumeId.length > 0 ? costumeId : null;
}

function phaseOf(payload: unknown): CostumePhase | null {
  if (typeof payload !== "object" || payload === null || !("phase" in payload)) return null;
  const { phase } = payload as { phase: unknown };
  return PHASES.find((known) => known === phase) ?? null;
}

/** The pet-side gate: an unparseable payload yields null and is dropped with a breadcrumb, never thrown in a callback. */
export function parseCostumeSwitch(payload: unknown): CostumeSwitchPayload | null {
  const costumeId = costumeIdOf(payload);
  return costumeId === null ? null : { costumeId };
}

/** The home-side gate: same rule for the return leg — an unknown phase is garbage, not a state the page may enter. */
export function parseCostumeResult(payload: unknown): CostumeResultPayload | null {
  const costumeId = costumeIdOf(payload);
  const phase = phaseOf(payload);
  if (costumeId === null || phase === null) return null;
  const { reason } = payload as { reason?: unknown };
  return typeof reason === "string" && reason.length > 0 ? { costumeId, phase, reason } : { costumeId, phase };
}

export interface CostumeCommandSink {
  apply: (costumeId: string) => void;
  warn: (message: string, payload: unknown) => void;
}

export interface CostumeResultSink {
  apply: (result: CostumeResultPayload) => void;
  warn: (message: string, payload: unknown) => void;
}

function gateCommand(payload: unknown, sink: CostumeCommandSink, event: string): void {
  const parsed = parseCostumeSwitch(payload);
  if (parsed) sink.apply(parsed.costumeId);
  else sink.warn(`[pet] ignored malformed ${event} payload`, payload);
}

/** The listener bodies, extracted pure: a valid payload drives the action, anything else only leaves a breadcrumb. */
export function handleCostumeSwitch(payload: unknown, sink: CostumeCommandSink): void {
  gateCommand(payload, sink, "costume-switch");
}

export function handleCostumeCancel(payload: unknown, sink: CostumeCommandSink): void {
  gateCommand(payload, sink, "costume-cancel");
}

export function handleCostumeResult(payload: unknown, sink: CostumeResultSink): void {
  const parsed = parseCostumeResult(payload);
  if (parsed) sink.apply(parsed);
  else sink.warn("[home] ignored malformed costume-result payload", payload);
}
