/**
 * INPUT:  Core SQLite and the Local provider's sparse tokenizer
 * OUTPUT: scoped, authority-fenced maintenance, atomic ingestion/copy, and historical receipt replay
 * POS:    core/db — internal Local maintenance boundary; model and registry policy stay in Local services
 */
import { createIntlSegmenterTokenizer, type SearchTokenizer } from "../memory/search-tokenizer.ts";
import type { CanonicalMemoryMaintenanceRepo } from "./canonical-memory-maintenance-contract.ts";
import { copyCanonicalMemoryToBank } from "./canonical-memory-maintenance-copy.ts";
import { createCanonicalMaintenanceIngestion } from "./canonical-memory-maintenance-ingestion.ts";
import { createCanonicalMaintenanceMutations } from "./canonical-memory-maintenance-mutations.ts";
import { createCanonicalMaintenanceQueries } from "./canonical-memory-maintenance-query.ts";
import { hardDeleteCanonicalRollingMemory } from "./canonical-memory-maintenance-retention.ts";
import { canonicalMemoryAtomic } from "./canonical-memory-maintenance-storage.ts";
import type { Database } from "./sqlite.ts";

export function createCanonicalMemoryMaintenanceRepo(db: Database,
  tokenizer: SearchTokenizer = createIntlSegmenterTokenizer({ stoplist: true })): CanonicalMemoryMaintenanceRepo {
  const writer = { db, tokenizer };
  return {
    transaction: (operation) => canonicalMemoryAtomic(db, operation),
    ...createCanonicalMaintenanceQueries(db),
    ...createCanonicalMaintenanceMutations(writer),
    ...createCanonicalMaintenanceIngestion(writer),
    copyToBank: (input) => copyCanonicalMemoryToBank(writer, input),
    hardDeleteRolling: (input) => hardDeleteCanonicalRollingMemory(db, input),
  };
}
