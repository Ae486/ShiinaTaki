/**
 * INPUT:  a costume pick on the home window's costume page (outbound) / a Tauri event payload (inbound, pet window).
 * OUTPUT: COSTUME_SWITCH_EVENT + CostumeSwitchPayload + requestCostumeSwitch(costumeId) + parseCostumeSwitch(payload)
 *         + handleCostumeSwitch(payload, sink) — the pet-side listener body.
 * POS:    ui/lib — the home→pet costume seam. The live PetScene exists ONLY in the pet window, so the page COMMANDS
 *         and the pet executes its existing switch path. Presentation-only: the state of record still rides the pet's
 *         WS persist, so nothing here is a second writer.
 */

import { emitTo } from "@tauri-apps/api/event";

const PET_LABEL = "pet";

export const COSTUME_SWITCH_EVENT = "pet:costume-switch";

export interface CostumeSwitchPayload {
  costumeId: string;
}

/** Commands the pet window to wear `costumeId`. Rejects if the event cannot be delivered (the page toasts it). */
export async function requestCostumeSwitch(costumeId: string): Promise<void> {
  await emitTo(PET_LABEL, COSTUME_SWITCH_EVENT, { costumeId } satisfies CostumeSwitchPayload);
}

/** The pet-side gate: an unparseable payload yields null and is dropped with a breadcrumb, never thrown in a callback. */
export function parseCostumeSwitch(payload: unknown): CostumeSwitchPayload | null {
  if (typeof payload !== "object" || payload === null || !("costumeId" in payload)) return null;
  const { costumeId } = payload as { costumeId: unknown };
  return typeof costumeId === "string" && costumeId.length > 0 ? { costumeId } : null;
}

export interface CostumeSwitchSink {
  apply: (costumeId: string) => void;
  warn: (message: string, payload: unknown) => void;
}

/** The listener body, extracted pure: a valid payload drives the switch, anything else only leaves a breadcrumb. */
export function handleCostumeSwitch(payload: unknown, sink: CostumeSwitchSink): void {
  const parsed = parseCostumeSwitch(payload);
  if (parsed) sink.apply(parsed.costumeId);
  else sink.warn("[pet] ignored malformed costume-switch payload", payload);
}
