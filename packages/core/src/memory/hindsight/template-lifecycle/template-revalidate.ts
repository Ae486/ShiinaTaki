/**
 * INPUT:  an existing managed Bank selection and the revalidation producer's bounded authenticated reader
 * OUTPUT: current exact definition/incarnation proof for managed overlays, including explicit none
 * POS:    connection revalidation — immutable template receipts are reused; no import, refresh or default rewrite
 */
import type { HindsightBankSetupProjection } from "@taki/shared";
import { readApplicationCheckpoint } from "../../../db/hindsight-application-replica-checkpoint.ts";
import type { Database } from "../../../db/sqlite.ts";
import type { HindsightCallContext, HindsightClient } from "../hindsight-client.ts";
import { readRuntimeTemplateSelection } from "./template-runtime-selection.ts";
import { verifyTemplateApplication } from "./template-receipt.ts";

export async function verifyManagedTemplateBank(db: Database, input: {
  row: HindsightBankSetupProjection; client: HindsightClient; request(): HindsightCallContext;
}): Promise<boolean> {
  const checkpoint = readApplicationCheckpoint(db, input.row.externalBankId);
  const selected = checkpoint ? readRuntimeTemplateSelection(db, { bankId: input.row.externalBankId, namespace: checkpoint.namespace }) : null;
  if (!selected) return false;
  if (!input.client.templateSnapshot) throw new Error("MEMORY_TEMPLATE_UNSUPPORTED");
  const snapshot = await input.client.templateSnapshot({ request: { contract_version: "1.0.0", target: selected.request.target,
    selectors: selected.request.expected_snapshot.selectors }, context: input.request() });
  input.request();
  verifyTemplateApplication({ preview: selected, receipt: selected.receipt, snapshot });
  return true;
}
