/**
 * INPUT:  a characterId + costume + settings-file basename (settingsFilesByCostume from character.costumes, Phase A).
 * OUTPUT: costumeSettingsSegments (pure) + resolveSettingsFile (pure) + characterCostumeUrl (settings asset: URL) +
 *         costumeAssetResolver (settings URL + a per-sub-resource asset: URL fn the renderer injects into replaceFiles).
 * POS:    ui/lib — the Tauri seam turning a Workspace model path into fetchable asset URLs. Keeps convertFileSrc OUT
 *         of renderer/ (framework-free): the renderer receives a plain URL + a plain (relPath)=>URL fn. No React imports.
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

/** Split a settings-relative POSIX resource ref (e.g. "data/model.moc", "./x.png") into clean path segments. */
export function resourceSegments(relPath: string): string[] {
  return relPath.split("/").filter((segment) => segment.length > 0 && segment !== ".");
}

export interface CostumeAssetResolver {
  /** The costume settings-file asset: URL — passed as ModelSettings.url. */
  settingsUrl: string;
  /**
   * Maps a settings-relative resource ref to its OWN absolute asset: URL. The renderer feeds this to
   * ModelSettings.replaceFiles so every sub-resource is a full URL — the engine's resolveURL short-circuits a
   * scheme-bearing path and never relative-joins it. This is what fixes the dropped-prefix defect (see
   * research/rc-asset-suburl-defect.md): convertFileSrc encodes the whole device path into one URL segment, so the
   * engine's `new URL(relPath, settingsUrl)` would otherwise resolve `data/model.moc` to the host root.
   */
  file: (relPath: string) => string;
}

/** Resolves a costume's settings URL + a per-sub-resource absolute-asset-URL function (Tauri stays in this layer). */
export async function costumeAssetResolver(
  characterId: string,
  costume: string,
  settingsFile: string,
): Promise<CostumeAssetResolver> {
  const costumeDir = await join(await homeDir(), ".takiagent", "workspace", "characters", characterId, costume);
  const settingsUrl = convertFileSrc(await join(costumeDir, settingsFile));
  const file = (relPath: string): string => convertFileSrc(joinCostumeFile(costumeDir, relPath));
  return { settingsUrl, file };
}

// convertFileSrc needs a device path; the OS separator only has to round-trip through it, and the asset protocol
// canonicalizes separators, so a forward-slash join of the (already absolute) costume dir + relative segments is
// portable — no hardcoded backslash, keeping this usable under the Ubuntu VPS target too (invariant 8).
function joinCostumeFile(costumeDir: string, relPath: string): string {
  return [costumeDir, ...resourceSegments(relPath)].join("/");
}

/** Composes the absolute Workspace path for a costume's settings file, then a webview-loadable asset URL. */
export async function characterCostumeUrl(characterId: string, costume: string, settingsFile: string): Promise<string> {
  const absolute = await join(await homeDir(), ...costumeSettingsSegments(characterId, costume, settingsFile));
  return convertFileSrc(absolute);
}
