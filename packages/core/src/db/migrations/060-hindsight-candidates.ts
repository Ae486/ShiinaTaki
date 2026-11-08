/**
 * INPUT:  frozen D1-B candidate-domain SQL and controlling-Core migration history through 059
 * OUTPUT: additive empty candidate records, original request/effect links and observation receipts
 * POS:    Core migration 060; never applied by the immutable archived-Core reader
 */
import type { Migration } from "../migration-runner.ts";
import { HINDSIGHT_CANDIDATE_DOMAIN_SQL } from "../../memory/hindsight-candidates/hindsight-candidate-domain-sql.ts";

export const hindsightCandidatesMigration060: Migration = {
  version: 60,
  sql: HINDSIGHT_CANDIDATE_DOMAIN_SQL,
};
