/**
 * INPUT: existing Local/Legacy sparse projections without a recorded tokenizer policy
 * OUTPUT: derived per-index/authority policy storage; historical indexes remain explicitly unknown
 * POS: core/db/migrations — additive metadata only; no Memory authority or content changes
 */
import type { Migration } from "../migration-runner.ts";

export const searchProjectionPolicyMigration072: Migration = { version: 72, sql: `
CREATE TABLE search_projection_policy (
  index_name TEXT NOT NULL CHECK(index_name IN ('memory_fts','canonical_memory_fts')),
  authority_epoch_id TEXT NOT NULL,
  tokenizer_version TEXT NOT NULL,
  stoplist INTEGER NOT NULL CHECK(stoplist IN (0,1)),
  PRIMARY KEY(index_name, authority_epoch_id),
  CHECK((index_name='memory_fts' AND authority_epoch_id='') OR
    (index_name='canonical_memory_fts' AND length(authority_epoch_id)>0))
) STRICT;
` };
