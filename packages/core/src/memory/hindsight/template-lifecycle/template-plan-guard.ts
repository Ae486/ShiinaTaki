/**
 * INPUT:  live Core authority/config/secret state and the complete setup/application Bank inventory
 * OUTPUT: exact local admission/final-publication guards, including configuration A-B-A detection
 * POS:    template lifecycle boundary — remote manifest validation stays outside the synchronous SQLite transaction
 */
import { z } from "zod";
import type { HindsightBankSetupProjection } from "@taki/shared";
import type { ConfigSource } from "../../../config/config-source.ts";
import { createCanonicalMemoryAuthorityRepo } from "../../../db/canonical-memory-authority-repo.ts";
import { readApplicationCheckpoint } from "../../../db/hindsight-application-replica-checkpoint.ts";
import { createHindsightBankSetupRepo } from "../../../db/hindsight-bank-setup-repo.ts";
import { createHindsightConnectionRepo } from "../../../db/hindsight-connection-repo.ts";
import type { Database } from "../../../db/sqlite.ts";
import type { SecretCatalogService } from "../../../secrets/secret-catalog-service.ts";
import { readMemoryAuthoritySelection } from "../../legacy-migration/legacy-activation-repo.ts";
import { readHindsightLiveProjection } from "../hindsight-runtime-connection.ts";
import { createHindsightConnectionSecret } from "../hindsight-secret-refs.ts";
import { readTemplateDefaults } from "./template-default-store.ts";
import { templateEqual } from "./template-integrity.ts";
import { TemplateBankIdentitySchema } from "./template-overlay-schema.ts";
import { TemplatePlanGuardSchema, type TemplatePlan, type TemplatePlanGuard, type TemplatePublication } from "./template-plan-schema.ts";
import { readTemplateEnrollment, readTemplateUser } from "./template-overlay-history.ts";
import { readAppliedTemplateSelection } from "./template-overlay-store.ts";

export interface TemplateGuardDependencies { db: Database; config: ConfigSource; secrets: SecretCatalogService }

export function captureTemplatePlanGuard(deps: TemplateGuardDependencies, manifestHash: string,
  provision?: Pick<TemplatePlanGuard["banks"][number], "identity" | "namespace">): TemplatePlanGuard {
  return TemplatePlanGuardSchema.parse({ ...captureTemplateLocalGuard(deps, provision), manifestHash });
}

/** Capture local identity before awaiting compatibility; its eventual manifest hash cannot conceal intervening drift. */
export function captureTemplateLocalGuard(deps: TemplateGuardDependencies,
  provision?: Pick<TemplatePlanGuard["banks"][number], "identity" | "namespace">): Omit<TemplatePlanGuard, "manifestHash"> {
  const selection = readMemoryAuthoritySelection(deps.db);
  if (selection.mode !== "hindsight" || !selection.epochId) changed();
  const epoch = createCanonicalMemoryAuthorityRepo(deps.db).authorityEpoch(selection.epochId);
  const live = readHindsightLiveProjection(deps);
  if (live.state !== "ready") changed();
  const rows = createHindsightBankSetupRepo(deps.db).list();
  if (!rows.length || rows.some((row) => row.status !== "verified" && row.externalBankId !== provision?.identity.target.bank_id)) changed();
  const connection = createHindsightConnectionRepo(deps.db).read(rows);
  if (connection.configFingerprint !== live.fingerprint) changed();
  const banks = rows.map((setup) => {
    const checkpoint = readApplicationCheckpoint(deps.db, setup.externalBankId);
    const pending = provision?.identity.target.bank_id === setup.externalBankId ? provision : undefined;
    const namespace = checkpoint?.namespace ?? pending?.namespace;
    if (!namespace || checkpoint && (checkpoint.bankDeleted || checkpoint.authorityEpochId !== epoch.epochId)
      || namespace.provider_lineage !== epoch.providerLineageId || pending && !templateEqual(namespace, pending.namespace)) changed();
    const identity = TemplateBankIdentitySchema.parse({ scope: setup.scope, canonicalIdentity: setup.canonicalIdentity,
      target: { provider_lineage: epoch.providerLineageId, bank_id: setup.externalBankId, bank_generation: namespace.bank_generation } });
    return { setup, identity, namespace };
  });
  return TemplatePlanGuardSchema.omit({ manifestHash: true }).parse({ epochId: epoch.epochId, providerLineage: epoch.providerLineageId,
    configFingerprint: live.fingerprint,
    configRevision: z.int().min(0).parse(deps.db.prepare("SELECT revision FROM hindsight_template_config_clock WHERE singleton=1").get()?.revision),
    secretMarker: createHindsightConnectionSecret(deps.secrets).marker(), connectionRevision: connection.revision,
    defaultsRevision: readTemplateDefaults(deps.db, epoch.providerLineageId)?.revision ?? 0,
    provisionBankId: provision?.identity.target.bank_id ?? null, banks });
}

export function assertTemplateLocalPlan(deps: TemplateGuardDependencies, input: { plan: TemplatePlan; publication?: TemplatePublication }): void {
  const provision = input.plan.guard.banks.find((entry) => entry.identity.target.bank_id === input.plan.guard.provisionBankId);
  const current = captureTemplatePlanGuard(deps, input.plan.guard.manifestHash, provision);
  const expected: TemplatePlanGuard = input.publication ? { ...input.plan.guard,
    connectionRevision: input.publication.connectionRevision, defaultsRevision: input.publication.defaultsRevision,
    banks: input.plan.guard.banks.map((entry) => ({ ...entry, setup: publishedTemplateBankSetup(input.plan, entry.setup, input.publication!.committedAt) })),
  } : input.plan.guard;
  if (!templateEqual(current, expected)) changed();
  for (const bank of input.plan.banks) {
    const enrollment = readTemplateEnrollment(deps.db, bank.identity);
    if (!templateEqual(enrollment, bank.enrollment)
      || readTemplateUser(deps.db, bank.identity)?.revision !== bank.preview.userRevision) changed();
    const selected = readAppliedTemplateSelection(deps.db, bank.identity);
    const published = input.publication?.selections.find((entry) => templateEqual(entry.identity, bank.identity));
    if ((selected?.revision ?? 0) !== (published?.revision ?? bank.expectedSelectionRevision)) changed();
    if (published && (selected?.receipt.receipt_hash !== published.receiptHash
      || selected.request.request_id !== bank.preview.request.request_id)) changed();
  }
}

export function publishedTemplateBankSetup(plan: TemplatePlan, setup: HindsightBankSetupProjection, committedAt: string): HindsightBankSetupProjection {
  const bank = plan.banks.find((entry) => entry.identity.target.bank_id === setup.externalBankId);
  if (!bank) return setup;
  // Refresh child outcomes live in the exact template receipt, independently of configuration readiness.
  return { ...setup, templateRevision: bank.preview.templateRevision, templateDigest: bank.preview.effectiveDefinitionHash,
    status: "verified", lastVerifiedAt: committedAt, lastError: null, operationIds: [] };
}
function changed(): never { throw new Error("MEMORY_TEMPLATE_IDENTITY_CHANGED"); }
