/**
 * INPUT:  a characterId + costume + settings-file basename (settingsFilesByCostume from character.costumes, Phase A).
 * OUTPUT: costumeSettingsSegments (pure Workspace-relative path) + resolveSettingsFile (pure) + characterCostumeUrl
 *         (the Tauri asset: URL a costume's settings file loads from) — what the renderer passes to Live2DModel.from.
 * POS:    ui/lib — the Tauri seam turning a Workspace model path into a fetchable asset URL. Keeps convertFileSrc OUT
 *         of renderer/ (framework-free): the renderer only ever receives a plain URL string. No React imports.
 */

import { convertFileSrc } from "@tauri-apps/api/core";
import { homeDir, join } from "@tauri-apps/api/path";
import type { CharacterCostumesResult } from "@taki/shared";

// The Workspace characters/ layout written by Phase A's character-store:
// <home>/.takiagent/workspace/characters/<characterId>/<costume>/<settingsFile>. The asset-protocol scope in
// tauri.conf.json ($HOME/.takiagent/workspace/characters/**/*) MUST stay in step with these segments.
export function costumeSettingsSegments(characterId: string, costume: string, settingsFile: string): string[] {
  return [".takiagent", "workspace", "characters", characterId, costume, settingsFile];
}

// The manifest filename per costume comes from the Core (never guessed); an unknown costume resolves to null.
export function resolveSettingsFile(costumes: CharacterCostumesResult, costume: string): string | null {
  return costumes.settingsFilesByCostume[costume] ?? null;
}

/** Composes the absolute Workspace path for a costume's settings file, then a webview-loadable asset URL. */
export async function characterCostumeUrl(characterId: string, costume: string, settingsFile: string): Promise<string> {
  const absolute = await join(await homeDir(), ...costumeSettingsSegments(characterId, costume, settingsFile));
  return convertFileSrc(absolute);
}
