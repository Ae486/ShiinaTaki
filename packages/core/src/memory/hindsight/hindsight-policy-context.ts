/**
 * INPUT:  authenticated native versions, verified Bank ownership and persisted application lookup evidence
 * OUTPUT: exact scope/version checks and validated policy bodies for pure policy consumers
 * POS:    core/memory/hindsight — the hydrator proves native hashes; this seam refuses missing or mismatched proof
 */
import { HindsightCurrentCanonicalBankSchema, HindsightCurrentCanonicalUnitSchema,
  TakiApplicationArtifactVersionSchema, TakiApplicationMemoryBodySchema, TakiApplicationNamespaceSchema,
  TakiApplicationNativeVersionSchema, type CanonicalMemoryBank, type CanonicalMemoryUnit,
  type TakiApplicationArtifactVersion, type TakiApplicationFailureCode,
  type TakiApplicationNamespace, type TakiApplicationNativeVersion, type TakiMemoryPolicyProjection } from "@taki/shared";
import { requireLayerOwnership } from "../canonical-layer-policy.ts";
import { getLayer } from "../layer-registry.ts";

/** This address comes from an authenticated, coherent native/application read, never a recall excerpt. */
export interface HindsightPolicyAddress {
  namespace: TakiApplicationNamespace;
  bankId: string;
  native: TakiApplicationNativeVersion;
}

export interface VerifiedHindsightPolicyNative extends HindsightPolicyAddress {
  status: "verified";
  /** Full native unit normalized by the hydrator without substituting Taki layer tags. */
  unit: CanonicalMemoryUnit;
}

export interface HindsightPolicyContext {
  namespace: TakiApplicationNamespace;
  authorityEpochId: string;
  bank: CanonicalMemoryBank;
  activeCharacterId: string | null;
  native: VerifiedHindsightPolicyNative | { status: "unverified" };
}
export type VerifiedHindsightPolicyContext = Omit<HindsightPolicyContext, "native"> & {
  native: VerifiedHindsightPolicyNative;
};

export interface PersistedHindsightMemoryPolicy extends HindsightPolicyAddress {
  status: "present";
  artifact: TakiApplicationArtifactVersion;
  body: unknown;
}
export type HindsightPolicyLookup = PersistedHindsightMemoryPolicy
  | (HindsightPolicyAddress & { status: "authenticated-absence" })
  | { status: "unavailable" | "unverified" | "invalid" };

/** Closed diagnostics only: callers must not expose raw failed policy/evidence payloads. */
export class HindsightPolicyRefusal extends Error {
  readonly code: TakiApplicationFailureCode;
  constructor(code: TakiApplicationFailureCode) {
    super(code);
    this.name = "HindsightPolicyRefusal";
    this.code = code;
  }
}

export function requireHindsightPolicyContext(input: HindsightPolicyContext): VerifiedHindsightPolicyContext {
  if (input.native.status !== "verified") throw new HindsightPolicyRefusal("capture_required");
  const namespace = TakiApplicationNamespaceSchema.safeParse(input.namespace);
  const bank = HindsightCurrentCanonicalBankSchema.safeParse(input.bank);
  const unit = HindsightCurrentCanonicalUnitSchema.safeParse(input.native.unit);
  if (!namespace.success || !bank.success || !unit.success) throw new HindsightPolicyRefusal("binding_invalid");
  if (bank.data.authorityEpochId !== input.authorityEpochId || unit.data.authorityEpochId !== input.authorityEpochId
    || unit.data.bankId !== bank.data.bankId || bank.data.scope.kind === "character"
      && bank.data.scope.characterId !== input.activeCharacterId) throw new HindsightPolicyRefusal("namespace_mismatch");
  const version = TakiApplicationNativeVersionSchema.safeParse(input.native.native);
  if (!version.success || version.data.object_kind !== "memory_unit" || version.data.object_id !== unit.data.memoryId
    || version.data.object_revision !== unit.data.revision) throw new HindsightPolicyRefusal("binding_invalid");
  const context = { ...input, namespace: namespace.data, bank: bank.data,
    native: { ...input.native, native: version.data, unit: unit.data } };
  requireHindsightPolicyAddress(context, input.native);
  return context;
}

export function sameHindsightNativeVersion(left: TakiApplicationNativeVersion, right: TakiApplicationNativeVersion): boolean {
  return left.object_kind === right.object_kind && left.object_id === right.object_id
    && left.object_revision === right.object_revision && left.payload_hash === right.payload_hash
    && left.native_cursor === right.native_cursor;
}

export function sameHindsightPolicyNamespace(left: TakiApplicationNamespace, right: TakiApplicationNamespace): boolean {
  return left.application_id === right.application_id && left.provider_lineage === right.provider_lineage
    && left.bank_generation === right.bank_generation;
}

export function requireHindsightPolicyAddress(context: VerifiedHindsightPolicyContext, address: HindsightPolicyAddress): void {
  const namespace = TakiApplicationNamespaceSchema.safeParse(address.namespace);
  const version = TakiApplicationNativeVersionSchema.safeParse(address.native);
  if (!namespace.success || !version.success) throw new HindsightPolicyRefusal("binding_invalid");
  if (!sameHindsightPolicyNamespace(context.namespace, namespace.data) || address.bankId !== context.bank.bankId) {
    throw new HindsightPolicyRefusal("namespace_mismatch");
  }
  if (!sameHindsightNativeVersion(context.native.native, version.data)) {
    throw new HindsightPolicyRefusal("native_version_conflict");
  }
}

export function requirePersistedHindsightPolicy(context: VerifiedHindsightPolicyContext, state: PersistedHindsightMemoryPolicy) {
  requireHindsightPolicyAddress(context, state);
  const persisted = requireHindsightPolicyEvidence(state);
  requireHindsightPolicyOwnership(context, persisted.body.policy);
  return persisted;
}

/** The authenticated artifact binds this policy to its target even when the former native unit body is unavailable. */
export function requireHindsightPolicyEvidence(state: PersistedHindsightMemoryPolicy) {
  const artifact = TakiApplicationArtifactVersionSchema.safeParse(state.artifact);
  const body = TakiApplicationMemoryBodySchema.safeParse(state.body);
  const native = TakiApplicationNativeVersionSchema.safeParse(state.native);
  if (!artifact.success || artifact.data.key.artifact_kind !== "memory" || !body.success
    || body.data.source_artifacts.some((source) => source.key.artifact_kind !== "source")) {
    throw new HindsightPolicyRefusal("application_state_corrupt");
  }
  if (!native.success || native.data.object_kind !== "memory_unit"
    || !sameHindsightNativeVersion(body.data.assessment.target, native.data)) {
    throw new HindsightPolicyRefusal("binding_invalid");
  }
  return { body: body.data, artifact: artifact.data };
}

/** Original policy IDs remain in the artifact; only the active consumer projection adopts runtime IDs. */
export function projectHindsightApplicationPolicy(context: VerifiedHindsightPolicyContext, state: PersistedHindsightMemoryPolicy):
TakiMemoryPolicyProjection {
  const { body } = requirePersistedHindsightPolicy(context, state);
  return { ...body.policy, authorityEpochId: context.authorityEpochId,
    bankId: context.bank.bankId, memoryId: context.native.unit.memoryId };
}

export function requireHindsightPolicyOwnership(context: VerifiedHindsightPolicyContext, policy: TakiMemoryPolicyProjection): void {
  if (policy.layerId === "unclassified") return;
  const layer = getLayer(policy.layerId);
  if (!layer) throw new HindsightPolicyRefusal("policy_context_invalid");
  try { requireLayerOwnership(context.bank, layer); }
  catch { throw new HindsightPolicyRefusal("policy_context_invalid"); }
}
