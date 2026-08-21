/**
 * INPUT:  Core SQLite wrapper and validated Hindsight setup projections
 * OUTPUT: singleton setup snapshot persistence with optimistic revision checks
 * POS:    core/db — sanitized B3 state repository; no secret values, raw HTTP, or Memory Authority writes
 */
import { HindsightSetupSnapshotSchema, type HindsightSetupSnapshot } from "@taki/shared";
import type { Database } from "./sqlite.ts";

export interface HindsightConnectionRepo {
  read(banks?: HindsightSetupSnapshot["banks"]): HindsightSetupSnapshot;
  save(snapshot: HindsightSetupSnapshot, expectedRevision: number): HindsightSetupSnapshot;
}

export function createHindsightConnectionRepo(db: Database): HindsightConnectionRepo {
  return {
    read: (banks = []) => parseRow(db.prepare("SELECT * FROM hindsight_connection_state WHERE singleton=1").get(), banks),
    save: (snapshot, expectedRevision) => saveRow(db, snapshot, expectedRevision),
  };
}

function parseRow(row: unknown, banks: HindsightSetupSnapshot["banks"]): HindsightSetupSnapshot {
  const value = row as Record<string, unknown>;
  return HindsightSetupSnapshotSchema.parse({
    revision: value.revision,
    phase: value.phase,
    lastSuccessfulPhase: value.last_successful_phase,
    configFingerprint: value.config_fingerprint,
    attemptId: value.attempt_id,
    compatibility: value.compatibility_json ? JSON.parse(String(value.compatibility_json)) : null,
    banks,
    modelHealth: value.model_health,
    latestError: value.latest_error_json ? JSON.parse(String(value.latest_error_json)) : null,
    lastAttemptAt: value.last_attempt_at,
    lastSuccessAt: value.last_success_at,
    updatedAt: value.updated_at,
  });
}

function saveRow(db: Database, snapshot: HindsightSetupSnapshot, expectedRevision: number): HindsightSetupSnapshot {
  const parsed = HindsightSetupSnapshotSchema.parse(snapshot);
  if (parsed.revision !== expectedRevision + 1) throw new Error("HINDSIGHT_STATE_CONFLICT");
  const result = db.prepare(`UPDATE hindsight_connection_state SET revision=:revision, phase=:phase, last_successful_phase=:lastSuccessfulPhase, config_fingerprint=:fingerprint, attempt_id=:attemptId, compatibility_json=:compatibility, model_health=:modelHealth, latest_error_json=:latestError, last_attempt_at=:lastAttemptAt, last_success_at=:lastSuccessAt, updated_at=:updatedAt WHERE singleton=1 AND revision=:expected`).run({
    revision: parsed.revision, phase: parsed.phase, lastSuccessfulPhase: parsed.lastSuccessfulPhase, fingerprint: parsed.configFingerprint,
    attemptId: parsed.attemptId, compatibility: parsed.compatibility ? JSON.stringify(parsed.compatibility) : null, modelHealth: parsed.modelHealth,
    latestError: parsed.latestError ? JSON.stringify(parsed.latestError) : null, lastAttemptAt: parsed.lastAttemptAt, lastSuccessAt: parsed.lastSuccessAt,
    updatedAt: parsed.updatedAt, expected: expectedRevision,
  });
  if (result.changes !== 1) throw new Error("HINDSIGHT_STATE_CONFLICT");
  return parsed;
}
