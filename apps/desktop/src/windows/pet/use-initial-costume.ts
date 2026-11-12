/**
 * INPUT:  the live PetScene, authenticated pet client generations, and the remembered last-worn costume.
 * OUTPUT: useInitialCostume(scene) - retryable dev-to-imported promotion that latches at renderer attachment.
 * POS:    ui/windows/pet - React adapter over the D61 promotion controller; reconnect never reloads a committed scene.
 */

import { useEffect, useMemo } from "react";
import type { CharacterCostumesResult } from "@taki/shared";
import { ACTIVE_CHARACTER_ID } from "@/lib/active-character.js";
import { notifyCostumeSceneChanged } from "@/lib/costume-scene-event.js";
import { startCostumeSwitchAttempt } from "@/lib/costume-switch-attempt.js";
import { loadLastCostume, saveLastCostume } from "@/lib/last-costume.js";
import { useConnectionStore } from "@/stores/connection-store.js";
import type { PetScene } from "@/renderer/pet-scene.js";
import {
  createInitialPromotionController,
  type InitialPromotionAttemptInput,
  type InitialPromotionController,
} from "./initial-costume-promotion.ts";

function pickCostume(costumes: CharacterCostumesResult): string {
  const remembered = loadLastCostume(ACTIVE_CHARACTER_ID, localStorage);
  if (remembered === null || !costumes.costumes.includes(remembered)) return costumes.defaultCostume;
  return (costumes.availability?.[remembered]?.renderable ?? true) ? remembered : costumes.defaultCostume;
}

function startPromotionAttempt(input: InitialPromotionAttemptInput) {
  return startCostumeSwitchAttempt({
    client: input.client,
    scene: input.scene,
    costume: input.costume,
    onCommit: input.onCommit,
  });
}

function saveCommittedPromotion(costumeId: string): void {
  notifyCostumeSceneChanged();
  try {
    saveLastCostume(ACTIVE_CHARACTER_ID, costumeId, localStorage);
  } catch (cause) {
    console.warn(`[initial-costume] committed ${costumeId}, but last-costume persistence failed`, cause);
  }
}

function createController(): InitialPromotionController {
  return createInitialPromotionController({
    characterId: ACTIVE_CHARACTER_ID,
    pickCostume,
    startAttempt: startPromotionAttempt,
    onCommit: (commit) => saveCommittedPromotion(commit.costumeId),
    onDiagnostic: (message, cause) => console.warn(`[initial-costume] ${message}`, cause),
  });
}

export function useInitialCostume(scene: PetScene | null): void {
  const client = useConnectionStore((state) => state.client);
  const connected = useConnectionStore((state) => state.status.kind === "connected");
  const controller = useMemo(() => (scene ? createController() : null), [scene]);

  useEffect(() => {
    if (!scene || !client || !connected || !controller) return;
    if (scene.reportSnapshot().costume !== undefined) {
      controller.markCommitted();
      return;
    }
    void controller.start(client, scene);
    return () => controller.interrupt();
  }, [scene, client, connected, controller]);
}
