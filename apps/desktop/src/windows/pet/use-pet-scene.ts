/**
 * INPUT:  a host-element ref (the pet canvas mount point).
 * OUTPUT: usePetScene(hostRef) -> { scene, error } — the PetScene once created (null while loading); owns its
 *         create→dispose lifecycle, retries transient stage failures, surfaces the final error VISIBLY (pet-stage
 *         renders it), and reveals the window after boot settles (success or failure — never stuck invisible).
 * POS:    ui/windows/pet — the scene mount seam extracted from pet-stage (keeps the bridge component lean). The scene
 *         boots on the dev fallback model (best-effort, may be model-less); use-initial-costume promotes it once
 *         connected (#18).
 */

import { useEffect, useState, type RefObject } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { createPetScene, type PetScene } from "@/renderer/pet-scene.js";

// Stage creation (WebGL context) can fail transiently on a cold boot; a short bounded retry self-heals those runs
// instead of leaving an empty overlay until the next manual restart (the "sometimes invisible" defect class).
const STAGE_ATTEMPTS = 3;
const STAGE_RETRY_MS = 700;

export function usePetScene(hostRef: RefObject<HTMLElement | null>): { scene: PetScene | null; error: string | null } {
  const [scene, setScene] = useState<PetScene | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let disposed = false;
    let mounted: PetScene | null = null;

    const boot = async (): Promise<void> => {
      // Failsafe reveal: if boot HANGS (neither resolves nor rejects), the window must still become visible with
      // its error surface — an invisible pet with zero clue is the worst failure mode this overlay has had.
      const failsafe = window.setTimeout(() => {
        setError((prev) => prev ?? "初始化超时(10s)——渲染启动未完成");
        void getCurrentWindow().show().catch(() => undefined);
      }, 10_000);
      try {
        for (let attempt = 1; attempt <= STAGE_ATTEMPTS; attempt += 1) {
          try {
            const next = await createPetScene(host);
            if (disposed) return next.dispose();
            mounted = next;
            setScene(next);
            setError(null);
            return;
          } catch (cause) {
            console.error(`pet scene failed to load (attempt ${attempt}/${STAGE_ATTEMPTS})`, cause);
            if (disposed) return;
            if (attempt === STAGE_ATTEMPTS) {
              setError(cause instanceof Error ? cause.message : String(cause));
              return;
            }
            await new Promise((resolve) => setTimeout(resolve, STAGE_RETRY_MS));
            if (disposed) return;
          }
        }
      } finally {
        window.clearTimeout(failsafe);
      }
    };
    void boot().finally(() => {
      // Revealed after boot settles (first paint, or the visible error state) — never a stuck invisible window.
      if (!disposed) void getCurrentWindow().show().catch(() => undefined);
    });
    return () => {
      disposed = true;
      mounted?.dispose();
      setScene(null);
    };
  }, [hostRef]);

  return { scene, error };
}
