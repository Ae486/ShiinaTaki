/**
 * INPUT:  the Native admin backup table list (`admin/cli.py` BACKUP_TABLES) and its schema-coverage exclusions
 * OUTPUT: the supported candidate profile: exact build, every required table by family and classified target-only tables
 * POS:    core/memory/hindsight-candidates — profile data only; another build or table set is unsupported, never coerced
 */
import { HINDSIGHT_TEMPLATE_BACKUP_BUILD, type HindsightCandidateTableFamily } from "@taki/shared";

export const HINDSIGHT_CANDIDATE_BUILD = HINDSIGHT_TEMPLATE_BACKUP_BUILD;
export const HINDSIGHT_CANDIDATE_UPSTREAM = "4b2041eb3de5c4235f4a3dd5619fc47cce782e29";
export const HINDSIGHT_CANDIDATE_ALEMBIC = "e62a3d0b9c54";
export const HINDSIGHT_CANDIDATE_CORE_HEAD = 59;

const FAMILIES: Record<HindsightCandidateTableFamily, readonly string[]> = {
  primary: ["banks", "documents", "entities", "chunks", "memory_units", "unit_entities", "entity_cooccurrences",
    "memory_links", "mental_models", "knowledge_pages", "directives"],
  body: ["file_storage"],
  history: ["invalidated_memory_units", "observation_history", "mental_model_history", "audit_log", "llm_requests"],
  application: ["replication_provider_lineage", "replication_bank_state", "replication_logical_changes",
    "replication_logical_snapshots", "replication_logical_snapshot_pages", "memory_native_operation_receipts",
    "memory_retain_part_receipts", "memory_mutation_receipts", "memory_application_banks", "memory_application_bodies",
    "memory_application_body_parts", "memory_application_native_heads", "memory_application_artifacts",
    "memory_application_changes", "memory_application_operations", "memory_application_snapshots"],
  control: ["webhooks", "memory_current_state_transfers", "memory_current_state_transfer_mappings", "memory_bank_maintenance",
    "memory_cutover_verifications", "memory_cutover_steps", "memory_cutover_actions", "memory_cutover_evidence_pages",
    "memory_transition_requests", "memory_transition_bank_origins", "memory_transition_initializations",
    "memory_transition_fences", "memory_transition_writers", "memory_transition_work", "memory_transition_history",
    "memory_transition_maintenance", "memory_transition_steps", "memory_transition_actions",
    "memory_transition_evidence_pages", "memory_transition_auxiliary_pages", "memory_transition_deltas"],
  pending: ["async_operations", "graph_maintenance_queue"],
  template: ["memory_template_receipts", "memory_template_children", "memory_template_refresh_results",
    "memory_template_label_proofs", "memory_template_label_heads"],
};

export const HINDSIGHT_CANDIDATE_TABLES: ReadonlyMap<string, HindsightCandidateTableFamily> = new Map(
  Object.entries(FAMILIES).flatMap(([family, names]) => names.map((name) => [name, family as HindsightCandidateTableFamily] as const)));

/** Present in the target only: migration bookkeeping and Native's self-repopulating stats cache (never backed up). */
export const HINDSIGHT_CANDIDATE_CLASSIFIED: ReadonlyMap<string, "migration_metadata" | "derived"> = new Map([
  ["alembic_version", "migration_metadata"], ["bank_stats_cache", "derived"],
]);

/** Document file bodies must resolve to SQL-held rows; an unresolved key is an external or omitted body. */
export const HINDSIGHT_CANDIDATE_BODY_REFERENCE = {
  referencing: { table: "documents", column: "file_storage_key" },
  stored: { table: "file_storage", column: "storage_key" },
} as const;
