/**
 * INPUT:  avatar state from the Zustand store; the pet canvas host DOM node; panel open state (interaction store).
 * OUTPUT: <PetStage> — the PixiJS canvas host that mounts the Live2D renderer scene, drives its render tier from
 *         avatar state, wires the render governor + window drag + per-pixel click-through + initial imported costume,
 *         reveals the window after first paint, and opens the operator character/costume panel on right-click.
 * POS:    ui/renderer bridge — the ONLY component allowed to touch renderer/ APIs. Root remains transparent
 *         (no opaque background) so the overlay stays a per-pixel cut-out.
 */

import { useEffect, useRef } from "react";
import type { PetScene } from "@/renderer/pet-scene.js";
import { useAvatarStore } from "@/stores/avatar-store.js";
import { useInteractionStore } from "@/stores/interaction-store.js";
import { ChatBubble } from "@/features/chat-bubble/chat-bubble.js";
import { CharacterPanel } from "@/features/character-import/character-panel.js";
import { usePetScene } from "./use-pet-scene.ts";
import { usePetDrag } from "./use-pet-drag.ts";
import { usePetClick } from "./use-pet-click.ts";
import { useCoreConnection } from "./use-core-connection.ts";
import { useRenderGovernor } from "./use-render-governor.ts";
import { useClickThrough } from "./use-click-through.ts";
import { useInitialCostume } from "./use-initial-costume.ts";

export function PetStage() {
  const hostRef = useRef<HTMLDivElement>(null);
  const scene: PetScene | null = usePetScene(hostRef);
  const avatarState = useAvatarStore((s) => s.state);
  const panelOpen = useInteractionStore((s) => s.panelOpen);
  const setPanelOpen = useInteractionStore((s) => s.setPanelOpen);
  const onPetClick = usePetClick(scene);
  const drag = usePetDrag(onPetClick);
  useRenderGovernor(scene?.governor ?? null);
  useClickThrough(scene);
  useCoreConnection(scene);
  useInitialCostume(scene);

  useEffect(() => {
    scene?.setAvatarState(avatarState);
  }, [scene, avatarState]);

  return (
    <div
      ref={hostRef}
      className="h-full w-full"
      // Right-click opens the operator character/costume panel (left-click is the chat bubble, #16).
      onContextMenu={(event) => {
        event.preventDefault();
        setPanelOpen(true);
      }}
      {...drag}
    >
      <ChatBubble />
      {panelOpen && <CharacterPanel scene={scene} onClose={() => setPanelOpen(false)} />}
    </div>
  );
}
