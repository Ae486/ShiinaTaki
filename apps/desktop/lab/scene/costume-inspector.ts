/**
 * INPUT:  a loaded model's internalModel (motionManager.definitions / expressionManager?.definitions / lipSyncIds), its
 *         ParamAccess, and the expression files fetched from definitions[i].file | File (already absolute URLs after the
 *         loader's replaceFiles — design §3).
 * OUTPUT: fetchFaceParams(internal) -> Record<expression name, FaceParam[]> (async companion; unreadable files -> []);
 *         inspectCostume(internal, params, faceParams) -> CostumeFacts { generation, motionGroups (name -> count),
 *         expressions, lipSyncIds, paramIds (C3 enumeration; null on C2), faceParams, faceSet (id-deduped) }.
 * POS:    experimental / lab — not in production path; engine-facing glue, structural input so it never imports an
 *         engine value.
 */

import { type FaceParam, parseExpressionFile } from "./face-params.ts";
import type { ParamAccess } from "./param-access.ts";

export interface CostumeFacts {
  generation: ParamAccess["generation"];
  motionGroups: Record<string, number>;
  expressions: string[];
  lipSyncIds: string[];
  paramIds: string[] | null;
  /** Declared params per expression name — the "expected value" source for the survives-motion sample. */
  faceParams: Record<string, FaceParam[]>;
  /** Union over all expressions, one entry per id (first declaration wins) — feeds deriveFaceSet. */
  faceSet: FaceParam[];
}

export interface InspectableInternal {
  motionManager: {
    definitions: Partial<Record<string, unknown[]>>;
    expressionManager?: { definitions: unknown[] };
  };
}

export function inspectCostume(internal: InspectableInternal, params: ParamAccess, faceParams: Record<string, FaceParam[]>): CostumeFacts {
  const manager = internal.motionManager;
  const motionGroups: Record<string, number> = {};
  for (const [group, entries] of Object.entries(manager.definitions)) motionGroups[group] = entries?.length ?? 0;
  return {
    generation: params.generation,
    motionGroups,
    expressions: (manager.expressionManager?.definitions ?? []).map(expressionName).filter((n): n is string => n !== null),
    lipSyncIds: readLipSyncIds(manager),
    paramIds: params.listIds(),
    faceParams,
    faceSet: dedupeById(Object.values(faceParams).flat()),
  };
}

export async function fetchFaceParams(internal: InspectableInternal): Promise<Record<string, FaceParam[]>> {
  const definitions = internal.motionManager.expressionManager?.definitions ?? [];
  const entries = await Promise.all(
    definitions.map(async (definition) => {
      const name = expressionName(definition);
      const url = expressionFile(definition);
      if (name === null || url === null) return null;
      return [name, parseExpressionFile(await fetchJson(url))] as const;
    }),
  );
  return Object.fromEntries(entries.filter((e): e is readonly [string, FaceParam[]] => e !== null));
}

async function fetchJson(url: string): Promise<unknown> {
  try {
    const response = await fetch(url);
    return response.ok ? await response.json() : null;
  } catch (err) {
    console.warn(`[lab] expression file unreadable: ${url}`, err);
    return null;
  }
}

// Cubism 2 expression specs carry `name` / `file`, Cubism 3+ carry `Name` / `File` (same narrowing as model-vocabulary).
function expressionName(definition: unknown): string | null {
  return readString(definition, "name") ?? readString(definition, "Name");
}

function expressionFile(definition: unknown): string | null {
  return readString(definition, "file") ?? readString(definition, "File");
}

function readString(definition: unknown, key: string): string | null {
  if (typeof definition !== "object" || definition === null || !(key in definition)) return null;
  const value = (definition as Record<string, unknown>)[key];
  return typeof value === "string" ? value : null;
}

function dedupeById(entries: FaceParam[]): FaceParam[] {
  const seen = new Map<string, FaceParam>();
  for (const entry of entries) if (!seen.has(entry.id)) seen.set(entry.id, entry);
  return [...seen.values()];
}

// lipSyncIds lives on the concrete motion managers (never empty per design §3), not on the abstract MotionManager type.
function readLipSyncIds(manager: object): string[] {
  if (!("lipSyncIds" in manager) || !Array.isArray(manager.lipSyncIds)) return [];
  return manager.lipSyncIds.filter((id): id is string => typeof id === "string");
}
