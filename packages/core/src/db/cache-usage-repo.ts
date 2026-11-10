/**
 * INPUT:  primary Character summary identity and existing durable model usage ledgers
 * OUTPUT: global completion-based cache window snapshots and atomic summary baseline capture
 * POS:    core/db — optional aggregate projection; summaries and request outcomes remain authoritative
 */
import { CacheUsageWindowSnapshotSchema, CharacterIdSchema, type CacheUsageWindowSnapshot } from "@taki/shared";
import { z } from "zod";
import type { Database } from "./sqlite.ts";

const Count = z.int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const Totals = z.object({ observedRequests: Count, pairedRequests: Count, inputTokens: Count, cacheReadTokens: Count });
type UsageTotals = z.infer<typeof Totals>;
const Summary = z.object({ revision: Count.positive(), last_operation_id: z.string().nullable(), updated_at: z.iso.datetime({ offset: true }) });
const Baseline = z.object({ summary_revision: Count.positive(), operation_id: z.string(), summary_committed_at: z.string(),
  population: z.literal("regular-model-requests"),
  boundary: z.enum(["captured", "historical"]), observed_requests: Count, paired_requests: Count,
  input_tokens: Count, cache_read_tokens: Count });
const ZERO: UsageTotals = { observedRequests: 0, pairedRequests: 0, inputTokens: 0, cacheReadTokens: 0 };

export interface CacheUsageRepo {
  read(characterId: string, computedAt?: string): CacheUsageWindowSnapshot;
}

export function createCacheUsageRepo(db: Database): CacheUsageRepo {
  return { read(characterId, computedAt = new Date().toISOString()) {
    const base = { scope: "regular-model-requests" as const, characterId: CharacterIdSchema.parse(characterId), computedAt,
      summaryRevision: null, summaryCommittedAt: null, boundary: null };
    let snapshot: CacheUsageWindowSnapshot = unavailable(base, "read-failed");
    try { db.transaction(() => { snapshot = readWindow(db, base); }); }
    catch { return unavailable(base, "read-failed"); }
    return snapshot;
  } };
}

/** The caller owns the summary transaction; this savepoint isolates optional metadata failures. */
export function captureCacheUsageBaseline(db: Database, characterId: string): void {
  db.transaction(() => {
    const summary = Summary.parse(db.prepare("SELECT revision,last_operation_id,updated_at FROM conversation_summary WHERE character_id=:characterId")
      .get({ characterId }));
    if (!summary.last_operation_id) throw new Error("CACHE_BASELINE_OPERATION_MISSING");
    const totals = readTotals(db);
    db.prepare(`INSERT INTO cache_usage_baselines
      (character_id,summary_revision,operation_id,summary_committed_at,boundary,observed_requests,paired_requests,input_tokens,cache_read_tokens,population)
      VALUES (:characterId,:revision,:operationId,:committedAt,'captured',:observedRequests,:pairedRequests,:inputTokens,:cacheReadTokens,'regular-model-requests')
      ON CONFLICT(character_id) DO UPDATE SET summary_revision=excluded.summary_revision,operation_id=excluded.operation_id,
      summary_committed_at=excluded.summary_committed_at,boundary=excluded.boundary,observed_requests=excluded.observed_requests,
      paired_requests=excluded.paired_requests,input_tokens=excluded.input_tokens,cache_read_tokens=excluded.cache_read_tokens,
      population=excluded.population`).run({
      characterId, revision: summary.revision, operationId: summary.last_operation_id, committedAt: summary.updated_at, ...totals,
    });
  });
}

type WindowIdentity = Pick<CacheUsageWindowSnapshot, "scope" | "characterId" | "computedAt" | "summaryRevision" | "summaryCommittedAt" | "boundary">;

function readWindow(db: Database, initial: WindowIdentity): CacheUsageWindowSnapshot {
  const row = db.prepare("SELECT revision,last_operation_id,updated_at FROM conversation_summary WHERE character_id=:characterId")
    .get({ characterId: initial.characterId });
  let identity: WindowIdentity = { ...initial, summaryRevision: 0, boundary: "before-first-summary" };
  let baseline = ZERO;
  if (row) {
    const summary = Summary.parse(row);
    identity = { ...initial, summaryRevision: summary.revision, summaryCommittedAt: summary.updated_at };
    const parsed = Baseline.safeParse(db.prepare("SELECT * FROM cache_usage_baselines WHERE character_id=:characterId")
      .get({ characterId: initial.characterId }));
    if (!parsed.success || parsed.data.summary_revision !== summary.revision || parsed.data.operation_id !== summary.last_operation_id
      || parsed.data.summary_committed_at !== summary.updated_at) return unavailable(identity, "boundary-unknown");
    identity.boundary = parsed.data.boundary;
    baseline = { observedRequests: parsed.data.observed_requests, pairedRequests: parsed.data.paired_requests,
      inputTokens: parsed.data.input_tokens, cacheReadTokens: parsed.data.cache_read_tokens };
  }
  let totals: UsageTotals;
  try { totals = readTotals(db); }
  catch (error) {
    if (error instanceof z.ZodError) return unavailable(identity, "data-inconsistent");
    throw error;
  }
  const delta = Totals.safeParse({ observedRequests: totals.observedRequests - baseline.observedRequests,
    pairedRequests: totals.pairedRequests - baseline.pairedRequests, inputTokens: totals.inputTokens - baseline.inputTokens,
    cacheReadTokens: totals.cacheReadTokens - baseline.cacheReadTokens });
  if (!delta.success) return unavailable(identity, "data-inconsistent");
  const values = delta.data;
  const candidate = CacheUsageWindowSnapshotSchema.safeParse({ ...identity, ...values,
    status: values.pairedRequests > 0 ? "ready" : "empty", reason: null,
    ratio: values.inputTokens > 0 ? values.cacheReadTokens / values.inputTokens : null });
  return candidate.success ? candidate.data : unavailable(identity, "data-inconsistent");
}

function unavailable(identity: WindowIdentity, reason: "boundary-unknown" | "data-inconsistent" | "read-failed"): CacheUsageWindowSnapshot {
  return { ...identity, status: "unavailable", reason, observedRequests: null, pairedRequests: null,
    inputTokens: null, cacheReadTokens: null, ratio: null };
}

function readTotals(db: Database): UsageTotals {
  // The deployed primary pipeline uses OpenAI-compatible adapters: their synthetic default is zero,
  // so legacy positive cache values remain usable without depending on an operator's provider alias.
  // TOTAL avoids SQLite integer-overflow exceptions; the boundary rejects sums outside exact JS integer range.
  const row = db.prepare(`WITH observations AS (
    SELECT input_tokens,cache_read_tokens,
      (cache_read_observed=1 OR (cache_read_observed IS NULL AND cache_read_tokens>0)) AS observed
    FROM run_usage
    UNION ALL SELECT input_tokens,cache_read_tokens,1 FROM auxiliary_model_calls WHERE status<>'started'
      AND NOT(source='utility' AND label IN ('tidy','compact'))
  ), pairs AS (SELECT *, CASE WHEN observed=1 AND typeof(input_tokens)='integer'
      AND input_tokens>0 AND input_tokens<=9007199254740991 AND typeof(cache_read_tokens)='integer'
      AND cache_read_tokens>=0 AND cache_read_tokens<=input_tokens THEN 1 ELSE 0 END AS paired FROM observations)
    SELECT COUNT(*) AS observedRequests,COALESCE(SUM(paired),0) AS pairedRequests,
      TOTAL(CASE WHEN paired=1 THEN input_tokens ELSE 0 END) AS inputTokens,
      TOTAL(CASE WHEN paired=1 THEN cache_read_tokens ELSE 0 END) AS cacheReadTokens FROM pairs`).get();
  return Totals.parse(row);
}
