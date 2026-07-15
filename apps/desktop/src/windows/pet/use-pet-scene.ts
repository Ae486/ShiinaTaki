/**
 * INPUT:  a host-element ref (the pet canvas mount point).
 * OUTPUT: usePetScene(hostRef) -> the PetScene once created (null while loading); owns its create→dispose lifecycle
 *         and reveals the window after first paint (or on load failure, so a hidden window never stays stuck).
 * POS:    ui/windows/pet — the scene mount seam extracted from pet-stage (keeps the bridge component lean). The scene
 *         boots on the dev fallback model; use-initial-costume promotes it to an imported costume once connected (#18).
 */

import { useEffect, useState, type RefObject } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { createPetScene, type PetScene } from "@/renderer/pet-scene.js";

export function usePetScene(hostRef: RefObject<HTMLElement | null>): PetScene | null {
  const [scene, setScene] = useState<PetScene | null>(null);

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
  }, [hostRef]);

  return scene;
}
