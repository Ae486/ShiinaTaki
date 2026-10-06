/**
 * INPUT:  W1 fenced Local transition lease, active epoch and complete SQLite inventory
 * OUTPUT: immutable lossless captures including actual maintenance, retirement and historical bytes
 * POS:    core/db — neutral W3 discovery under a real writer reservation; never a B2/first-activation receipt
 */
import { MemoryTransitionLocalCaptureSchema, MemoryTransitionLocalStateSchema,
  type MemoryTransitionLocalCapture, type MemoryTransitionLocalState } from "@taki/shared";
import { getBlock } from "../memory/block-registry.ts";
import { transitionLocalHash } from "../memory/transitions/transition-local-encoding.ts";
import { readTransitionLocalCoverageState } from "./hindsight-local-coverage-reader.ts";
import { readTransitionLocalPayloads } from "./hindsight-current-capture-reader.ts";
import { assertTransitionPredecessor, readTransitionIntent, requireTransitionLease, type TransitionLease } from "./memory-transition-repo.ts";
import { insertTransitionDocument, readTransitionDocument, transitionDocumentHash } from "./memory-transition-document-repo.ts";
import type { Database } from "./sqlite.ts";
import { readCanonicalHistoricalReferences } from "./canonical-memory-historical-references.ts";
import { readCanonicalSourceAliases, readCanonicalSourceSet } from "./canonical-memory-source-references.ts";
import { readCanonicalEvidenceSources } from "./canonical-memory-maintenance-evidence.ts";

export interface TransitionCaptureInput { lease: TransitionLease; now: string; assertConfiguration(): void }
const HISTORY_TABLES = ["canonical_memory_revision_snapshots", "canonical_memory_operation_receipts",
  "canonical_memory_retired_sources", "canonical_memory_record_provenance"] as const;

export function captureTransitionLocal(db: Database, input: TransitionCaptureInput): MemoryTransitionLocalCapture {
  let result: MemoryTransitionLocalCapture | undefined;
  db.transaction(() => {
    const intent = requireTransitionPreparation(db, input);
    if (intent.request.expected.sourceProvider !== "local") throw new Error("MEMORY_TRANSITION_STALE");
    const epochId = intent.request.expected.predecessorEpochId;
    const current = discoverTransitionLocal(db, epochId);
    const expected = intent.request.expected.banks.map((bank) => [bank.sourceBankId, bank.scope]).sort();
    const actual = current.state.banks.map((bank) => [bank.bankId, bank.scope]).sort();
    if (transitionLocalHash(expected) !== transitionLocalHash(actual)) throw new Error("MEMORY_TRANSITION_STALE");
    const prior = readTransitionDocument(db, "captures", { transitionId: intent.transitionId, slot: "final", schema: MemoryTransitionLocalCaptureSchema });
    if (prior) {
      if (prior.contentHash !== current.contentHash) throw new Error("MEMORY_TRANSITION_STALE");
      result = prior; return;
    }
    const body = { version: 1 as const, transitionId: intent.transitionId, epochId, capturedAt: input.now, ...current };
    result = MemoryTransitionLocalCaptureSchema.parse({ ...body, captureId: transitionDocumentHash("captures", body) });
    insertTransitionDocument(db, "captures", { id: result.captureId, transitionId: intent.transitionId, slot: "final", value: result });
    requireTransitionPreparation(db, input);
  });
  if (!result) throw new Error("MEMORY_TRANSITION_PROOF_INVALID");
  return result;
}

/** Read-only after the caller reserves a writer. This API discovers rows itself; it accepts no manifest subset. */
export function discoverTransitionLocal(db: Database, epochId: string) {
  const coverage = readTransitionLocalCoverageState(db, epochId);
  const { dispositions, ...payloads } = readTransitionLocalPayloads(db, coverage);
  const blocks = dispositions.filter((item) => item.witness.kind === "block").map((item) => {
    const row = JSON.parse(item.payloadJson) as Record<string, unknown>;
    const definition = getBlock(String(row.block_id));
    if (!definition) throw new Error("MEMORY_TRANSITION_PROOF_INVALID");
    return { block_id: row.block_id, scope: { kind: row.scope_kind, characterId: row.character_id },
      content: row.content, block_revision: row.revision, updated_at: row.updated_at, writer: definition.writer, block_contract_version: 1 };
  });
  const history = HISTORY_TABLES.flatMap((table) => db.prepare(`SELECT * FROM ${table} WHERE authority_epoch_id=:epoch`)
    .all({ epoch: epochId }).map((row) => ({ table, rowJson: JSON.stringify(row) })))
    .sort((a, b) => a.table.localeCompare(b.table, "en") || compare(a.rowJson, b.rowJson));
  const state = MemoryTransitionLocalStateSchema.parse({ ...payloads, blocks, history,
    historicalReferences: readCanonicalHistoricalReferences(db, epochId), sourceAliases: readCanonicalSourceAliases(db, epochId),
    sourceSets: currentSourceSets(db, epochId, payloads) });
  requireTransitionLocalClosure(state);
  const inventoryHash = transitionLocalHash(state.banks.map((bank) => [bank.bankId, bank.scope]));
  const contentHash = transitionLocalHash({ witnesses: coverage.records, dispositions, state });
  return { contentHash, inventoryHash, witnesses: coverage.records, dispositions, state };
}

export function readTransitionLocalCapture(db: Database, captureId: string): MemoryTransitionLocalCapture {
  const capture = readTransitionDocument(db, "captures", { id: captureId, schema: MemoryTransitionLocalCaptureSchema });
  if (!capture || capture.contentHash !== transitionLocalHash({ witnesses: capture.witnesses, dispositions: capture.dispositions, state: capture.state })) {
    throw new Error("MEMORY_TRANSITION_PROOF_INVALID");
  }
  requireTransitionLocalClosure(capture.state); return capture;
}
export function assertTransitionLocalCurrent(db: Database, capture: MemoryTransitionLocalCapture): void {
  if (discoverTransitionLocal(db, capture.epochId).contentHash !== capture.contentHash) throw new Error("MEMORY_TRANSITION_STALE");
}

export function requireTransitionPreparation(db: Database, input: TransitionCaptureInput) {
  // This no-op UPDATE acquires SQLite's real writer reservation before any acceptance read.
  db.prepare("UPDATE canonical_memory_authority_state SET active_epoch_id=active_epoch_id WHERE singleton=1").run();
  const attempt = requireTransitionLease(db, input);
  const intent = readTransitionIntent(db, attempt.transitionId);
  if (!intent || attempt.phase !== "fenced" || attempt.cutoffSequence === null || intent.incidentId !== null) throw new Error("MEMORY_TRANSITION_PROOF_INVALID");
  assertTransitionPredecessor(db, intent); input.assertConfiguration(); return intent;
}

export function requireTransitionLocalClosure(state: MemoryTransitionLocalState): void {
  const banks = new Set(state.banks.map((bank) => bank.bankId));
  const sources = new Set(state.sources.map((source) => JSON.stringify([source.bankId, source.documentId])));
  const units = new Set(state.records.map(({ unit }) => JSON.stringify([unit.bankId, unit.memoryId])));
  const historical = new Set(state.historicalReferences.map((edge) => JSON.stringify([edge.bankId, edge.memoryId, edge.sourceMemoryId])));
  if (historical.size !== state.historicalReferences.length || state.historicalReferences.some((edge) =>
    units.has(JSON.stringify([edge.bankId, edge.sourceMemoryId]))
    || !state.records.some(({ unit }) => unit.bankId === edge.bankId && unit.memoryId === edge.memoryId && unit.sourceMemoryIds.includes(edge.sourceMemoryId)))) {
    throw new Error("MEMORY_TRANSITION_PROOF_INVALID");
  }
  if (banks.size !== state.banks.length || sources.size !== state.sources.length || units.size !== state.records.length
    || state.banks.filter((bank) => bank.scope.kind === "global").length !== 1) throw new Error("MEMORY_TRANSITION_PROOF_INVALID");
  for (const { unit, policy } of state.records) {
    if (!banks.has(unit.bankId) || policy.bankId !== unit.bankId || policy.memoryId !== unit.memoryId
      || unit.documentId !== null && !sources.has(JSON.stringify([unit.bankId, unit.documentId]))
      || unit.sourceMemoryIds.some((id) => !units.has(JSON.stringify([unit.bankId, id]))
        && !historical.has(JSON.stringify([unit.bankId, unit.memoryId, id])))) throw new Error("MEMORY_TRANSITION_PROOF_INVALID");
  }
  if ([...state.sources, ...state.derived].some((row) => !banks.has(row.bankId))) throw new Error("MEMORY_TRANSITION_PROOF_INVALID");
  requireSourceClosure(state, { units, sources });
}
function requireSourceClosure(state: MemoryTransitionLocalState, inventory: { units: Set<string>; sources: Set<string> }): void {
  const sets = state.sourceSets.map((set) => JSON.stringify([set.bankId, set.memoryId]));
  if (sets.length !== inventory.units.size || new Set(sets).size !== sets.length || sets.some((key) => !inventory.units.has(key))) {
    throw new Error("MEMORY_TRANSITION_PROOF_INVALID");
  }
  for (const set of state.sourceSets) for (const ref of set.references) {
    const source = state.sources.find((row) => row.bankId === set.bankId && row.documentId === ref.documentId);
    if (!source || ref.source.bankId !== set.bankId || ref.source.authorityEpochId !== source.authorityEpochId) throw new Error("MEMORY_TRANSITION_PROOF_INVALID");
  }
  const aliases = state.sourceAliases.map((alias) => JSON.stringify([alias.bankId, alias.artifact.key]));
  if (new Set(aliases).size !== aliases.length || state.sourceAliases.some((alias) =>
    !inventory.sources.has(JSON.stringify([alias.bankId, alias.documentId]))
    || !alias.retired && !inventory.sources.has(JSON.stringify([alias.bankId, alias.physicalDocumentId])))) throw new Error("MEMORY_TRANSITION_PROOF_INVALID");
}
function compare(a: string, b: string): number { return a < b ? -1 : a > b ? 1 : 0; }

function currentSourceSets(db: Database, epochId: string, state: Pick<MemoryTransitionLocalState, "banks" | "sources" | "records">) {
  return state.records.map(({ unit }) => {
    const identity = { epochId, bankId: unit.bankId, memoryId: unit.memoryId };
    const stored = readCanonicalSourceSet(db, identity);
    const sources = readCanonicalEvidenceSources(db, { ...identity,
      characterId: state.banks.find((bank) => bank.bankId === unit.bankId)?.scope.characterId ?? null });
    const refs = [...(stored?.references ?? [])];
    const direct = !stored && unit.documentId !== null ? state.sources.find((source) => source.bankId === unit.bankId && source.documentId === unit.documentId) : undefined;
    for (const source of [...(direct ? [direct] : []), ...sources]) {
      if (!refs.some((ref) => ref.documentId === source.documentId)) refs.push({ documentId: source.documentId, source, artifact: null, intent: "local" });
    }
    return { bankId: unit.bankId, memoryId: unit.memoryId, references: refs };
  });
}
