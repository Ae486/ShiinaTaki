/**
 * INPUT:  one authenticated candidate WsClient, the live PetScene, and its lifecycle generation guard.
 * OUTPUT: restorePetConnection() — guarded avatar callback, truthful scene report, then one observed subscription.
 * POS:    ui/windows/pet — required per-generation restoration before the pet connection may publish connected.
 */

import { ACTIVE_CHARACTER_ID } from "@/lib/active-character.js";
import type { ConnectionGenerationContext } from "@/lib/connection-generation-controller.js";
import {
  costumeReportSync,
  type CostumeReportSyncTracker,
  type CostumeReportTicket,
} from "@/lib/costume-report-sync.js";
import { sharedPresentationGate } from "@/lib/presentation-gate.js";
import type { WsClient } from "@/lib/ws-client.js";
import type { PetScene } from "@/renderer/pet-scene.js";

export interface PetConnectionRestoration {
  client: Pick<WsClient, "onAvatarCommand" | "reportAvatar" | "subscribeAvatar">;
  scene: Pick<PetScene, "applyAvatarCommand" | "reportSnapshot"> | null;
  context: ConnectionGenerationContext;
  reportSync?: CostumeReportSyncTracker;
}

async function reportCurrentScene(input: PetConnectionRestoration): Promise<void> {
  if (!input.context.isCurrent()) return Promise.resolve();
  const snapshot = input.scene?.reportSnapshot() ?? { motions: [], expressions: [] };
  const tracker = input.reportSync ?? costumeReportSync;
  const ticket: CostumeReportTicket | null =
    snapshot.costume === undefined ? null : tracker.begin(snapshot.costume, "reconnect");
  try {
    await input.client.reportAvatar({ characterId: ACTIVE_CHARACTER_ID, ...snapshot });
    if (ticket && input.context.isCurrent()) tracker.synchronized(ticket);
  } catch (cause) {
    if (ticket && input.context.isCurrent()) tracker.recoveryNeeded(ticket, cause);
    throw cause;
  }
}

export async function restorePetConnection(input: PetConnectionRestoration): Promise<void> {
  input.client.onAvatarCommand((command) => {
    if (!input.context.isCurrent() || !input.scene) return;
    sharedPresentationGate.present(() => {
      if (!input.context.isCurrent() || !input.scene) return;
      input.scene.applyAvatarCommand(command, () => {
        void reportCurrentScene(input).catch((cause: unknown) =>
          console.warn("[pet] avatar vocabulary re-report failed", cause),
        );
      });
    });
  });
  await reportCurrentScene(input);
  if (!input.context.isCurrent()) return;
  await input.client.subscribeAvatar(ACTIVE_CHARACTER_ID);
}
