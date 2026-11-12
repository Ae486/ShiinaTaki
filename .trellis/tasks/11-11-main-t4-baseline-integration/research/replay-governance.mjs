/**
 * INPUT: immutable T4 stopped backup and the integrated registry/migration owners
 * OUTPUT: isolated-copy governance/Approval compatibility receipt; no Core startup or external calls
 * POS: integration research — preserves original bytes and compares historical effective approvals
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFileSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { openDatabase } from "../../../../packages/core/src/db/sqlite.ts";
import { MIGRATIONS } from "../../../../packages/core/src/db/migrations/index-list.ts";
import { createGovernancePolicyRepo } from "../../../../packages/core/src/governance/governance-policy-repo.ts";
import { createGovernancePolicyService } from "../../../../packages/core/src/governance/governance-policy-service.ts";
import { createApprovalStateRepo } from "../../../../packages/core/src/approval/approval-state-repo.ts";
import { createApprovalDecisionService } from "../../../../packages/core/src/approval/approval-decision-service.ts";
import { resolveHistoricalGovernanceRegistry } from "../../../../packages/shared/src/index.ts";

const source = "G:/taki-t4-freeze-20261110/data/core-profile/taki.db";
const hash = (value) => createHash("sha256").update(value).digest("hex");
const originalHash = hash(readFileSync(source));
const root = mkdtempSync("G:/taki-codex-work/integration-governance-");
const copy = join(root, "taki.db");
copyFileSync(source, copy);
const before = openDatabase({ path: copy, migrations: [] });
const oldApproval = createApprovalStateRepo(before).read();
const historical = resolveHistoricalGovernanceRegistry(oldApproval.governanceRegistryRevision);
assert(historical, "Frozen Approval registry must have an evidenced historical definition");
const oldUsability = createApprovalDecisionService(createApprovalStateRepo(before), historical).list()
  .map(({ decisionId, usability }) => ({ decisionId, usability }));
const witnesses = (db) => ({ decisions: db.prepare("SELECT * FROM approval_decisions ORDER BY decision_id").all(),
  overrides: db.prepare("SELECT * FROM governance_cell_overrides ORDER BY cell_key,level").all() });
const originalRows = witnesses(before);
const oldPolicy = before.prepare("SELECT * FROM governance_policy").get();
before.close();
const started = performance.now();
const db = openDatabase({ path: copy, migrations: MIGRATIONS });
try {
  const governance = createGovernancePolicyService(createGovernancePolicyRepo(db));
  const approval = createApprovalDecisionService(createApprovalStateRepo(db));
  assert.equal(governance.level().registryRevision, 4);
  assert.equal(approval.snapshot().governanceRegistryRevision, 4);
  assert.equal(approval.snapshot().decisions.length, 7);
  assert.deepEqual(witnesses(db), originalRows, "Frozen decisions/overrides must remain byte-for-byte equivalent rows");
  const usability = approval.list().map(({ decisionId, usability }) => ({ decisionId, usability }));
  assert.deepEqual(usability, oldUsability, "Previously effective grants must retain their effective semantics");
  assert.equal(hash(readFileSync(source)), originalHash, "Original stopped backup must remain unchanged");
  const receipt = { sourceSha256: originalHash, copy, migrationHead: db.prepare("SELECT max(version) AS head FROM migrations").get().head,
    before: { governanceRegistry: oldPolicy.registry_revision, policyGeneration: oldPolicy.policy_generation,
      approvalRegistry: oldApproval.governanceRegistryRevision }, after: governance.level(),
    approvalCount: usability.length, usableApprovals: usability.filter((item) => item.usability.usable).length,
    rowsPreserved: true, historicalUsabilityPreserved: true, originalHashUnchanged: true,
    durationMs: Math.round(performance.now() - started), providerCalls: 0, coreStarted: false };
  writeFileSync(new URL("./governance-replay-result-20261112.json", import.meta.url), `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(JSON.stringify(receipt));
} finally { db.close(); }
