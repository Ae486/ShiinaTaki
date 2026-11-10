/**
 * INPUT:  pet:costume-switch / pet:costume-cancel Tauri events from the home costume page + the live PetScene.
 * OUTPUT: useCostumeSwitchEvent(scene) — runs the EXISTING switch path and publishes pet:costume-result for every phase
 *         it goes through, refusals included.
 * POS:    ui/windows/pet — the pet half of the bidirectional costume seam. D61's attempt controller remains the single
 *         guard/deadline/cancel/commit owner; this adapter ensures none of its command outcomes stays silent to Home.
 */

import { useEffect, useRef } from "react";
import {
  COSTUME_CANCEL_EVENT,
  COSTUME_SWITCH_EVENT,
  handleCostumeCancel,
  handleCostumeSwitch,
  publishCostumeResult,
  type CostumeResultPayload,
} from "@/lib/costume-switch-event.js";
import { useTauriEvent } from "@/lib/use-tauri-event.js";
import { useCostumeSwitch } from "@/features/character-import/use-costume-switch.js";
import type { PetScene } from "@/renderer/pet-scene.js";
import { useConnectionStore } from "@/stores/connection-store.js";
import {
  costumeTransitions,
  refusalFor,
  IDLE_OBSERVATION,
  type CostumeCommandView,
  type CostumeObservation,
} from "./costume-report.ts";

interface CostumeBridge {
  view: CostumeCommandView;
  switchTo: (costumeId: string) => Promise<void>;
  cancelSwitch: () => void;
}

function report(result: CostumeResultPayload): void {
  void publishCostumeResult(result).catch((error: unknown) => console.error("[pet] costume-result undeliverable", error));
}

// A refused command must ANSWER: the switch path returns silently on each of its guards, which is what left the home
// page highlighting a costume nothing wore. Accepted commands say nothing here — their phases ride the state transitions.
function commandSwitch(bridge: CostumeBridge, costumeId: string): void {
  const refusal = refusalFor(bridge.view);
  if (refusal === null) {
    void bridge.switchTo(costumeId);
    return;
  }
  console.warn(`[pet] refused costume switch ${costumeId}: ${refusal}`);
  report({ costumeId, phase: "failed", reason: refusal });
}

function commandCancel(bridge: CostumeBridge, costumeId: string): void {
  if (bridge.view.switchingId !== costumeId) {
    console.warn(`[pet] ignored costume cancel for ${costumeId} (in flight: ${bridge.view.switchingId ?? "none"})`);
    return;
  }
  bridge.cancelSwitch(); // the release surfaces as a transition, which publishes the cancelled phase
}

export function useCostumeSwitchEvent(scene: PetScene | null): void {
  const { switchTo, cancelSwitch, switchingId, error, current } = useCostumeSwitch(scene);
  const connected = useConnectionStore((state) => state.status.kind === "connected");
  const view: CostumeCommandView = { switchingId, ready: scene !== null && connected };
  // Listener callbacks outlive the render that registered them, so they reach the hook through a ref, never a closure.
  const bridge = useRef<CostumeBridge>({ view, switchTo, cancelSwitch });
  const observed = useRef<CostumeObservation>(IDLE_OBSERVATION);

  useEffect(() => {
    bridge.current = { view, switchTo, cancelSwitch };
  });

  useEffect(() => {
    const next = { switchingId, error, current };
    for (const result of costumeTransitions(observed.current, next)) report(result);
    observed.current = next;
  }, [switchingId, error, current]);

  useTauriEvent(COSTUME_SWITCH_EVENT, (payload) =>
    handleCostumeSwitch(payload, {
      apply: (costumeId) => commandSwitch(bridge.current, costumeId),
      warn: (message, dropped) => console.warn(message, dropped),
    }),
  );
  useTauriEvent(COSTUME_CANCEL_EVENT, (payload) =>
    handleCostumeCancel(payload, {
      apply: (costumeId) => commandCancel(bridge.current, costumeId),
      warn: (message, dropped) => console.warn(message, dropped),
    }),
  );
}
