/**
 * INPUT:  the published Local runtime seam (write fence, maintenance settle, ingestion) and the predecessor Local epoch
 * OUTPUT: drainCanonicalLocal() — fence writes, settle detached chains, force-ingest every Character with a pending span or
 *         unprocessed witnesses and prove no span is left incomplete; reopenCanonicalLocal() — release the fence only on positive marker evidence
 * POS:    core/memory/hindsight-activation — the A38 drain; the only model calls of the activation happen here through Local ingestion
 */
import type { Database } from "../../db/sqlite.ts";
import type { CanonicalLocalWriteFence } from "../canonical-local-write-fence.ts";
import { readMemoryAuthoritySelection } from "../legacy-migration/legacy-activation-repo.ts";
import type { HindsightActivationLocalRuntime } from "./hindsight-activation-service.ts";

export async function drainCanonicalLocal(input: {
  db: Database; local: HindsightActivationLocalRuntime; epochId: string; timeoutMs: number;
}): Promise<void> {
  await input.local.fence.quiesce({ timeoutMs: input.timeoutMs });
  await input.local.settle();
  await input.local.ingestion.settle();
  for (const characterId of pendingCharacters(input.db, input.epochId)) {
    try { await input.local.ingestion.run({ characterId }); }
    catch (error) { throw new Error("MEMORY_INGESTION_INCOMPLETE", { cause: error }); }
  }
  // Chat stays usable while fenced (grill Q1): a witness committed during the forced run is carried at COMMIT, so only an
  // incomplete span (which the carry refuses) fails the drain.
  if (incompleteSpan(input.db, input.epochId)) throw new Error("MEMORY_INGESTION_INCOMPLETE");
}

/** Mirrors retireUnlessLegacy: an unreadable or moved marker keeps Local fenced rather than guessing. */
export function reopenCanonicalLocal(input: { db: Database; fence: CanonicalLocalWriteFence; epochId: string }): void {
  let mode: string; let epochId: string | null;
  try { ({ mode, epochId } = readMemoryAuthoritySelection(input.db)); } catch { return; }
  if (mode === "canonical-local" && epochId === input.epochId) input.fence.release();
}

function pendingCharacters(db: Database, epochId: string): string[] {
  return db.prepare(`SELECT character_id FROM canonical_memory_ingestion_spans WHERE authority_epoch_id=:epoch AND state<>'complete'
    UNION SELECT character_id FROM canonical_memory_primary_commits WHERE authority_epoch_id=:epoch AND ingestion_span_id IS NULL
    ORDER BY character_id`).all({ epoch: epochId }).map((row) => String(row.character_id));
}

function incompleteSpan(db: Database, epochId: string): boolean {
  return db.prepare("SELECT 1 AS pending FROM canonical_memory_ingestion_spans WHERE authority_epoch_id=:epoch AND state<>'complete' LIMIT 1")
    .get({ epoch: epochId }) !== undefined;
}
