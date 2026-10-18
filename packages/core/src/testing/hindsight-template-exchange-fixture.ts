/**
 * INPUT:  actual isolated Native extraction seed, an authenticated client and an owned SQLite path
 * OUTPUT: real application sync/binding/command owners and exact Canonical policy assertions
 * POS:    core/testing — selects the supplied materialized group; does not fabricate Native bodies or label evidence
 */
import assert from "node:assert/strict";
import { z } from "zod";
import { HindsightTemplateLabelEvidenceSchema, HindsightTemplateLabelGroupSchema, HindsightTemplateLabelsSchema,
  HindsightTemplateTargetSchema, type MemoryBankScope, type TakiApplicationNamespace } from "@taki/shared";
import { createCanonicalMemoryAuthorityRepo } from "../db/canonical-memory-authority-repo.ts";
import { createHindsightApplicationCommandRepo } from "../db/hindsight-application-command-repo.ts";
import { createHindsightApplicationReplicaRepo } from "../db/hindsight-application-replica-repo.ts";
import { MIGRATIONS } from "../db/migrations/index-list.ts";
import { openDatabase, type Database } from "../db/sqlite.ts";
import { createHindsightApplicationBindingRunner } from "../memory/hindsight/hindsight-application-binding-runner.ts";
import { requireHindsightApplicationClient } from "../memory/hindsight/hindsight-application-capability.ts";
import { createHindsightApplicationCommandRunner } from "../memory/hindsight/hindsight-application-command-runner.ts";
import { createHindsightApplicationSyncRunner } from "../memory/hindsight/hindsight-application-sync-runner.ts";
import { createHindsightApplicationWriter } from "../memory/hindsight/hindsight-application-writer.ts";
import { hindsightBankBindings } from "../memory/hindsight/hindsight-bank-identity.ts";
import type { HindsightClient } from "../memory/hindsight/hindsight-client.ts";
import { sameApplicationValue } from "../memory/hindsight/hindsight-application-integrity.ts";
import { createIntlSegmenterTokenizer } from "../memory/search-tokenizer.ts";

const EPOCH = "template-label-http-epoch";
const UnitSeedSchema = HindsightTemplateLabelEvidenceSchema.pick({ unit_id: true, unit_revision: true, unit_payload_hash: true }).extend({
  text: z.string().min(1), expectedLayer: z.string().min(1), extractedRevision: z.int().min(1), consolidatedRevision: z.int().min(1),
  case: z.string().min(1).optional(),
}).refine((unit) => unit.unit_revision === unit.consolidatedRevision && unit.extractedRevision <= unit.consolidatedRevision);
const BankSeedSchema = z.strictObject({ target: HindsightTemplateTargetSchema,
  canonicalIdentity: z.string().min(1), characterId: z.string().min(1).max(160).nullable(),
  group: HindsightTemplateLabelGroupSchema, units: z.array(UnitSeedSchema).min(1).max(256),
}).refine((bank) => {
  const expected = hindsightBankBindings(bank.characterId ?? "global")[bank.characterId === null ? 0 : 1];
  return bank.target.bank_id === expected.externalBankId && bank.canonicalIdentity === expected.canonicalIdentity
    && new Set(bank.units.map((unit) => unit.unit_id)).size === bank.units.length;
}, "seed must use complete canonical Bank identities");
export const TemplateExchangeSeedSchema = z.strictObject({ version: z.literal(1), apiKey: z.string().min(1).max(256),
  banks: z.array(BankSeedSchema).min(1).max(256),
}).refine((seed) => new Set(seed.banks.map((bank) => bank.target.bank_id)).size === seed.banks.length
  && new Set(seed.banks.map((bank) => bank.target.provider_lineage)).size === 1);
export type TemplateExchangeSeed = z.infer<typeof TemplateExchangeSeedSchema>;
type BankSeed = TemplateExchangeSeed["banks"][number];

export function openTemplateExchange(input: { path: string; seed: TemplateExchangeSeed; client: HindsightClient }) {
  const db = openDatabase({ path: input.path, migrations: MIGRATIONS });
  const inTransaction = trackTransactions(db);
  const bank = (id: string) => { const result = input.seed.banks.find((entry) => entry.target.bank_id === id); assert.ok(result); return result; };
  initializeAuthority(db, input.seed);
  const authority = createCanonicalMemoryAuthorityRepo(db);
  const repo = createHindsightApplicationReplicaRepo({ db, tokenizer: createIntlSegmenterTokenizer({ stoplist: true }),
    bankScope: (id) => bankScope(bank(id)) });
  const commands = createHindsightApplicationCommandRepo({ db, assertActive: (guard) => {
    const selected = bank(guard.key.bankId); const current = repo.checkpoint(guard.key.bankId);
    assert.equal(authority.authorityEpoch().epochId, EPOCH); assert.equal(guard.key.authorityEpochId, EPOCH);
    assert.deepEqual(guard.namespace, namespace(selected)); assert.ok(current && !current.bankDeleted);
    assert.deepEqual(current.namespace, guard.namespace); assert.deepEqual(current.bankScope, bankScope(selected));
  } });
  const runner = createHindsightApplicationCommandRunner({ repo: commands, client: requireHindsightApplicationClient(input.client) });
  const writer = createHindsightApplicationWriter({ commands, runner, replica: repo });
  const bind = createHindsightApplicationBindingRunner({ repo, writer, client: input.client, bootstrap: () => undefined,
    templateLabelGroup: (address) => { const selected = bank(address.bankId);
      assert.deepEqual(address.namespace, namespace(selected)); return structuredClone(selected.group); } });
  const sync = createHindsightApplicationSyncRunner({ client: input.client, repo, authority,
    bankScope: (id) => bankScope(bank(id)), requestTimeoutMs: 30_000, bind });
  return { db, repo, writer, commands, inTransaction,
    synchronize: async (bankId: string) => {
      const selected = bank(bankId); const lease = repo.leases.acquire({ bankId, ownerId: "template-label-fixture", durationMs: 60_000 });
      try { await sync.run({ bank: { bankId, scope: bankScope(selected).kind, characterId: selected.characterId },
        run: { lease, kind: "incremental", trigger: "catch_up", predecessor: repo.nativeCheckpoint(bankId) ?? null },
        signal: new AbortController().signal, deadlineAt: lease.expiresAt }); }
      finally { repo.leases.release(lease); }
    },
    close: async () => { sync.stop(); await Promise.all([sync.settle(), writer.stop()]); await writer.settle(); db.close(); },
  };
}
export type TemplateExchange = ReturnType<typeof openTemplateExchange>;

export function verifyTemplateExchange(fixture: TemplateExchange, seed: TemplateExchangeSeed) {
  const counts = { banks: seed.banks.length, units: 0, registryPolicies: 0, neutralPolicies: 0, consolidatedProvenUnits: 0 };
  for (const bank of seed.banks) {
    assertMaterializedGroup(fixture, bank);
    for (const unit of bank.units) {
      const memory = verifyUnit(fixture, { bank, unit }); counts.units++;
      if (memory.policy_basis === "registry") {
        counts.registryPolicies++;
        if (unit.consolidatedRevision > unit.extractedRevision) counts.consolidatedProvenUnits++;
      } else counts.neutralPolicies++;
    }
  }
  assert.ok(counts.registryPolicies > 0 && counts.neutralPolicies > 0 && counts.consolidatedProvenUnits > 0);
  assert.deepEqual(fixture.db.prepare("PRAGMA foreign_key_check").all(), []);
  return counts;
}

function verifyUnit(fixture: TemplateExchange, input: { bank: BankSeed; unit: BankSeed["units"][number] }) {
  const { bank, unit } = input; const address = { bankId: bank.target.bank_id, namespace: namespace(bank) };
  const head = fixture.repo.nativeHead({ ...address, objectKind: "memory_unit", objectId: unit.unit_id });
  assert.ok(head?.version && head.bound_artifact); assert.equal(head.binding_state, "bound");
  assert.equal(head.version.object_revision, unit.unit_revision); assert.equal(head.version.payload_hash, unit.unit_payload_hash);
  const artifact = fixture.repo.artifact({ ...address, version: head.bound_artifact }); assert.ok(artifact);
  const body = fixture.repo.body({ ...address, bodyId: artifact.body_ref.body_id });
  assert.ok(body?.content.body_schema === "application-memory.v1");
  const memory = body.content.value;
  const record = fixture.repo.record({ ...address, memoryId: unit.unit_id }); assert.ok(record);
  assert.equal(record.unit.text, unit.text); assert.equal(record.unit.revision, unit.unit_revision);
  assert.equal(record.policy.layerId, unit.expectedLayer); assert.equal(memory.policy.layerId, unit.expectedLayer);
  assert.equal(record.policy.disclosure, null); assert.equal(record.policy.visibility, "retrieved");
  assert.equal(record.policy.importance, 5); assert.equal(record.provenance.origin, "provider-derived");
  assert.equal(record.provenance.timelineFromSeq, null); assert.equal(record.provenance.timelineToSeq, null);
  assert.deepEqual(memory.assessment.target, head.version); assert.equal(memory.assessment.attempts, 0);
  assert.equal(memory.policy_basis, unit.expectedLayer === "unclassified" ? "neutral" : "registry");
  assert.equal(memory.assessment.state, unit.expectedLayer === "unclassified" ? "due" : "not_required");
  if (unit.expectedLayer === "unclassified") assert.deepEqual(record.policy.retention, { kind: "permanent" });
  return memory;
}

function assertMaterializedGroup(fixture: TemplateExchange, bank: BankSeed): void {
  const binding = fixture.repo.bankBinding(bank.target.bank_id); assert.ok(binding?.bank);
  const labels = HindsightTemplateLabelsSchema.parse(binding.bank.config.entity_labels); assert.ok(labels);
  const groups = Array.isArray(labels) ? labels : labels.attributes;
  assert.ok(sameApplicationValue(groups.find((group) => group.key === "taki-layer"), bank.group));
}

function initializeAuthority(db: Database, seed: TemplateExchangeSeed): void {
  const lineage = seed.banks[0]?.target.provider_lineage; assert.ok(lineage);
  const prior = db.prepare("SELECT provider_lineage_id FROM canonical_memory_authority_epochs WHERE epoch_id=:epoch").get({ epoch: EPOCH });
  if (prior) { assert.equal(prior.provider_lineage_id, lineage); return; }
  const at = new Date().toISOString();
  db.transaction(() => {
    db.prepare(`INSERT INTO canonical_memory_authority_epochs
      (epoch_id,provider_id,provider_lineage_id,status,predecessor_epoch_id,started_at,ended_at,reason)
      VALUES (:epoch,'hindsight',:lineage,'active',NULL,:at,NULL,'planned-switch')`).run({ epoch: EPOCH, lineage, at });
    db.prepare("INSERT INTO canonical_memory_authority_state(singleton,active_epoch_id,updated_at) VALUES(1,:epoch,:at)").run({ epoch: EPOCH, at });
  });
}

function bankScope(bank: BankSeed): MemoryBankScope {
  return bank.characterId === null ? { kind: "global", characterId: null } : { kind: "character", characterId: bank.characterId };
}
function namespace(bank: BankSeed): TakiApplicationNamespace {
  return { application_id: "taki", provider_lineage: bank.target.provider_lineage, bank_generation: bank.target.bank_generation };
}
function trackTransactions(db: Database): () => boolean {
  const transact = db.transaction; let depth = 0;
  db.transaction = (callback) => transact(() => { depth++; try { callback(); } finally { depth--; } });
  return () => depth > 0;
}
