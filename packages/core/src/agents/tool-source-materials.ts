/**
 * INPUT: a trusted tool producer's completed output and optional known material descriptions
 * OUTPUT: non-serialized source sidecars on the unchanged result object
 * POS: core/agents — descriptive result metadata only; actual SDK completion owns registration and scope
 */
import { ToolSourceMaterialSchema, type ToolSourceMaterial } from "@taki/shared";

const MATERIALS = Symbol("taki.tool-source-materials");
export function withToolSourceMaterials<T extends object>(output: T, materials: readonly ToolSourceMaterial[]): T {
  Object.defineProperty(output, MATERIALS, { value: Object.freeze(materials.map((item) => Object.freeze(ToolSourceMaterialSchema.parse(item)))), enumerable: false });
  return output;
}
export function toolSourceMaterials(output: unknown): readonly ToolSourceMaterial[] | undefined {
  return typeof output === "object" && output !== null
    ? (output as Record<PropertyKey, unknown>)[MATERIALS] as readonly ToolSourceMaterial[] | undefined : undefined;
}
