/**
 * INPUT:  the active Hindsight activation receipt and immutable D78 capture/import evidence
 * OUTPUT: original Bank/source/unit and Block bodies addressed by their proven native identities
 * POS:    core/db — read-only D77 bootstrap adapter; never promotes authority or rewrites historical D78 evidence
 */
import { z } from "zod";
import {
  TakiApplicationBlockBodySchema, type CanonicalMemoryBank, type CanonicalMemoryRecord, type CanonicalMemorySource,
  type HindsightCurrentCapture, type HindsightCurrentMapping, type HindsightPreparedCurrentBank,
  type MemoryBankScope, type TakiApplicationBlockBody, type TakiApplicationNativeVersion,
} from "@taki/shared";
import { canonicalPayloadHash } from "../memory/legacy-migration/legacy-identities.ts";
import { getBlock } from "../memory/block-registry.ts";
import { sameApplicationValue, type HindsightApplicationScope } from "../memory/hindsight/hindsight-application-integrity.ts";
import { createCanonicalMemoryAuthorityRepo } from "./canonical-memory-authority-repo.ts";
import { readHindsightCurrentCaptureByManifest } from "./hindsight-current-capture-repo.ts";
import { readHindsightCurrentImport } from "./hindsight-current-import-repo.ts";
import { readHindsightCurrentPreparation } from "./hindsight-current-preparation-repo.ts";
import type { Database } from "./sqlite.ts";

export interface HindsightApplicationBootstrapScope extends HindsightApplicationScope {
  authorityEpochId: string;
  bankScope: MemoryBankScope;
}
export interface HindsightApplicationOriginal<T> {
  value: T;
  /** The immutable import target, distinct from a later current native version. */
  native: TakiApplicationNativeVersion;
  operationId: string;
}
export interface HindsightApplicationBootstrapEvidence {
  bank: HindsightApplicationOriginal<CanonicalMemoryBank>;
  originalProviderLineage: string;
  sources: Map<string, HindsightApplicationOriginal<CanonicalMemorySource>>;
  memories: Map<string, HindsightApplicationOriginal<CanonicalMemoryRecord>>;
  blocks: TakiApplicationBlockBody[];
}

export function readHindsightApplicationBootstrapEvidence(db: Database, scope: HindsightApplicationBootstrapScope):
HindsightApplicationBootstrapEvidence | undefined {
  const authority = createCanonicalMemoryAuthorityRepo(db).authorityEpoch(scope.authorityEpochId);
  if (authority.providerId !== "hindsight" || authority.providerLineageId !== scope.namespace.provider_lineage) invalid();
  const activation = db.prepare(`SELECT a.run_id,a.predecessor_epoch_id,b.bank_generation FROM hindsight_authority_activation_receipts a
    JOIN hindsight_authority_bank_receipts b ON b.transaction_id=a.transaction_id
    WHERE a.hindsight_epoch_id=:epoch AND a.provider_lineage=:lineage AND b.bank_id=:bank`)
    .get({ epoch: scope.authorityEpochId, lineage: scope.namespace.provider_lineage, bank: scope.bankId });
  // A fresh remote Bank or a replacement generation cannot inherit the former
  // activation's policy merely because an object reused the same text or ID.
  if (!activation || activation.bank_generation !== scope.namespace.bank_generation) return undefined;
  const candidates = db.prepare(`SELECT p.preparation_id FROM hindsight_current_preparations p
    JOIN hindsight_current_captures c ON c.capture_id=p.capture_id
    WHERE c.run_id=:run AND p.bank_id=:bank`).all({ run: String(activation.run_id), bank: scope.bankId });
  if (candidates.length === 0) return undefined;
  if (candidates.length !== 1) invalid();
  const prepared = readHindsightCurrentPreparation(db, String(candidates[0]?.preparation_id));
  const capture = readHindsightCurrentCaptureByManifest(db, prepared.manifestId);
  const imported = readHindsightCurrentImport(db, prepared.preparationId);
  if (!capture || !imported || !prepared.request || prepared.captureId !== capture.captureId
    || prepared.localEpochId !== activation.predecessor_epoch_id || prepared.runId !== activation.run_id
    || prepared.request.provider_lineage !== scope.namespace.provider_lineage || prepared.request.bank_generation !== scope.namespace.bank_generation
    || !sameApplicationValue(prepared.bankScope, scope.bankScope)) invalid();
  return buildEvidence({ prepared, capture, mappings: imported.mappings, scope });
}

function buildEvidence(input: {
  prepared: HindsightPreparedCurrentBank; capture: HindsightCurrentCapture;
  mappings: HindsightCurrentMapping[]; scope: HindsightApplicationBootstrapScope;
}): HindsightApplicationBootstrapEvidence {
  const { prepared, capture, mappings } = input;
  const bankMapping = mappings.find((mapping) => mapping.target_kind === "bank");
  const bank = capture.banks.find((value) => value.bankId === prepared.sourceBankId);
  if (!bankMapping || !bank) invalid();
  const sources = new Map<string, HindsightApplicationOriginal<CanonicalMemorySource>>();
  const memories = new Map<string, HindsightApplicationOriginal<CanonicalMemoryRecord>>();
  for (const mapping of mappings) {
    if (mapping.target_kind === "document") {
      const value = capture.sources.find((item) => item.bankId === prepared.sourceBankId && item.documentId === mapping.source.source_id);
      if (!value) invalid();
      sources.set(mapping.target_id, original({ value, revision: value.revision, mapping, operationId: prepared.operationId }));
    } else if (mapping.target_kind === "memory_unit") {
      const value = capture.records.find((item) => item.unit.bankId === prepared.sourceBankId && item.unit.memoryId === mapping.source.source_id);
      if (!value) invalid();
      memories.set(mapping.target_id, original({ value, revision: value.unit.revision, mapping, operationId: prepared.operationId }));
    }
  }
  return { bank: original({ value: bank, revision: bank.revision, mapping: bankMapping, operationId: prepared.operationId }),
    originalProviderLineage: captureLineage(capture), sources, memories, blocks: captureBlocks(capture, input.scope.bankScope) };
}

function original<T>(input: { value: T; revision: number; mapping: HindsightCurrentMapping; operationId: string }): HindsightApplicationOriginal<T> {
  const { mapping } = input;
  if (mapping.source.source_revision !== input.revision || canonicalPayloadHash(input.value) !== mapping.source.source_payload_hash) invalid();
  return { value: input.value, operationId: input.operationId, native: { object_kind: mapping.target_kind,
    object_id: mapping.target_id, object_revision: mapping.target_revision, payload_hash: mapping.target_payload_hash,
    native_cursor: mapping.journal_cursor } };
}

function captureLineage(capture: HindsightCurrentCapture): string {
  const epoch = capture.dispositions.find((item) => item.witness.kind === "epoch");
  if (!epoch) invalid();
  const value = z.object({ provider_lineage_id: z.uuid(), epoch_id: z.string() }).parse(JSON.parse(epoch.payloadJson));
  if (value.epoch_id !== capture.manifest.localEpochId) invalid();
  return value.provider_lineage_id;
}

function captureBlocks(capture: HindsightCurrentCapture, scope: MemoryBankScope): TakiApplicationBlockBody[] {
  const result: TakiApplicationBlockBody[] = [];
  for (const item of capture.dispositions) {
    if (item.witness.kind !== "block") continue;
    const row = z.strictObject({ block_id: z.string(), scope_kind: z.enum(["global", "character"]),
      character_id: z.string().nullable(), content: z.string(), revision: z.int().positive(), updated_at: z.string() }).parse(JSON.parse(item.payloadJson));
    if (row.scope_kind !== scope.kind || row.character_id !== scope.characterId) continue;
    const definition = getBlock(row.block_id);
    if (!definition || (definition.ownership === "global" ? "global" : "character") !== row.scope_kind) invalid();
    // The old Core Block contract stores the permitted writer in its registry,
    // not an actor column. This is that ownership rule, not a fabricated edit event.
    result.push(TakiApplicationBlockBodySchema.parse({ block_id: row.block_id, scope, content: row.content,
      block_revision: row.revision, updated_at: row.updated_at, writer: definition.writer, block_contract_version: 1 }));
  }
  return result;
}

export function assertHindsightApplicationOriginalBinding<T>(original: HindsightApplicationOriginal<T>, current: TakiApplicationNativeVersion): void {
  const prior = original.native;
  if (prior.object_kind !== current.object_kind || prior.object_id !== current.object_id
    || current.object_revision < prior.object_revision
    || current.object_revision === prior.object_revision && current.payload_hash !== prior.payload_hash) invalid();
}

function invalid(): never { throw new Error("HINDSIGHT_APPLICATION_ORIGINAL_EVIDENCE_INVALID"); }
