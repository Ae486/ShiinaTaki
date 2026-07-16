/**
 * INPUT:  avatar state from the Zustand store; the pet canvas host DOM node; panel open state (interaction store).
 * OUTPUT: <PetStage> — the PixiJS canvas host that mounts the Live2D renderer scene, drives its render tier from
 *         avatar state, wires the render governor + window drag + per-pixel click-through + initial imported costume,
 *         reveals the window after first paint, and opens the operator character/costume panel on right-click.
 * POS:    ui/renderer bridge — the ONLY component allowed to touch renderer/ APIs. Root remains transparent
 *         (no opaque background) so the overlay stays a per-pixel cut-out.
 */

import { useEffect, useRef } from "react";
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
  const { scene, error: sceneError } = usePetScene(hostRef);
  const avatarState = useAvatarStore((s) => s.state);
  const panelOpen = useInteractionStore((s) => s.panelOpen);
  const setPanelOpen = useInteractionStore((s) => s.setPanelOpen);
  const onPetClick = usePetClick(scene);
  const drag = usePetDrag(onPetClick);
  useRenderGovernor(scene?.governor ?? null);
  const clickThrough = useClickThrough(scene);
  useCoreConnection(scene);
  useInitialCostume(scene);

  useEffect(() => {
    scene?.setAvatarState(avatarState);
  }, [scene, avatarState]);

  return (
    <div
      ref={hostRef}
      className="relative h-full w-full"
      // Right-click opens the operator character/costume panel (left-click is the chat bubble, #16).
      onContextMenu={(event) => {
        event.preventDefault();
        setPanelOpen(true);
      }}
      {...drag}
    >
      {/* Stage/poll failures were previously console-only — an invisible pet with no visible reason (defect 0/B6). */}
      {(sceneError ?? clickThrough.error) && (
        <div className="absolute left-2 top-2 z-10 flex max-w-[90%] flex-col gap-1">
          {sceneError && <div className="rounded bg-red-900/80 px-2 py-1 text-xs text-red-100">渲染初始化失败: {sceneError}</div>}
          {clickThrough.error && (
            <div className="rounded bg-amber-900/80 px-2 py-1 text-xs text-amber-100">穿透轮询错误: {clickThrough.error}</div>
          )}
        </div>
      )}
      <ChatBubble />
      {panelOpen && <CharacterPanel scene={scene} onClose={() => setPanelOpen(false)} />}
    </div>
  );
}
