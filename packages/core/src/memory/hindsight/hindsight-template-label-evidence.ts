/**
 * INPUT:  verified native unit, canonical Bank routing and the currently selected complete label group
 * OUTPUT: optional exact-version structured label after bounded authenticated Native evidence validation
 * POS:    core/memory/hindsight — asynchronous first-binding preload; no SQLite writes or caller-label inference
 */
import {
  HINDSIGHT_TEMPLATE_VERSION, HindsightTemplateLabelEvidenceRequestSchema, HindsightTemplateLabelEvidenceResultSchema,
  HindsightTemplateLabelGroupSchema, type HindsightTemplateLabelGroup,
} from "@taki/shared";
import { getLayer } from "../layer-registry.ts";
import { hindsightBankBindings } from "./hindsight-bank-identity.ts";
import type { HindsightClient, HindsightCallContext } from "./hindsight-client.ts";
import { HindsightError } from "./hindsight-errors.ts";
import type { HindsightTrustedUnitLabel } from "./hindsight-application-policy.ts";
import { requireHindsightPolicyContext, type VerifiedHindsightPolicyContext } from "./hindsight-policy-context.ts";
import { HindsightTemplateRefusal } from "./hindsight-template-client.ts";
import { templateEqual, templateHash } from "./template-lifecycle/template-integrity.ts";

interface Input {
  client: Pick<HindsightClient, "templateLabelEvidence">;
  context: VerifiedHindsightPolicyContext;
  group(): HindsightTemplateLabelGroup | null;
  request(): HindsightCallContext;
}

/** A label is consumed only while constructing an original provider-derived policy command. */
export async function loadHindsightTemplateUnitLabel(input: Input): Promise<HindsightTrustedUnitLabel | undefined> {
  input.request();
  const context = requireHindsightPolicyContext(input.context);
  const group = selectedGroup(input.group());
  const method = input.client.templateLabelEvidence;
  if (!method || !group || !canonicalBank(context)) return undefined;
  const native = context.native.native;
  const target = { provider_lineage: context.namespace.provider_lineage,
    bank_generation: context.namespace.bank_generation, bank_id: context.bank.bankId };
  const request = HindsightTemplateLabelEvidenceRequestSchema.safeParse({ contract_version: HINDSIGHT_TEMPLATE_VERSION, target,
    units: [{ unit_id: native.object_id, unit_revision: native.object_revision, unit_payload_hash: native.payload_hash }] });
  // Older imported IDs may be valid D77 IDs without being Native extraction UUIDs.
  // They remain usable but cannot gain this structured-extraction evidence.
  if (!request.success) return undefined;
  let response: unknown;
  try { response = await method({ request: request.data, context: input.request() }); }
  catch (error) {
    assertCurrentSelection(input, group);
    if (missingLabelEvidence(error)) return undefined;
    throw error;
  }
  assertCurrentSelection(input, group);
  const parsed = HindsightTemplateLabelEvidenceResultSchema.safeParse(response);
  if (!parsed.success || !templateEqual(parsed.data.target, target) || parsed.data.evidence.length !== 1) return undefined;
  const evidence = parsed.data.evidence[0];
  if (!evidence || !templateEqual(evidence.target, target) || evidence.unit_id !== native.object_id
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
