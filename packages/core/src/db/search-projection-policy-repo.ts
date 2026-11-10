/**
 * INPUT: Core SQLite and a Local/Legacy search projection identity
 * OUTPUT: persisted tokenizer policy reads and transaction-owned publication writes
 * POS: core/db — derived-index metadata; never infers historical policy from desired configuration
 */
import type { Database } from "./sqlite.ts";

// Bump the implementation revision when normalization or the stopword vocabulary changes.
// ICU/Unicode upgrades can change segmentation even when the application implementation is unchanged.
export const SEARCH_TOKENIZER_VERSION = `intl-segmenter-v1:icu-${process.versions.icu}:unicode-${process.versions.unicode}`;

export type SearchProjectionIdentity =
  | { table: "memory_fts"; epochId: null }
  | { table: "canonical_memory_fts"; epochId: string };

export interface SearchProjectionPolicy { stoplist: boolean; tokenizerVersion: string }

export function createSearchProjectionPolicyRepo(db: Database) {
  const select = db.prepare("SELECT stoplist,tokenizer_version FROM search_projection_policy WHERE index_name=:table AND authority_epoch_id=:epoch");
  const put = db.prepare(`INSERT INTO search_projection_policy(index_name,authority_epoch_id,tokenizer_version,stoplist)
    VALUES(:table,:epoch,:version,:stoplist) ON CONFLICT(index_name,authority_epoch_id)
    DO UPDATE SET tokenizer_version=excluded.tokenizer_version,stoplist=excluded.stoplist`);
  const read = (identity: SearchProjectionIdentity): SearchProjectionPolicy | null => {
    const row = select.get({ table: identity.table, epoch: identity.epochId ?? "" });
    if (!row) return null;
    if ((row.stoplist !== 0 && row.stoplist !== 1) || typeof row.tokenizer_version !== "string") {
      throw new Error("MEMORY_SEARCH_INDEX_POLICY_INVALID");
    }
    return { stoplist: row.stoplist === 1, tokenizerVersion: row.tokenizer_version };
  };
  return {
    read,
    appliedStoplist(identity: SearchProjectionIdentity): boolean | null {
      const policy = read(identity);
      return policy?.tokenizerVersion === SEARCH_TOKENIZER_VERSION ? policy.stoplist : null;
    },
    // The rebuild producer calls this inside the same transaction as the FTS replacement.
    write(identity: SearchProjectionIdentity, stoplist: boolean): void {
      put.run({ table: identity.table, epoch: identity.epochId ?? "", version: SEARCH_TOKENIZER_VERSION,
        stoplist: stoplist ? 1 : 0 });
    },
  };
}
