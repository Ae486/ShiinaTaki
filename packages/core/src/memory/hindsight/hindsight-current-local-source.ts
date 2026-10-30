/**
 * INPUT:  a selected frozen B4 coverage version and the Local source identity to prepare
 * OUTPUT: persisted immutable typed source evidence and a native item or explicit representation gaps
 * POS:    core/memory/hindsight — Local import prerequisite; no provider dispatch or authority mutation
 */
import type { HindsightPreparedSource } from "@taki/shared";
import type { Database } from "../../db/sqlite.ts";
import { createHindsightLocalCoverageRepo, type HindsightLocalSourcePreparationInput } from "../../db/hindsight-local-coverage-repo.ts";
import { createHindsightSourceEvidenceRepo } from "../../db/hindsight-source-evidence-repo.ts";
import { prepareHindsightSource } from "./hindsight-source-preparation.ts";

export function prepareCurrentLocalHindsightSource(db: Database, input: HindsightLocalSourcePreparationInput): HindsightPreparedSource {
  let prepared: HindsightPreparedSource | undefined;
  db.transaction(() => {
    // The coverage reader reserves the writer before any Local read. This outer transaction keeps that
    // reservation through evidence persistence, so no other connection can change the witnessed source.
    const frozen = createHindsightLocalCoverageRepo(db).readForPreparation(input);
    prepared = prepareHindsightSource({ source: frozen.source, records: frozen.records });
    createHindsightSourceEvidenceRepo(db).savePrepared(prepared);
  });
  if (!prepared) throw new Error("HINDSIGHT_SOURCE_PREPARATION_FAILED");
  return prepared;
}
