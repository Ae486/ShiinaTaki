/**
 * INPUT:  a new owned SQLite database and the two owned native fixture Bank identities
 * OUTPUT: real B2/current-Local producer data plus explicit pre-verified B3 fixture bindings
 * POS:    D78 integration test support — no production data or authority promotion
 */
import type { HindsightCompatibilityProjection, HindsightCurrentImportEvidence } from "../../../../../packages/shared/src/index.ts";
import type { Database } from "../../../../../packages/core/src/db/sqlite.ts";
import { createCanonicalMemoryAuthorityRepo } from "../../../../../packages/core/src/db/canonical-memory-authority-repo.ts";
import { createCanonicalMemoryRepo } from "../../../../../packages/core/src/db/canonical-memory-repo.ts";
import { seedLocalB2CoverageFixture } from "../../../../../packages/core/src/db/hindsight-local-coverage-fixtures.ts";
import { createHindsightBankSetupRepo } from "../../../../../packages/core/src/db/hindsight-bank-setup-repo.ts";
import { createHindsightConnectionRepo } from "../../../../../packages/core/src/db/hindsight-connection-repo.ts";
import { createHindsightCutoverRunRepo } from "../../../../../packages/core/src/db/hindsight-cutover-run-repo.ts";
import { createHindsightLocalCoverageRepo } from "../../../../../packages/core/src/db/hindsight-local-coverage-repo.ts";
import { loadTakiBankTemplate, takiBankTemplateDigest } from "../../../../../packages/core/src/memory/hindsight/taki-bank-template-v1.ts";

export function fixtureTemplates() {
  return (["global", "character"] as const).map((scope) => ({ scope, template: loadTakiBankTemplate("taki-bank-v1", scope) }));
}

export function seedCurrentLocal(db: Database, nativeBanks: { global: string; character: string }) {
  const original = seedLocalB2CoverageFixture(db); const now = new Date().toISOString();
  const local = createCanonicalMemoryRepo(db);
  // Edit the actual B2-produced unit without rewriting its retained source or B2 receipt.
  local.edit({ epochId: original.epochId, bankId: original.bankId, memoryId: original.record.unit.memoryId,
    expectedRevision: 1, requestId: "fixture-current-edit", requestHash: "1".repeat(64), now,
    searchTerms: "Current edited fact", patch: { text: "Current edited fact after the B2 snapshot.", context: "" } });
  const source = { ...original.source, documentId: "current-source", retainedText: null, contentHash: "declared-history-hash",
    context: "source context is independent", metadata: { number: 1, text: "1", tiny: 1e-7, large: 1e21,
      nested: { nullable: null, empty: [], "😀": "value" } }, tags: ["taki-layer:profile", "taki-owned", "taki-scope:global"],
    provenance: { ...original.source.provenance, origin: "explicit-user" as const, actor: "user" as const, sourceRef: null },
    createdAt: now, updatedAt: now };
  const unit = { ...original.record.unit, memoryId: "current-unit", documentId: source.documentId, text: "Alice prefers careful current-state verification.",
    context: "", metadata: { number: 2, text: "2", tiny: 1e-7 }, entities: ["Alice"], tags: source.tags,
    sourceMemoryIds: [original.record.unit.memoryId], eventDate: null, occurredStart: null, occurredEnd: null,
    mentionedAt: null, createdAt: now, updatedAt: now };
  const policy = { ...original.record.policy, memoryId: unit.memoryId, updatedAt: now };
  local.retain({ epochId: original.epochId, bankId: original.bankId, requestId: "fixture-current-retain",
    requestHash: "2".repeat(64), source, unit, policy, searchTerms: unit.text });
  const archivedSource = { ...source, documentId: "archived-source", retainedText: "", context: null, contentHash: null };
  const archivedUnit = { ...unit, memoryId: "archived-unit", documentId: archivedSource.documentId,
    text: "An obsolete fixture preference.", sourceMemoryIds: [] };
  local.retain({ epochId: original.epochId, bankId: original.bankId, requestId: "fixture-archive-retain",
    requestHash: "3".repeat(64), source: archivedSource, unit: archivedUnit,
    policy: { ...policy, memoryId: archivedUnit.memoryId }, searchTerms: archivedUnit.text });
  local.invalidate({ epochId: original.epochId, bankId: original.bankId, memoryId: archivedUnit.memoryId,
    expectedRevision: 1, requestId: "fixture-invalidate", requestHash: "4".repeat(64), now,
    searchTerms: archivedUnit.text, reason: "obsolete fixture input" });
  const characterBankId = "local-character";
  createCanonicalMemoryAuthorityRepo(db).createBank({ authorityEpochId: original.epochId, bankId: characterBankId,
    scope: { kind: "character", characterId: "fixture-character" }, name: "Fixture Character", mission: "Local authored mission",
    disposition: { skepticism: 3, literalism: 3, empathy: 3 }, config: { authored: true }, createdAt: now, updatedAt: now });
  const banks = [
    { scope: "global" as const, sourceBankId: original.bankId, bankId: nativeBanks.global, canonicalIdentity: "global" },
    { scope: "character" as const, sourceBankId: characterBankId, bankId: nativeBanks.character, canonicalIdentity: "character:fixture-character" },
  ].map((bank) => ({ ...bank, template: loadTakiBankTemplate("taki-bank-v1", bank.scope) }));
  for (const bank of banks) {
    // The Python side provisions these exact resources with native engine APIs. Preparation subsequently
    // rereads the real native snapshot and verifies the actual B3-owned fields against the template.
    createHindsightBankSetupRepo(db).upsert({ scope: bank.scope, canonicalIdentity: bank.canonicalIdentity,
      externalBankId: bank.bankId, templateRevision: "taki-bank-v1", templateDigest: takiBankTemplateDigest(bank.template),
      status: "verified", operationIds: [], lastVerifiedAt: now, lastError: null });
  }
  const runs = createHindsightCutoverRunRepo(db);
  runs.create({ runId: original.runId, expectedPredecessorEpochId: original.epochId, now });
  const lease = runs.acquireLease({ runId: original.runId, owner: "owned-d78-http", now,
    expiresAt: new Date(Date.parse(now) + 10 * 60_000).toISOString() });
  const manifest = createHindsightLocalCoverageRepo(db).selected(original.runId);
  if (!manifest) throw new Error("fixture manifest missing");
  return { ...original, now, lease, manifest, banks, currentUnitId: unit.memoryId,
    archivedUnitId: archivedUnit.memoryId, currentSourceId: source.documentId };
}

export function saveFixtureCompatibility(db: Database, input: {
  compatibility: HindsightCompatibilityProjection; fingerprint: string;
}) {
  const repo = createHindsightConnectionRepo(db); const banks = createHindsightBankSetupRepo(db).list();
  const before = repo.read(banks); const now = new Date().toISOString();
  return repo.save({ ...before, revision: before.revision + 1, phase: "configured", lastSuccessfulPhase: "configured",
    configFingerprint: input.fingerprint, compatibility: input.compatibility, banks, modelHealth: "not-run",
    lastAttemptAt: now, lastSuccessAt: now, updatedAt: now }, before.revision);
}

export function mappedId(imported: HindsightCurrentImportEvidence, sourceId: string): string {
  const mapping = imported.pages.flatMap((page) => page.mappings).find((entry) => entry.source.source_id === sourceId);
  if (!mapping) throw new Error("fixture source mapping missing");
  return mapping.target_id;
}
