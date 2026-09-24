/**
 * INPUT:  Core SQLite wrapper and validated Hindsight setup projections
 * OUTPUT: singleton setup snapshot persistence with optimistic revision checks, plus the reviewed fingerprint and the
 *         deployment mode it was reviewed under (migration 050; Core-internal, not part of the Shared snapshot)
 * POS:    core/db — sanitized B3 state repository; no secret values, raw HTTP, or Memory Authority writes
 */
import { HindsightDeploymentModeSchema, HindsightSetupSnapshotSchema, type HindsightDeploymentMode, type HindsightSetupSnapshot } from "@taki/shared";
import { z } from "zod";
import type { Database } from "./sqlite.ts";

export interface HindsightConnectionRepo {
  read(banks?: HindsightSetupSnapshot["banks"]): HindsightSetupSnapshot;
  /**
   * A given mode is the one the snapshot's fingerprint was reviewed under; without one the stored mode survives only while
   * the fingerprint is unchanged, so a mode never outlives the fingerprint it vouches for.
   */
  save(snapshot: HindsightSetupSnapshot, expectedRevision: number, reviewedDeploymentMode?: HindsightDeploymentMode): HindsightSetupSnapshot;
  /** A NULL mode is a row reviewed before migration 050 (or never reviewed). */
  reviewed(): HindsightReviewedConnection;
}

export interface HindsightReviewedConnection { configFingerprint: string | null; deploymentMode: HindsightDeploymentMode | null }

export function createHindsightConnectionRepo(db: Database): HindsightConnectionRepo {
  return {
    read: (banks = []) => parseRow(db.prepare("SELECT * FROM hindsight_connection_state WHERE singleton=1").get(), banks),
    save: (snapshot, expectedRevision, reviewedDeploymentMode) => saveRow(db, { snapshot, expectedRevision, reviewedDeploymentMode }),
    reviewed: () => {
      const row = db.prepare("SELECT config_fingerprint, reviewed_deployment_mode FROM hindsight_connection_state WHERE singleton=1").get() ?? {};
      return { configFingerprint: z.string().length(64).nullable().parse(row.config_fingerprint ?? null),
        deploymentMode: HindsightDeploymentModeSchema.nullable().parse(row.reviewed_deployment_mode ?? null) };
    },
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

function saveRow(db: Database, input: {
  snapshot: HindsightSetupSnapshot; expectedRevision: number; reviewedDeploymentMode: HindsightDeploymentMode | undefined;
}): HindsightSetupSnapshot {
  const { expectedRevision } = input;
  const parsed = HindsightSetupSnapshotSchema.parse(input.snapshot);
  if (parsed.revision !== expectedRevision + 1) throw new Error("HINDSIGHT_STATE_CONFLICT");
  const result = db.prepare(`UPDATE hindsight_connection_state SET revision=:revision, phase=:phase, last_successful_phase=:lastSuccessfulPhase, config_fingerprint=:fingerprint, attempt_id=:attemptId, compatibility_json=:compatibility, model_health=:modelHealth, latest_error_json=:latestError, last_attempt_at=:lastAttemptAt, last_success_at=:lastSuccessAt, updated_at=:updatedAt, reviewed_deployment_mode=CASE WHEN :mode IS NOT NULL THEN :mode WHEN config_fingerprint IS :fingerprint THEN reviewed_deployment_mode ELSE NULL END WHERE singleton=1 AND revision=:expected`).run({
    revision: parsed.revision, phase: parsed.phase, lastSuccessfulPhase: parsed.lastSuccessfulPhase, fingerprint: parsed.configFingerprint,
    attemptId: parsed.attemptId, compatibility: parsed.compatibility ? JSON.stringify(parsed.compatibility) : null, modelHealth: parsed.modelHealth,
    latestError: parsed.latestError ? JSON.stringify(parsed.latestError) : null, lastAttemptAt: parsed.lastAttemptAt, lastSuccessAt: parsed.lastSuccessAt,
    updatedAt: parsed.updatedAt, mode: input.reviewedDeploymentMode ?? null, expected: expectedRevision,
  });
  if (result.changes !== 1) throw new Error("HINDSIGHT_STATE_CONFLICT");
  return parsed;
}
