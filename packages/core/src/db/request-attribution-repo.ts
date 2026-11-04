/**
 * INPUT: primary source lineage, committed model Effects, request measurements and canonical usage.
 * OUTPUT: latest-terminal-primary projection with requested/response model identity and honest usage coverage.
 * POS: core/db — read-only optional observation; no request ledger, prompt storage or cache-window authority.
 */
import { CharacterIdSchema, ContextRequestMeasuredPayloadSchema, LatestPrimaryRequestSnapshotSchema,
  UsageQualitySchema, type ContextRequestMeasuredPayload, type LatestPrimaryRequestSnapshot } from "@taki/shared";
import { z } from "zod";
import type { Database, SqlRow } from "./sqlite.ts";

const Count = z.int().nonnegative().max(1_000_000_000);
const Timestamp = z.iso.datetime({ offset: true });
const ModelSource = z.strictObject({ type: z.literal("model"), provider: z.string().trim().min(1).max(200),
  modelId: z.string().trim().min(1).max(200) });
const Identity = z.object({ effect_id: z.string().min(1), run_id: z.string().min(1), attempt_id: z.string().min(1),
  original_user_seq: Count.positive(), dispatch_seq: Count.positive(), source_count: z.literal(1),
  started_at: Timestamp, settled_at: Timestamp,
  outcome: z.enum(["completed", "failed", "cancelled", "deadline_exceeded", "outcome_unknown", "reconciliation_required"]),
  source_ref_json: z.string() });
type Base = Pick<LatestPrimaryRequestSnapshot, "scope" | "characterId" | "computedAt">;
type Reason = NonNullable<LatestPrimaryRequestSnapshot["reason"]>;
class DataInconsistentError extends Error {}

export interface RequestAttributionRepo {
  read(characterId: string, computedAt?: string): LatestPrimaryRequestSnapshot;
}
export function createRequestAttributionRepo(db: Database): RequestAttributionRepo {
  return { read(characterId, computedAt = new Date().toISOString()) {
    const base: Base = { scope: "latest-primary-request", characterId: CharacterIdSchema.parse(characterId), computedAt };
    let snapshot: LatestPrimaryRequestSnapshot = unavailable(base, "read-failed");
    try { db.transaction(() => { snapshot = readLatest(db, base); }); }
    catch (error) { return unavailable(base, error instanceof z.ZodError || error instanceof SyntaxError
      || error instanceof DataInconsistentError ? "data-inconsistent" : "read-failed"); }
    return snapshot;
  } };
}

function readLatest(db: Database, base: Base): LatestPrimaryRequestSnapshot {
  const selected = selectLatest(db, base.characterId);
  if (selected === "scan-exhausted" || selected === "data-inconsistent") return unavailable(base, selected);
  if (selected === undefined) return { ...base, status: "empty", reason: null, request: null };
  const identity = selected;
  const source = ModelSource.parse(JSON.parse(identity.source_ref_json));
  const measurementRows = db.prepare(`SELECT attempt_id,schema_version,payload_json FROM run_events
    WHERE run_id=:runId AND kind='context.request.measured'
      AND CASE WHEN json_valid(payload_json) THEN json_extract(payload_json,'$.effectId')=:effectId ELSE 1 END
    ORDER BY seq LIMIT 3`)
    .all({ runId: identity.run_id, effectId: identity.effect_id });
  if (measurementRows.length === 3) return unavailable(base, "scan-exhausted");
  const measured = readMeasurement(measurementRows, identity);
  if (measured && (measured.population !== "primary" || measured.primaryInputSeq !== identity.original_user_seq
      || measured.provider !== source.provider || measured.modelId !== source.modelId)) return unavailable(base, "data-inconsistent");
  // The SDK end callback carries the response model name; the Effect correlates it with the requested model.
  const usage = db.prepare("SELECT run_id,attempt_id,provider,model_id,input_tokens,quality FROM run_usage WHERE effect_id=:effectId")
    .get({ effectId: identity.effect_id });
  if (usage && (usage.run_id !== identity.run_id || usage.attempt_id !== identity.attempt_id
      || usage.provider !== source.provider)) return unavailable(base, "data-inconsistent");
  const quality = usage ? UsageQualitySchema.parse(usage.quality) : undefined;
  const inputTokens = usage?.input_tokens == null || quality !== "reported" ? null : Count.parse(usage.input_tokens);
  const reason = measured === undefined ? "measurement-missing" : inputTokens === null ? "usage-missing" : null;
  const complete = reason === null && measured?.window !== undefined && measured.composition.coverage.status === "complete";
  return LatestPrimaryRequestSnapshotSchema.parse({ ...base, status: complete ? "ready" : "partial", reason,
    request: { runId: identity.run_id, effectId: identity.effect_id, primaryInputSeq: identity.original_user_seq,
      stepNumber: measured?.stepNumber ?? null, provider: source.provider, modelId: source.modelId,
      ...(usage ? { responseModelId: usage.model_id } : {}),
      dispatchedAt: measured?.dispatchedAt ?? identity.started_at, completedAt: identity.settled_at,
      outcome: identity.outcome, inputTokens, window: measured?.window ?? null, composition: measured?.composition ?? null } });
}

function selectLatest(db: Database, characterId: string): z.infer<typeof Identity> | "scan-exhausted" | "data-inconsistent" | undefined {
  // Order only source rows first. Historical requests are never parsed/sorted across every Run on each push.
  const sources = db.prepare(`SELECT s.original_user_seq,s.run_id FROM primary_conversation_sources s
    WHERE s.character_id=:characterId ORDER BY s.original_user_seq DESC LIMIT 257`).all({ characterId });
  for (const source of sources.slice(0, 256)) {
    const seq = Count.positive().parse(source.original_user_seq);
    if (source.run_id === null) continue; // An untracked input alone does not prove a terminal model dispatch.
    const runId = z.string().min(1).parse(source.run_id);
    const run = db.prepare("SELECT character_id,initiator FROM runs WHERE run_id=:runId").get({ runId });
    if (!run || run.character_id !== characterId || run.initiator !== "primary") return "data-inconsistent";
    // The exact Run index confines the JSON identity lookup to one input's physical dispatches.
    const effects = db.prepare(`SELECT e.*,
      (SELECT MAX(ev.seq) FROM run_events ev WHERE ev.run_id=e.run_id AND ev.kind='effect.intent_committed'
        AND CASE WHEN json_valid(ev.payload_json) THEN json_extract(ev.payload_json,'$.effectId')=e.effect_id ELSE 0 END) AS dispatch_seq
      FROM run_effects e WHERE e.run_id=:runId AND e.kind='model' AND e.state='terminal'
      ORDER BY dispatch_seq DESC LIMIT 2`).all({ runId });
    if (effects.length === 0) continue;
    const missingOrder = db.prepare(`SELECT EXISTS(SELECT 1 FROM run_effects e
      WHERE e.run_id=:runId AND e.kind='model' AND e.state='terminal' AND NOT EXISTS(
        SELECT 1 FROM run_events ev WHERE ev.run_id=e.run_id AND ev.kind='effect.intent_committed'
        AND CASE WHEN json_valid(ev.payload_json) THEN json_extract(ev.payload_json,'$.effectId')=e.effect_id ELSE 0 END)) AS missing`)
      .get({ runId });
    if (missingOrder?.missing !== 0) return "data-inconsistent";
    if (effects[1]?.dispatch_seq === effects[0]?.dispatch_seq) return "data-inconsistent";
    const bindings = db.prepare("SELECT source_id FROM primary_conversation_sources WHERE run_id=:runId LIMIT 2")
      .all({ runId });
    return Identity.parse({ ...effects[0], original_user_seq: seq, source_count: bindings.length });
  }
  return sources.length > 256 ? "scan-exhausted" : undefined;
}

function readMeasurement(rows: SqlRow[], identity: z.infer<typeof Identity>): ContextRequestMeasuredPayload | undefined {
  const first = rows[0];
  if (!first) return undefined;
  if (rows.some((row) => row.attempt_id !== identity.attempt_id || row.schema_version !== "context-request.v1"
      || row.payload_json !== first.payload_json)) throw new DataInconsistentError("REQUEST_ATTRIBUTION_DATA_INCONSISTENT");
  return ContextRequestMeasuredPayloadSchema.parse(JSON.parse(String(first.payload_json)));
}
function unavailable(base: Base, reason: Reason): LatestPrimaryRequestSnapshot {
  return { ...base, status: "unavailable", reason, request: null };
}
