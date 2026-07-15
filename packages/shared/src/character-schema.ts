/**
 * INPUT:  candidate character.* params/result payloads (parsed WS frames from a Pet UI operator)
 * OUTPUT: CHARACTER_METHODS + import/list/costumes param & result schemas + CharacterImportErrorSchema + CharacterIdSchema
 * POS:    shared/protocol — the character-import + costume contract (#18, invariants 3, 7); operator-only, NO Rust mirror
 */
import { z } from "zod";

export const CHARACTER_METHODS = {
  import: "character.import", // operator → core: extract an uploaded archive into the Workspace characters/ subtree
  list: "character.list", // operator → core: enumerate imported characters (feeds the switch affordance + M5 roster)
  costumes: "character.costumes", // operator → core: the costumes of one character (+ settings filenames for the renderer)
} as const;

// characterId is the addressable key + a path segment under characters/; a strict slug keeps it a single safe segment.
export const CharacterIdSchema = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/);
export type CharacterId = z.infer<typeof CharacterIdSchema>;

export const CharacterSourceSchema = z.enum(["zip", "zst", "folder-archive"]);
export type CharacterSource = z.infer<typeof CharacterSourceSchema>;

// The settings-file basename per costume — the renderer composes <workspace>/characters/<id>/<costume>/<settingsFile>
// and never guesses the manifest name (prd §4.2 lock).
const SettingsFilesByCostumeSchema = z.record(z.string(), z.string());

export const CharacterImportParamsSchema = z.object({
  sourceKind: CharacterSourceSchema,
  archiveBase64: z.string().min(1), // the picked archive bytes, base64 (reuses #17's file-pick→bytes seam)
  fileName: z.string().min(1), // the picked name; its stem seeds characterId when none is supplied
  characterId: CharacterIdSchema.optional(),
});
export type CharacterImportParams = z.infer<typeof CharacterImportParamsSchema>;

export const CharacterImportResultSchema = z.object({
  characterId: CharacterIdSchema,
  costumes: z.array(z.string().min(1)),
  defaultCostume: z.string().min(1),
  settingsFilesByCostume: SettingsFilesByCostumeSchema,
  warnings: z.array(z.string()), // optional-resource misses (tolerated at load); never a hard failure
});
export type CharacterImportResult = z.infer<typeof CharacterImportResultSchema>;

export const CharacterListParamsSchema = z.object({});
export type CharacterListParams = z.infer<typeof CharacterListParamsSchema>;

export const CharacterSummarySchema = z.object({
  characterId: CharacterIdSchema,
  costumes: z.array(z.string().min(1)),
  defaultCostume: z.string().min(1),
  settingsFilesByCostume: SettingsFilesByCostumeSchema,
  source: CharacterSourceSchema,
});
export type CharacterSummary = z.infer<typeof CharacterSummarySchema>;

export const CharacterListResultSchema = z.object({
  characters: z.array(CharacterSummarySchema),
});
export type CharacterListResult = z.infer<typeof CharacterListResultSchema>;

export const CharacterCostumesParamsSchema = z.object({
  characterId: CharacterIdSchema,
});
export type CharacterCostumesParams = z.infer<typeof CharacterCostumesParamsSchema>;

export const CharacterCostumesResultSchema = z.object({
  costumes: z.array(z.string().min(1)),
  defaultCostume: z.string().min(1),
  settingsFilesByCostume: SettingsFilesByCostumeSchema,
  current: z.string().optional(), // the live-loaded costume is client-side state; the Core leaves this unset in v1
});
export type CharacterCostumesResult = z.infer<typeof CharacterCostumesResultSchema>;

// Clean-room import-failure vocabulary (from the BanG Dream reference's error codes). These are import-domain codes that
// ride error.data on the WS envelope — they do NOT extend the Rust-mirrored ErrorCode enum (operator-only, no node parse).
export const CharacterImportErrorSchema = z.enum([
  "no_model_json", // no model.json / *.model.json / *.model3.json found in the archive
  "bad_model_json", // a manifest exists but did not parse as JSON
  "missing_moc", // the essential moc/moc3 geometry is absent
  "missing_textures", // an essential texture reference is absent
  "unsafe_resource_path", // an archive member or resource ref escaped its dir (traversal / absolute)
  "bad_zip", // the archive is not a readable zip
  "bad_zst", // the archive is not a readable zstd+tar stream
  "name_exists", // a character with this id is already imported
  "invalid_name", // the derived/supplied characterId is not a valid slug
]);
export type CharacterImportError = z.infer<typeof CharacterImportErrorSchema>;
