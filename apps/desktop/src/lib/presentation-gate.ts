/**
 * INPUT:  a "surface this reply unit" request (a callback that reveals bubble text / plays an avatar command).
 * OUTPUT: createPresentationGate(ready) + a window-shared gate; present(surface) runs surface once the unit is ready.
 * POS:    ui/lib — the ONE presentation gate (D21/TTS seam). Streamed reply text (F2) AND the LLM avatar command
 *         (F3) surface through the SAME gate so they appear together. v1 ready = immediate; #31 injects audio-ready.
 */

// The reserved TTS slot: v1 resolves immediately (plain streaming). #31 swaps in a signal that fires when a reply
// unit's synthesized audio is ready, so text + expression + voice surface in sync with zero call-site changes.
export interface PresentationReady {
  whenReady(surface: () => void): void;
}

export const immediateReady: PresentationReady = { whenReady: (surface) => surface() };

export interface PresentationGate {
  /** Presents a reply unit as soon as it is cleared to surface (v1: now; #31: when audio is ready). */
  present(surface: () => void): void;
}

export function createPresentationGate(ready: PresentationReady = immediateReady): PresentationGate {
  return { present: (surface) => ready.whenReady(surface) };
}

// Window-scoped shared instance: both the chat delta stream and the avatar command consumer call THIS gate so a
// reply's text and its expression present together. Mutable ready keeps the #31 slot open without touching callers.
let sharedReady: PresentationReady = immediateReady;

export const sharedPresentationGate: PresentationGate = { present: (surface) => sharedReady.whenReady(surface) };

/** #31 fills the reserved slot: install an audio-ready signal so replies wait for synthesis before surfacing. */
export function setSharedPresentationReady(ready: PresentationReady): void {
  sharedReady = ready;
}
