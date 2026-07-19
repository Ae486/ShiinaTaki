/**
 * INPUT:  the operator WsClient + the live PetScene + a costume id + its settings filename + a switch timeout budget.
 * OUTPUT: resolveSwitchReport(deps) -> Promise<void>: fetch the costume's external-ref resolution, build its asset
 *         source, reload it in the renderer (timeout-guarded — a timeout/failure aborts the switch so a late model
 *         self-discards), then re-report the re-read vocabulary via avatar.report.
 * POS:    ui/lib — the shared costume switch+report dance used by BOTH the boot promotion (windows/pet/use-initial-costume)
 *         and the manual panel switch (features/character-import/use-costume-switch); the re-report is the arch §6b path.
 */

import { ACTIVE_CHARACTER_ID } from "./active-character.ts";
import { costumeAssetResolver } from "./character-asset-url.ts";
import { withTimeout } from "./promise-timeout.ts";
import type { WsClient } from "./ws-client.ts";
import type { PetScene } from "@/renderer/pet-scene.js";

export interface SwitchReportDeps {
  client: WsClient;
  scene: PetScene;
  costume: string;
  settingsFile: string;
  timeoutMs: number;
}

export async function resolveSwitchReport(deps: SwitchReportDeps): Promise<void> {
  // The resolution feeds pruning so an unresolvable `..` ref never reaches the asset protocol (#18).
  const { resolution } = await deps.client.costumeResolution(ACTIVE_CHARACTER_ID, deps.costume);
  const source = await costumeAssetResolver({
    characterId: ACTIVE_CHARACTER_ID,
    costume: deps.costume,
    settingsFile: deps.settingsFile,
    resolution,
  });
  // Timeout-guarded so a wedged load releases the panel; on ANY failure abort the switch ticket so a late-resolving
  // (slow-but-finite) model self-discards instead of attaching a costume the identity stores never advanced to (drift,
  // 1f Fix 1). The re-report stays DOWNSTREAM of this guard, so a timed-out costume id is never reported.
  const vocabulary = await withTimeout(deps.scene.switchCostume(source), deps.timeoutMs, `costume ${deps.costume}`).catch(
    (cause: unknown) => {
      deps.scene.abortSwitch();
      throw cause;
    },
  );
  // Report the re-read vocabulary AND the worn costume id (deps.costume): the Core diffs the id across turns to inject
  // a one-shot costume-change reminder (1f). Both the panel switch and the boot promotion route through here, so both
  // carry a real id; the boot / drift-self-heal report (use-core-connection) sends none — that path is not this one.
  await deps.client.reportAvatar({ characterId: ACTIVE_CHARACTER_ID, ...vocabulary, costume: deps.costume });
}
