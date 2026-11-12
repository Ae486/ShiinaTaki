/**
 * INPUT: the Core SQLite owner and revision-checked non-secret model profile values
 * OUTPUT: durable draft/applied profile reads and atomic revision publication
 * POS: core/db — model configuration authority; secret values never enter this table
 */
import { z } from "zod";
import { ModelProfileFormSchema, ModelSlotSchema, type ModelSlot } from "@taki/shared";
import type { Database } from "./sqlite.ts";

export const StoredModelProfileSchema = ModelProfileFormSchema.omit({ apiKey: true }).extend({ secretRef: z.string().optional() });
export type StoredModelProfile = z.infer<typeof StoredModelProfileSchema>;
export const AppliedModelProfileSchema = z.object({ revision: z.number().int().nonnegative(), profile: StoredModelProfileSchema,
  source: z.enum(["application", "environment"]).default("application") });
export type AppliedModelProfile = z.infer<typeof AppliedModelProfileSchema>;
export interface ModelProfileRow {
  slot: ModelSlot; revision: number; draft: StoredModelProfile; applied: AppliedModelProfile | null;
  applicationState: "applied" | "draft" | "failed"; issues: string[];
}
const RowSchema = z.object({ slot: ModelSlotSchema, revision: z.number().int().positive(), draft_json: z.string(),
  applied_json: z.string().nullable(), application_state: z.enum(["applied", "draft", "failed"]), issues_json: z.string() });

export function createModelProfileRepo(db: Database) {
  const query = db.prepare("SELECT * FROM model_profiles WHERE slot=:slot");
  const write = db.prepare(`INSERT INTO model_profiles(slot,revision,draft_json,applied_json,application_state,issues_json,updated_at)
    VALUES(:slot,:revision,:draft,:applied,:state,:issues,:at) ON CONFLICT(slot) DO UPDATE SET revision=excluded.revision,
    draft_json=excluded.draft_json,applied_json=excluded.applied_json,application_state=excluded.application_state,
    issues_json=excluded.issues_json,updated_at=excluded.updated_at`);
  const read = (slot: ModelSlot): ModelProfileRow | null => {
    const raw = query.get({ slot }); if (!raw) return null;
    const row = RowSchema.parse(raw);
    return { slot: row.slot, revision: row.revision, draft: StoredModelProfileSchema.parse(JSON.parse(row.draft_json)),
      applied: row.applied_json === null ? null : AppliedModelProfileSchema.parse(JSON.parse(row.applied_json)),
      applicationState: row.application_state, issues: z.array(z.string()).parse(JSON.parse(row.issues_json)) };
  };
  return { read, save(row: ModelProfileRow, expectedRevision: number): void {
    db.transaction(() => {
      if ((read(row.slot)?.revision ?? 0) !== expectedRevision) throw new Error("MODEL_PROFILE_CONFLICT");
      write.run({ slot: row.slot, revision: row.revision, draft: JSON.stringify(row.draft),
        applied: row.applied === null ? null : JSON.stringify(row.applied), state: row.applicationState,
        issues: JSON.stringify(row.issues), at: new Date().toISOString() });
    });
  } };
}
export type ModelProfileRepo = ReturnType<typeof createModelProfileRepo>;
