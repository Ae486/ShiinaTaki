/**
 * INPUT:  a characterId + costume + settings-file basename + the costume's external-ref resolution map
 *         (character.costumes / character.costumeResolution results).
 * OUTPUT: costumeSettingsSegments / resolveSettingsFile / resolveResourcePath (pure) + characterCostumeUrl +
 *         costumeAssetResolver (settings URL + attached costume identity + per-resource asset URL resolver).
 * POS:    ui/lib — the Tauri seam turning a Workspace model path into fetchable asset URLs. Keeps convertFileSrc OUT
 *         of renderer/ (framework-free). A null resolve = the caller STRIPS the ref: `..` never reaches convertFileSrc.
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

export interface ResolvedResource {
  kind: "costume" | "characters"; // which root the segments are relative to (the costume dir vs the characters/ root)
  segments: string[];
}

/**
 * Classify a manifest resource ref against the Core's external-ref resolution map. A plain ref stays costume-relative;
 * a ref the Core resolved becomes characters-root-relative; anything unresolved or still containing `..` is null —
 * the FAIL-SAFE: null means the caller strips the entry, so a traversal ref never reaches convertFileSrc (#18).
 */
export function resolveResourcePath(ref: string, resolution: Record<string, string | null>): ResolvedResource | null {
  // Cubism 3 manifests carry optional file slots (physics/pose); the engine's replaceFiles passes their null/undefined
  // straight through its `string` type — treat any non-string/empty ref as unresolvable rather than crash (B13).
  if (typeof (ref as unknown) !== "string" || ref.length === 0) return null;
  const mapped = resolution[ref];
  if (mapped === null) return null; // the Core searched every imported character and found nothing
  if (mapped !== undefined) return mapped.includes("..") ? null : { kind: "characters", segments: resourceSegments(mapped) };
  if (ref.includes("..")) return null; // external ref without a resolution entry — never joined, never fetched
  return { kind: "costume", segments: resourceSegments(ref) };
}

export interface CostumeAssetResolver {
  /** The costume settings-file asset: URL — passed as ModelSettings.url. */
  settingsUrl: string;
  /** Stable identity carried into the scene only after this source actually attaches. */
  costumeId: string;
  /**
   * Maps a settings-relative resource ref to its OWN absolute asset: URL, or null when the ref is unresolvable
   * (external ref no imported character supplies, or any `..`-bearing path) — the caller strips null entries BEFORE
   * the engine sees them (settings-prune). Absolute per-file URLs bypass the engine's relative resolveURL, which
   * would drop the convertFileSrc-encoded prefix (see research/rc-asset-suburl-defect.md).
   */
  resolve: (relPath: string) => string | null;
}

/** Resolves a costume's settings URL + a per-sub-resource absolute-asset-URL function (Tauri stays in this layer). */
export async function costumeAssetResolver(deps: {
  characterId: string;
  costume: string;
  settingsFile: string;
  resolution: Record<string, string | null>; // from character.costumeResolution ({} for a self-contained costume)
}): Promise<CostumeAssetResolver> {
  const charactersDir = await join(await homeDir(), ".takiagent", "workspace", "characters");
  const costumeDir = await join(charactersDir, deps.characterId, deps.costume);
  const settingsUrl = convertFileSrc(await join(costumeDir, deps.settingsFile));
  const resolve = (relPath: string): string | null => {
    const resolved = resolveResourcePath(relPath, deps.resolution);
    if (resolved === null) return null;
    return convertFileSrc(joinResolved(resolved.kind === "characters" ? charactersDir : costumeDir, resolved.segments));
  };
  return { settingsUrl, costumeId: deps.costume, resolve };
}

// convertFileSrc needs a device path; the OS separator only has to round-trip through it, and the asset protocol
// canonicalizes separators, so a forward-slash join of the (already absolute) root + relative segments is
// portable — no hardcoded backslash, keeping this usable under the Ubuntu VPS target too (invariant 8).
function joinResolved(root: string, segments: string[]): string {
  return [root, ...segments].join("/");
}

/** Composes the absolute Workspace path for a costume's settings file, then a webview-loadable asset URL. */
export async function characterCostumeUrl(characterId: string, costume: string, settingsFile: string): Promise<string> {
  const absolute = await join(await homeDir(), ...costumeSettingsSegments(characterId, costume, settingsFile));
  return convertFileSrc(absolute);
}
