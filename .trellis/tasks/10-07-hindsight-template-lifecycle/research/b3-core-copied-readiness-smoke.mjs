/** Core-only readiness smoke: production lifecycle/backup copies; deterministic Native and runtime delegates. */
import assert from "node:assert/strict";
import { HINDSIGHT_TEMPLATE_BACKUP_BUILD } from "../../../../packages/shared/src/index.ts";
import { templateLifecycleFixture } from "../../../../packages/core/src/memory/hindsight/template-lifecycle/template-lifecycle-fixtures.ts";
import { createJointTemplateBackupFixture, JOINT_TEMPLATE_USER_MODEL } from "../../../../packages/core/src/testing/hindsight-template-backup-joint-fixture.ts";
import { readHindsightBackupCopy } from "../../../../packages/core/src/memory/hindsight-backup/hindsight-backup-copy-readback.ts";
import { openReadonlyDatabase } from "../../../../packages/core/src/db/sqlite.ts";
import { readHindsightTemplateBackupHistory } from "../../../../packages/core/src/memory/hindsight-backup/hindsight-template-backup-history.ts";

const source = templateLifecycleFixture();
let fixture;
try {
  source.service.stop(); await source.owner.stop();
  source.native.manifest.source_identity.compatibility_build = HINDSIGHT_TEMPLATE_BACKUP_BUILD;
  source.native.manifest.contracts.template_backup = { version: "1.0.0", support: { state: "supported", reason: "all_contracts_available" } };
  fixture = await createJointTemplateBackupFixture({ endpoint: "http://127.0.0.1:18481", client: source.native.client,
    targets: source.base.banks.map((bank) => ({ bank_id: bank.scope.bankId, provider_lineage: bank.scope.namespace.provider_lineage,
      bank_generation: bank.scope.namespace.bank_generation })) });
  const status = await fixture.prepare("removed");
  assert.equal(status.bank.selected.templateRevision, "none");
  assert.deepEqual(status.bank.selected.user.models[0].choice.value, JOINT_TEMPLATE_USER_MODEL);
  const capture = await fixture.capture();
  const copied = readHindsightBackupCopy(capture.corePath, capture.staged.core, capture.staged.request);
  assert.equal(copied.version, 2);
  assert.equal(copied.state.attestation.banks.find((bank) => bank.scope === "character").selected.templateRevision, "none");
  const db = openReadonlyDatabase(capture.corePath);
  try {
    const bank = copied.state.attestation.banks.find((bank) => bank.scope === "character");
    const history = readHindsightTemplateBackupHistory(db, { scope: bank.scope, canonicalIdentity: bank.canonicalIdentity, target: bank.target });
    assert.equal(history.selections.length, 3);
    assert.deepEqual(history.users.at(-1).models[0].choice.value, JOINT_TEMPLATE_USER_MODEL);
  } finally { db.close(); }
  process.stdout.write(JSON.stringify({ state: "ready", version: copied.version, receipts: copied.state.attestation.banks.map((bank) =>
    ({ scope: bank.scope, count: bank.receiptInventory.count, selected: bank.selected.templateRevision })),
    requestOperationCount: copied.request.operationIds.length,
    boundary: "real Core operation/publication/copy; deterministic Native receipt and runtime delegates; no HTTP/physical Native restore claim" }) + "\n");
} finally { await fixture?.close(); await source.close(); }
