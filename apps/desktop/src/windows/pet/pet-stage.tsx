/**
 * INPUT:  avatar state from the Zustand store; the pet canvas host DOM node; wheel open state (interaction store).
 * OUTPUT: <PetStage> — the PixiJS canvas host that mounts the Live2D renderer scene, drives its render tier from
 *         avatar state, wires the render governor + window drag + per-pixel click-through + initial imported costume,
 *         reveals the window after first paint, summons the operation wheel on right-click, and executes costume
 *         switches commanded by the home window's costume page.
 * POS:    ui/renderer bridge — the ONLY component allowed to touch renderer/ APIs. Root remains transparent
 *         (no opaque background) so the overlay stays a per-pixel cut-out.
 */

import { useEffect, useRef } from "react";
import { useAvatarStore } from "@/stores/avatar-store.js";
import { useInteractionStore } from "@/stores/interaction-store.js";
import { ChatBubble } from "@/features/chat-bubble/chat-bubble.js";
import { OperationWheel } from "@/features/operation-wheel/operation-wheel.js";
import { summonWheel } from "@/features/operation-wheel/wheel-summon.js";
import { ToastHost } from "@/components/toast/toast-host.js";
import { usePetScene } from "./use-pet-scene.ts";
import { usePetDrag } from "./use-pet-drag.ts";
import { usePetClick } from "./use-pet-click.ts";
import { useCoreConnection } from "./use-core-connection.ts";
import { useRenderGovernor } from "./use-render-governor.ts";
import { useClickThrough } from "./use-click-through.ts";
import { useInitialCostume } from "./use-initial-costume.ts";
import { useCostumeSwitchEvent } from "./use-costume-switch-event.ts";

export function PetStage() {
  const hostRef = useRef<HTMLDivElement>(null);
  const { scene, error: sceneError } = usePetScene(hostRef);
  const avatarState = useAvatarStore((s) => s.state);
  const wheelOpen = useInteractionStore((s) => s.wheelOpen);
  const wheelPoint = useInteractionStore((s) => s.wheelPoint);
  const openWheel = useInteractionStore((s) => s.openWheel);
  const closeWheel = useInteractionStore((s) => s.closeWheel);
  const onPetClick = usePetClick(scene);
  const drag = usePetDrag(onPetClick);
  useRenderGovernor(scene?.governor ?? null);
  const clickThrough = useClickThrough(scene);
  useCoreConnection(scene);
  useInitialCostume(scene);
  useCostumeSwitchEvent(scene);

  useEffect(() => {
    scene?.setAvatarState(avatarState);
  }, [scene, avatarState]);

  return (
    <div
      ref={hostRef}
      className="relative h-full w-full"
      // Right-click summons the operation wheel at the cursor (left-click stays the touch reaction + bubble, #16).
      onContextMenu={(event) => summonWheel(event, openWheel)}
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
      {wheelOpen && <OperationWheel point={wheelPoint} onClose={closeWheel} />}
      <ToastHost />
    </div>
  );
}
