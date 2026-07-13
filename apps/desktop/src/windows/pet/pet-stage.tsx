/**
 * INPUT:  avatar state from the Zustand store; the pet canvas host DOM node.
 * OUTPUT: <PetStage> — the PixiJS canvas host that mounts the Live2D renderer scene, drives its render tier from
 *         avatar state, wires the render governor + window drag, and reveals the window after first paint.
 * POS:    ui/renderer bridge — the ONLY component allowed to touch renderer/ APIs. Root remains transparent
 *         (no opaque background) so the overlay stays a per-pixel cut-out.
 */

import { useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { createPetScene, type PetScene } from "@/renderer/pet-scene.js";
import { useAvatarStore } from "@/stores/avatar-store.js";
import { usePetDrag } from "./use-pet-drag.ts";
import { useRenderGovernor } from "./use-render-governor.ts";

export function PetStage() {
  const hostRef = useRef<HTMLDivElement>(null);
  const [scene, setScene] = useState<PetScene | null>(null);
  const avatarState = useAvatarStore((s) => s.state);
  const drag = usePetDrag();
  useRenderGovernor(scene?.governor ?? null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let disposed = false;
    let mounted: PetScene | null = null;
    void createPetScene(host)
      .then((next) => {
        if (disposed) return next.dispose();
        mounted = next;
        setScene(next);
        // Revealed only after the first paint so the transparent overlay never flashes an empty frame.
        void getCurrentWindow().show().catch(() => undefined);
      })
      .catch((error: unknown) => {
        // A load failure must not leave a visible:false window stuck invisible forever — degrade visibly.
        console.error("pet scene failed to load", error);
        if (!disposed) void getCurrentWindow().show().catch(() => undefined);
      });
    return () => {
      disposed = true;
      mounted?.dispose();
      setScene(null);
    };
  }, []);

  useEffect(() => {
    scene?.setAvatarState(avatarState);
  }, [scene, avatarState]);

  return <div ref={hostRef} className="h-full w-full" {...drag} />;
}
