/**
 * INPUT:  the /lab-characters/ listing JSON ({ root, characters: [{ id, character }] }) + the page origin.
 * OUTPUT: parseCatalog(listing) -> CatalogEntry[] (one per costume, generation by settings suffix);
 *         toCostumeSource(entry, origin) -> CostumeSource whose resolve() nulls `..`/absolute refs so pruneSettings
 *         strips them; countPrunedRefs(settingsJson, resolve) -> the badge count.
 * POS:    experimental / lab — not in production path; pure, node-testable. Reuses the production CostumeSource shape
 *         and pruneSettings unmodified (via @/ alias).
 */

import type { CostumeSource } from "@/renderer/live2d/load-character-model.js";
import { pruneSettings, type ResolveRef } from "@/renderer/live2d/settings-prune.js";
import type { Generation } from "./param-access.ts";

export const CATALOG_PREFIX = "/lab-characters";

export interface CatalogEntry {
  characterId: string;
  costume: string;
  /** Root-relative dev-server path of the settings JSON (model.json / *.model3.json). */
  settingsUrl: string;
  generation: Generation;
  isDefault: boolean;
}

interface CharacterManifest {
  characterId: string;
  costumes: string[];
  defaultCostume?: string;
  settingsFilesByCostume: Record<string, string>;
}

export function parseCatalog(listing: unknown): CatalogEntry[] {
  const characters = asRecord(listing)?.characters;
  if (!Array.isArray(characters)) return [];
  const entries: CatalogEntry[] = [];
  for (const item of characters) {
    const id = asRecord(item)?.id;
    const manifest = toManifest(asRecord(item)?.character);
    if (typeof id !== "string" || manifest === null) continue;
    for (const costume of manifest.costumes) {
      const file = manifest.settingsFilesByCostume[costume];
      if (file === undefined) continue;
      entries.push({
        characterId: manifest.characterId,
        costume,
        settingsUrl: [CATALOG_PREFIX, id, costume, file].map((seg, i) => (i === 0 ? seg : encodeURIComponent(seg))).join("/"),
        generation: file.endsWith(".model3.json") ? "cubism3" : "cubism2",
        isDefault: costume === manifest.defaultCostume,
      });
    }
  }
  return entries;
}

/** Sibling refs resolve against the settings file's directory; `..` and absolute refs are refused (-> pruned). */
export function toCostumeSource(entry: CatalogEntry, origin: string): CostumeSource {
  const settingsUrl = new URL(entry.settingsUrl, origin).href;
  return {
    settingsUrl,
    costumeId: `${entry.characterId}/${entry.costume}`,
    resolve: (ref) => (isConfinedRef(ref) ? new URL(ref, settingsUrl).href : null),
  };
}

export function countPrunedRefs(settingsJson: Record<string, unknown>, resolve: ResolveRef): number {
  const { prunedMotions, prunedExpressions } = pruneSettings(settingsJson, resolve);
  return prunedMotions + prunedExpressions;
}

function isConfinedRef(ref: string): boolean {
  // Cubism 3 manifests carry optional file slots (Pose/Physics) as null; the engine's replaceFiles hands those to the
  // resolver as-is (every imported C3 costume has Pose=null). Same guard as production resolveResourcePath.
  if (typeof (ref as unknown) !== "string" || ref.length === 0) return false;
  if (ref.includes("..")) return false;
  if (ref.startsWith("/") || ref.startsWith("\\")) return false;
  return !/^[a-z][a-z0-9+.-]*:/iu.test(ref);
}

function toManifest(value: unknown): CharacterManifest | null {
  const record = asRecord(value);
  if (record === undefined) return null;
  const { characterId, costumes, defaultCostume, settingsFilesByCostume } = record;
  if (typeof characterId !== "string" || !Array.isArray(costumes)) return null;
  const files = asRecord(settingsFilesByCostume);
  if (files === undefined) return null;
  const stringFiles: Record<string, string> = {};
  for (const [costume, file] of Object.entries(files)) if (typeof file === "string") stringFiles[costume] = file;
  return {
    characterId,
    costumes: costumes.filter((c): c is string => typeof c === "string"),
    defaultCostume: typeof defaultCostume === "string" ? defaultCostume : undefined,
    settingsFilesByCostume: stringFiles,
  };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}
