/**
 * INPUT:  deterministic Native-shaped receipt/snapshot/result maps, independently of Core template history
 * OUTPUT: fresh nonce-bound observation responses with programmable source and projection drift
 * POS:    isolated test transport only; no Native authentication, SQL, physical restore or model claim
 */
import { randomUUID, createHash } from "node:crypto";
import { HINDSIGHT_TEMPLATE_BACKUP_BUILD, HindsightTemplateBackupObservationResponseSchema,
  hindsightTemplateBackupObservationValue, hindsightTemplateBackupReceiptsValue,
  type HindsightTemplateBackupObservationRequest, type HindsightTemplateBackupObservationResponse } from "@taki/shared";
import type { HindsightClient } from "../memory/hindsight/hindsight-client.ts";
import type { templateNativeFixture } from "../memory/hindsight/template-lifecycle/template-native-fixtures.ts";
import { projectTemplateSnapshot } from "../memory/hindsight/template-lifecycle/template-projection.ts";
import { templateEqual } from "../memory/hindsight/template-lifecycle/template-integrity.ts";
import { hindsightBackupHash, hindsightBackupProjectionHashes } from "../memory/hindsight-backup/hindsight-template-backup-integrity.ts";
import { hindsightBackupOperationDigest } from "../memory/hindsight-backup/hindsight-backup-pair.ts";
import { W3_AT } from "./memory-transition-candidate-fixtures.ts";

type Native = Pick<ReturnType<typeof templateNativeFixture>, "receipts" | "snapshots">;
export type TemplateRefreshFixtureResult = Awaited<ReturnType<NonNullable<HindsightClient["templateRefreshResult"]>>>;
export function templateObservationFixture(native: Native, refreshResults = new Map<string, TemplateRefreshFixtureResult>()) {
  const requests: HindsightTemplateBackupObservationRequest[] = [];
  const cursors = new Map<string, number>();
  const contexts = new Map<string, string>();
  const state: { schema: string; before?: () => Promise<void> | void;
    response?: (value: HindsightTemplateBackupObservationResponse) => HindsightTemplateBackupObservationResponse } = { schema: "isolated_tenant" };
  const observe: NonNullable<HindsightClient["observeTemplateBackup"]> = async ({ request: wrapper }) => {
    requests.push(structuredClone(wrapper)); await state.before?.();
    const request = wrapper.request;
    const entries = request.templates.map((entry) => {
      const receipts = [...native.receipts.values()].filter((receipt) => templateEqual(receipt.target, entry.target));
      const tuples = receipts.map(({ request_id, request_hash, receipt_hash }) => ({ request_id, request_hash, receipt_hash }));
      const receiptInventory = { count: tuples.length, digest: hindsightBackupHash("receipts", hindsightTemplateBackupReceiptsValue(entry.target, tuples)) };
      if (!entry.selected) return { target: entry.target, receiptInventory, selected: { state: "unselected" as const } };
      const original = receipts.find((receipt) => receipt.request_id === entry.selected?.request.request_id);
      const snapshot = native.snapshots.get(entry.target.bank_id);
      if (!original || !snapshot) throw new Error("fixture selected Native state missing");
      const hashes = hindsightBackupProjectionHashes(projectTemplateSnapshot(snapshot));
      const observation = { version: 1 as const, source: "authenticated-service" as const, observationId: randomUUID(), observedAt: W3_AT,
        schema: state.schema, contextHash: contexts.get(entry.target.bank_id) ?? createHash("sha256").update(entry.target.bank_id).digest("hex"),
        // The value encoder excludes the hash itself; this typed slot is replaced before response validation.
        requestHash: request.requestHash, inheritedConfigHash: hashes.inheritedConfigHash, observationHash: "" };
      return { target: entry.target, receiptInventory, selected: { state: "selected" as const, requestId: original.request_id,
        requestHash: original.request_hash, receiptHash: original.receipt_hash, ...hashes,
        configurationObservation: { ...observation, observationHash: hindsightBackupHash("observation",
          hindsightTemplateBackupObservationValue(entry.target, observation)) } } };
    });
    const present = new Set([...native.receipts.values()].filter((receipt) => request.nativeBankIds.includes(receipt.target.bank_id))
      .flatMap((receipt) => ["template-receipt:" + receipt.request_id, ...receipt.children.flatMap((child) =>
        refreshResults.has(child.child_id) ? ["template-refresh-result:" + child.child_id] : [])]));
    const missing = request.operationIds.filter((id) => !present.has(id));
    const response = HindsightTemplateBackupObservationResponseSchema.parse({ version: 2, nonce: wrapper.nonce,
      requestHash: request.requestHash, schema: state.schema, proof: { version: 2, requestHash: request.requestHash,
        providerLineage: request.providerLineageId, alembicRevision: "isolated-template-fixture", upstreamCommit: "synthetic-fixture",
        compatibilityBuild: HINDSIGHT_TEMPLATE_BACKUP_BUILD, templates: entries,
        banks: entries.map((entry) => ({ bankId: entry.target.bank_id, bankGeneration: entry.target.bank_generation,
          currentCursor: cursors.get(entry.target.bank_id) ?? 100, minimumAvailableCursor: 0, application: null })),
        receipts: { count: request.operationIds.length, digest: hindsightBackupOperationDigest(request.operationIds),
          missingCount: missing.length, missingSample: missing.slice(0, 16) } } });
    return state.response ? state.response(response) : response;
  };
  return { client: { observeTemplateBackup: observe }, requests, cursors, contexts, state, refreshResults };
}
