/**
 * INPUT:  one Bank's verified candidate units and currently selected complete label group
 * OUTPUT: exact-version labels from one bounded evidence request, isolating invalid IDs and per-unit proofs
 * POS:    core/memory/hindsight — asynchronous batch preload; selection is rechecked before policy preparation
 */
import type { z } from "zod";
import {
  HINDSIGHT_TEMPLATE_VERSION, HindsightTemplateLabelEvidenceRequestSchema,
  HindsightTemplateLabelGroupSchema, type HindsightTemplateLabelGroup, type HindsightTemplateLabelEvidenceSchema,
} from "@taki/shared";
import { getLayer } from "../layer-registry.ts";
import { hindsightBankBindings } from "./hindsight-bank-identity.ts";
import type { HindsightClient, HindsightCallContext } from "./hindsight-client.ts";
import { HindsightError } from "./hindsight-errors.ts";
import type { HindsightTrustedUnitLabel } from "./hindsight-application-policy.ts";
import { requireHindsightPolicyContext, type VerifiedHindsightPolicyContext } from "./hindsight-policy-context.ts";
import { HindsightTemplateRefusal, HindsightTemplateLabelEvidenceResponseSchema } from "./hindsight-template-client.ts";
import { templateEqual, templateHash } from "./template-lifecycle/template-integrity.ts";

interface Input {
  client: Pick<HindsightClient, "templateLabelEvidence">;
  contexts: VerifiedHindsightPolicyContext[];
  group(): HindsightTemplateLabelGroup | null;
  request(): HindsightCallContext;
}

/** A label is consumed only while constructing an original provider-derived policy command. */
export async function loadHindsightTemplateUnitLabels(input: Input): Promise<Map<string, HindsightTrustedUnitLabel>> {
  input.request();
  const labels = new Map<string, HindsightTrustedUnitLabel>();
  const group = selectedGroup(input.group());
  const method = input.client.templateLabelEvidence;
  const contexts = input.contexts.map(requireHindsightPolicyContext).filter(canonicalBank);
  const context = contexts[0];
  if (!method || !group || !context) return labels;
  const target = { provider_lineage: context.namespace.provider_lineage,
    bank_generation: context.namespace.bank_generation, bank_id: context.bank.bankId };
  // Older imported IDs may be valid D77 IDs without being Native extraction UUIDs.
  // Exclude them individually so the remaining candidates can still receive labels.
  const units = contexts.flatMap(({ native: { native } }) => {
    const unit = HindsightTemplateLabelEvidenceRequestSchema.shape.units.element.safeParse({
      unit_id: native.object_id, unit_revision: native.object_revision, unit_payload_hash: native.payload_hash });
    return unit.success ? [unit.data] : [];
  });
  const request = HindsightTemplateLabelEvidenceRequestSchema.safeParse({ contract_version: HINDSIGHT_TEMPLATE_VERSION, target, units });
  if (!request.success || units.length === 0) return labels;
  let response: unknown;
  try { response = await method({ request: request.data, context: input.request() }); }
  catch (error) {
    assertCurrentSelection(input, group);
    if (missingLabelEvidence(error)) return labels;
    throw error;
  }
  assertCurrentSelection(input, group);
  const parsed = HindsightTemplateLabelEvidenceResponseSchema.safeParse(response);
  if (!parsed.success || !templateEqual(parsed.data.target, target)) return labels;
  for (const candidate of contexts) {
    const proofs = parsed.data.evidence.filter((entry) => entry.unit_id === candidate.native.native.object_id);
    const label = proofs.length === 1 ? trustedLabel(candidate, group, proofs[0]!) : undefined;
    if (label) labels.set(candidate.native.native.object_id, label);
  }
  return labels;
}

function trustedLabel(context: VerifiedHindsightPolicyContext, group: HindsightTemplateLabelGroup,
  evidence: z.infer<typeof HindsightTemplateLabelEvidenceSchema>): HindsightTrustedUnitLabel | undefined {
  const native = context.native.native;
  const target = { provider_lineage: context.namespace.provider_lineage,
    bank_generation: context.namespace.bank_generation, bank_id: context.bank.bankId };
  if (!templateEqual(evidence.target, target) || evidence.unit_id !== native.object_id
    || evidence.unit_revision !== native.object_revision || evidence.unit_payload_hash !== native.payload_hash
    || evidence.scope !== context.bank.scope.kind || evidence.group_definition_hash !== templateHash("definition", group)
    || !group.values?.some((entry) => entry.value === evidence.value) || !oneCanonicalTag(context, evidence.value)) return undefined;
  const layer = getLayer(evidence.value);
  if (!layer || (layer.ownership === "global" ? "global" : "character") !== context.bank.scope.kind) return undefined;
  // This producer attests only the raw per-fact value. No disclosure is supplied
  // by its contract; existing pinned and mood guards remain the policy authority.
  return { namespace: context.namespace, bankId: context.bank.bankId, native, layerId: layer.id, disclosure: null };
}

function selectedGroup(value: HindsightTemplateLabelGroup | null) {
  const result = HindsightTemplateLabelGroupSchema.safeParse(value);
  if (!result.success) return null;
  const group = result.data;
  // Native's existing parser infers a legacy group's type, but that interpretation
  // must not add defaults to the supplied document whose complete bytes are hashed.
  const type = group.type ?? (group.free_values ? "text" : group.multi_value ? "multi-values" : "value");
  if (group.key !== "taki-layer" || type !== "value" || group.tag !== true || !group.values?.length) return null;
  return group;
}

function canonicalBank(context: VerifiedHindsightPolicyContext): boolean {
  const scope = context.bank.scope;
  const binding = hindsightBankBindings(scope.characterId ?? "global").find((entry) => entry.scope === scope.kind);
  return binding?.externalBankId === context.bank.bankId
    && binding.canonicalIdentity === (scope.kind === "global" ? "global" : `character:${scope.characterId}`);
}

function oneCanonicalTag(context: VerifiedHindsightPolicyContext, value: string): boolean {
  const tags = context.native.unit.tags.filter((tag) => tag.startsWith("taki-layer:"));
  return tags.length === 1 && tags[0] === `taki-layer:${value}`;
}

function assertCurrentSelection(input: Input, captured: HindsightTemplateLabelGroup): void {
  input.request();
  if (!templateEqual(captured, input.group())) throw new Error("MEMORY_TEMPLATE_IDENTITY_CHANGED");
  input.request();
}

function missingLabelEvidence(error: unknown): boolean {
  return error instanceof HindsightTemplateRefusal && ["unsupported_storage", "unsupported_value"].includes(error.reason)
    || error instanceof HindsightError && ["HINDSIGHT_EXTENSION_UNSUPPORTED", "HINDSIGHT_RESPONSE_INVALID"].includes(error.code);
}
