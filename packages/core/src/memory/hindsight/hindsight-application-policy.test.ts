import { describe, expect, it } from "vitest";
import { HindsightCurrentCanonicalRecordSchema, TakiApplicationMemoryBodySchema, TAKI_MEMORY_DEFAULT_IMPORTANCE,
  type CanonicalMemoryRecord, type CanonicalMemoryUnit, type TakiApplicationMemoryBody,
  type TakiApplicationNamespace, type TakiApplicationNativeVersion, type TakiMemoryPolicyProjection } from "@taki/shared";
import { resolveHindsightApplicationPolicy, type HindsightNewMemoryEvidence } from "./hindsight-application-policy.ts";
import { hindsightPolicyAdmission, projectHindsightPolicyLayerTags } from "./hindsight-policy-admission.ts";
import { proposeHindsightPolicyAssessment, proposeHindsightPolicyFailure,
  rebindHindsightApplicationPolicy, rebindHindsightApplicationPolicyEvidence } from "./hindsight-policy-assessment.ts";
import { type HindsightPolicyContext, type PersistedHindsightMemoryPolicy,
  type VerifiedHindsightPolicyContext } from "./hindsight-policy-context.ts";

const at = "2026-09-11T08:00:00.000Z";
const later = "2026-09-12T08:00:00.000Z";
const namespace: TakiApplicationNamespace = {
  application_id: "taki", provider_lineage: "11111111-1111-4111-8111-111111111111",
  bank_generation: "22222222-2222-4222-8222-222222222222",
};

describe("first Hindsight policy", () => {
  it("proposes one explicit neutral policy only after authenticated exact absence", () => {
    const f = fixture();
    const result = initialize(f);
    expect(result.kind).toBe("initialize");
    expect(result).not.toHaveProperty("policy");
    expect(result.body.policy).toMatchObject({ layerId: "unclassified", visibility: "retrieved",
      importance: TAKI_MEMORY_DEFAULT_IMPORTANCE, origin: "observed", disclosure: null,
      emotionalWeight: null, retention: { kind: "permanent" }, policyVersion: 4, updatedAt: at });
    expect(result.body.assessment).toEqual({ state: "due", target: f.context.native.native, attempts: 0,
      next_attempt_at: null, last_failure_code: null, prompt_version: null, prompt_hash: null, completed_at: null });
  });

  it("reuses persisted first insertion identity on repeated reads", () => {
    const f = fixture();
    const first = initialize(f);
    const state = { ...f.state, body: first.body };
    const again = resolveHindsightApplicationPolicy({ context: f.context, state,
      initial: { stamp: { policyVersion: 999, updatedAt: later }, evidence: { kind: "provider-derived", observedAt: later } } });
    expect(again.kind).toBe("existing");
    expect(again.body).toEqual(first.body);
    expect(again.body.policy.policyVersion).toBe(4);
    expect(again.body.policy.updatedAt).toBe(at);
  });

  it("does not create source or conversation evidence for a provider-created observation", () => {
    const f = fixture(); f.context.native.unit.factType = "observation";
    const { body } = initialize(f);
    expect(body.provenance).toMatchObject({ actor: "provider", origin: "provider-derived", characterId: null,
      timelineFromSeq: null, timelineToSeq: null, capturedAt: at, sanitized: true });
    expect(body.provenance.sourceRef).toContain(namespace.bank_generation);
    expect(body.provenance.sourceRef).toContain("memory_unit:native-unit@7");
    expect(body.original_record).toBeNull();
    expect(body.source_artifacts).toEqual([]);
    expect(body.encoded_metadata).toBeNull();
  });

  it.each(["world", "experience", "observation"] as const)("admits neutral %s input before detailed assessment", (factType) => {
    const f = fixture(); f.context.native.unit.factType = factType;
    const { body } = initialize(f);
    expect(admit(f, body)).toEqual({ eligible: true });
    expect(body.assessment.state).toBe("due");
  });

  it.each([{ sources: ["native-source"] }, { sources: ["native-source", "other-source"] }, { sources: [] }])("admits an observation with declared references $sources under its own current policy", ({ sources }) => {
    const f = fixture(); f.context.native.unit.factType = "observation";
    f.context.native.unit.sourceMemoryIds = sources;
    const { body } = initialize(f);
    expect(admit(f, body)).toEqual({ eligible: true });
    expect(body.policy.visibility).toBe("retrieved");
    expect(body.assessment.state).toBe("due");
  });

  it.each(["retrieved", "pinned", "mood-gated"] as const)("applies curated/assessed %s policy to an ordinary observation", (visibility) => {
    const f = fixture(visibility === "mood-gated" ? "character" : "global"); f.context.native.unit.factType = "observation";
    const body: TakiApplicationMemoryBody = { ...f.body, policy_basis: "curated",
      policy: { ...f.body.policy, layerId: visibility === "mood-gated" ? "intentions" : "profile", visibility, disclosure: "specific topic" },
      assessment: { ...f.body.assessment, state: "assessed", attempts: 1, prompt_version: "policy-v1",
        prompt_hash: "e".repeat(64), completed_at: at } };
    expect(admit(f, body, "")).toEqual(visibility === "mood-gated" ? { eligible: false, reason: "mood-gated" } : { eligible: true });
    expect(admit(f, body, "specific topic")).toEqual({ eligible: true });
  });

  it.each(["unavailable", "unverified", "invalid"] as const)("never turns %s application state into neutral absence", (status) => {
    const f = fixture();
    expect(() => resolveHindsightApplicationPolicy({ context: f.context, state: { status }, initial: f.initial })).toThrow();
  });

  it("requires repository insertion stamps and refuses payload fields hidden inside the stamp", () => {
    const f = fixture();
    expect(() => resolveHindsightApplicationPolicy({ context: f.context, state: f.absence })).toThrow("capture_required");
    expect(() => initialize(f, { stamp: { policyVersion: 0, updatedAt: at } })).toThrow();
    expect(() => initialize(f, { stamp: { policyVersion: 1, updatedAt: "not-a-date" } })).toThrow();
    const injected = { policyVersion: 1, updatedAt: at, visibility: "pinned" };
    expect(() => initialize(f, { stamp: injected })).toThrow();
  });

  it("checks known Bank and actor ownership before a first policy can exist", () => {
    const f = fixture("character");
    expect(() => initialize({ ...f, context: { ...f.context, activeCharacterId: "other-character" } })).toThrow("namespace_mismatch");
    expect(() => initialize({ ...f, context: { ...f.context, authorityEpochId: "other-epoch" } })).toThrow("namespace_mismatch");
    const wrongBank = structuredClone(f); wrongBank.context.native.unit.bankId = "other-bank";
    expect(() => initialize(wrongBank)).toThrow("namespace_mismatch");
    const wrongGeneration = structuredClone(f); wrongGeneration.absence.namespace.bank_generation = namespace.provider_lineage;
    expect(() => initialize(wrongGeneration)).toThrow("namespace_mismatch");
  });

  it.each(["world", "experience", "observation"] as const)("refuses unverified identity, stale native binding and malformed lifecycle for %s", (factType) => {
    const f = fixture(); f.context.native.unit.factType = factType;
    const unverified: HindsightPolicyContext = { ...f.context, native: { status: "unverified" } };
    expect(() => resolveHindsightApplicationPolicy({ context: unverified, state: f.absence, initial: f.initial })).toThrow("capture_required");
    const stale = { ...f.absence, native: { ...f.absence.native, object_revision: 6 } };
    expect(() => resolveHindsightApplicationPolicy({ context: f.context, state: stale, initial: f.initial })).toThrow("native_version_conflict");
    f.context.native.unit.invalidatedAt = at;
    expect(() => initialize(f)).toThrow("binding_invalid");
  });

  it("does not assert sanitized ingress for a secret-bearing native body", () => {
    const f = fixture(); f.context.native.unit.text = "password: private-value";
    expect(() => initialize(f)).toThrow("policy_context_invalid");
    f.context.native.unit.text = "An ordinary native memory";
    f.context.native.unit.context = "<turn-context>hidden prompt</turn-context>";
    expect(() => initialize(f)).toThrow("policy_context_invalid");
  });
});

describe("trusted per-unit registry policy", () => {
  it("resolves a sufficient profile label without model evidence", () => {
    const f = fixture(); f.context.native.unit.tags = ["native-tag", "taki-layer:profile"];
    const result = initialize(f, { label: { ...address(f.context), layerId: "profile", disclosure: null } });
    expect(result.body.policy_basis).toBe("registry");
    expect(result.body.policy).toMatchObject({ layerId: "profile", visibility: "retrieved", retention: { kind: "permanent" } });
    expect(result.body.assessment).toMatchObject({ state: "not_required", attempts: 0, prompt_hash: null, completed_at: null });
  });

  it("does not treat raw native or document labels as trusted unit classification", () => {
    const f = fixture(); f.context.native.unit.tags = ["taki-layer:profile"];
    expect(initialize(f).body.policy_basis).toBe("neutral");
    const label = { ...address(f.context), layerId: "profile", disclosure: null,
      native: { ...f.context.native.native, object_kind: "document" as const } };
    expect(() => initialize(f, { label })).toThrow("native_version_conflict");
  });

  it.each([
    { kind: "character", layer: "relationship", disclosure: null },
    { kind: "character", layer: "intentions", disclosure: null },
    { kind: "character", layer: "profile", disclosure: null },
    { kind: "global", layer: "unknown", disclosure: null },
  ] as const)("keeps insufficient or incompatible $layer evidence neutral", ({ kind, layer, disclosure }) => {
    const f = fixture(kind); f.context.native.unit.tags = [`taki-layer:${layer}`];
    expect(initialize(f, { label: { ...address(f.context), layerId: layer, disclosure } }).body).toMatchObject({
      policy_basis: "neutral", policy: { layerId: "unclassified", visibility: "retrieved" }, assessment: { state: "due" },
    });
  });

  it("requires complete mood disclosure before resolving intentions", () => {
    const f = fixture("character"); f.context.native.unit.tags = ["taki-layer:intentions"];
    const result = initialize(f, { label: { ...address(f.context), layerId: "intentions", disclosure: "movie" } });
    expect(result.body.policy).toMatchObject({ layerId: "intentions", visibility: "mood-gated", disclosure: "movie",
      retention: { kind: "expiring" } });
    expect(admit(f, result.body, "A movie tonight")).toEqual({ eligible: true });
    expect(admit(f, result.body, "A different topic")).toEqual({ eligible: false, reason: "mood-gated" });
  });

  it("replaces only the consumer Taki layer tag and leaves exact native evidence untouched", () => {
    const f = fixture(); f.context.native.unit.tags = ["native:a", "taki-layer:profile", "native:b", "taki-layer:episodes"];
    const exact = structuredClone(f.context.native.unit);
    const result = initialize(f, { label: { ...address(f.context), layerId: "profile", disclosure: null } });
    const tags = projectHindsightPolicyLayerTags(f.context.native.unit.tags, result.body.policy);
    const record = HindsightCurrentCanonicalRecordSchema.parse({ unit: { ...f.context.native.unit, tags },
      policy: result.body.policy, provenance: result.body.provenance });
    expect(record.unit.tags).toEqual(["native:a", "native:b", "taki-layer:unclassified"]);
    expect(f.context.native.unit).toEqual(exact);
    expect(f.context.native.native.payload_hash).toBe("a".repeat(64));
  });
});

describe("existing policy and original unit evidence", () => {
  it("preserves original unit policy/provenance and keeps source artifacts separate", () => {
    const f = fixture();
    const original = originalRecord(f, { visibility: "hidden", importance: 8 });
    const source = { key: { artifact_kind: "source" as const, artifact_id: "source-owned-by-user" }, revision: 3, record_hash: "c".repeat(64) };
    const evidence: HindsightNewMemoryEvidence = { kind: "verified-unit", ...address(f.context),
      provenance: original.provenance, origin: "observed", sourceArtifacts: [source], originalRecord: original,
      encodedMetadata: { unitOnly: "[1,null]", untouched: "1" } };
    const result = initialize(f, { evidence });
    expect(result.body.original_record).toEqual(original);
    expect(result.body.policy).toEqual(original.policy);
    expect(result.body.provenance).toEqual(original.provenance);
    expect(result.body.provenance.actor).toBe("agent");
    expect(result.body.provenance.origin).toBe("explicit-agent");
    expect(result.body.source_artifacts).toEqual([source]);
    expect(result.body.encoded_metadata).toEqual(evidence.encodedMetadata);
    expect(result.body.assessment.state).toBe("not_required");
    const restored = resolveHindsightApplicationPolicy({ context: f.context, state: { ...f.state, body: result.body } });
    expect(restored.kind === "existing" && restored.policy).toMatchObject({ authorityEpochId: "active-epoch",
      bankId: "native-bank", memoryId: "native-unit", visibility: "hidden" });
    expect(restored.body.policy.memoryId).toBe("original-unit");
    expect(restored.body.original_record).toEqual(original);
  });

  it("does not substitute original source provenance for unit provenance", () => {
    const f = fixture(); const original = originalRecord(f);
    const evidence: HindsightNewMemoryEvidence = { kind: "verified-unit", ...address(f.context),
      provenance: { ...original.provenance, actor: "user", origin: "explicit-user" }, origin: "self",
      sourceArtifacts: [], originalRecord: original, encodedMetadata: {} };
    expect(() => initialize(f, { evidence })).toThrow("binding_invalid");
    expect(() => initialize(f, { evidence: { ...evidence, provenance: original.provenance,
      native: { ...f.context.native.native, payload_hash: "d".repeat(64) } } })).toThrow("native_version_conflict");
  });

  it("refuses malformed or wrongly bound existing state without using the supplied neutral defaults", () => {
    const f = fixture();
    for (const body of [{}, { ...f.body, policy: { ...f.body.policy, importance: 0 } },
      { ...f.body, assessment: { ...f.body.assessment, target: { ...f.context.native.native, object_revision: 6 } } },
      { ...f.body, source_artifacts: [{ ...f.state.artifact }] }]) {
      expect(() => resolveHindsightApplicationPolicy({ context: f.context, state: { ...f.state, body }, initial: f.initial })).toThrow();
    }
    const wrongScope = { ...f.body, policy: { ...f.body.policy, layerId: "relationship" } };
    expect(() => resolveHindsightApplicationPolicy({ context: f.context, state: { ...f.state, body: wrongScope } })).toThrow("policy_context_invalid");
  });

  it.each(([
    { policy: { visibility: "hidden" }, query: "hello", reason: "hidden" },
    { policy: { retention: { kind: "expiring", expiresAt: at } }, query: "hello", reason: "retention" },
    { policy: { visibility: "mood-gated", disclosure: "movie" }, query: "hello", reason: "mood-gated" },
    { policy: { visibility: "mood-gated", disclosure: null }, query: "hello", reason: "mood-gated" },
  ] as const).flatMap((sample) => (["world", "experience", "observation"] as const).map((factType) => ({ ...sample, factType }))))(
    "honors $reason for $factType even when policy assessment is due", ({ policy, query, reason, factType }) => {
    const f = fixture(); f.context.native.unit.factType = factType;
    const body = TakiApplicationMemoryBodySchema.parse({ ...f.body, policy: { ...f.body.policy, ...policy } });
    expect(admit(f, body, query)).toEqual({ eligible: false, reason });
  });

  it("honors declared rolling and importance-decay expiry using the existing retention rules", () => {
    const f = fixture(); f.context.native.unit.updatedAt = "2026-01-01T00:00:00.000Z";
    for (const retention of [{ kind: "rolling-window", days: 30 },
      { kind: "importance-decay", archiveBelowImportance: 6, afterDays: 90 }]) {
      const body = TakiApplicationMemoryBodySchema.parse({ ...f.body, policy: { ...f.body.policy, retention } });
      expect(admit(f, body)).toEqual({ eligible: false, reason: "retention" });
    }
    expect(admit(f, f.body)).toEqual({ eligible: true });
  });

  it("keeps detailed assessment independent from native confirmation and eligibility", () => {
    const f = fixture();
    expect(admit(f, f.body)).toEqual({ eligible: true });
    const failed = proposeHindsightPolicyFailure({ ...assessmentTarget(f), failure: "model_unavailable",
      nextAttemptAt: later, prompt: null });
    expect(admit(f, failed)).toEqual({ eligible: true });
    expect(failed.policy).toEqual(f.body.policy);
    expect(f.context.native.unit.state).toBe("valid");
    expect(failed.assessment.target).toEqual(f.context.native.native);
    expect(failed.assessment).toMatchObject({ state: "failed", attempts: 1, next_attempt_at: later, prompt_hash: null });
    expect(failed).not.toHaveProperty("pending_phase");
  });

  it("keeps empty Canonical layer filters unrestricted while honoring an explicit layer selection", () => {
    const f = fixture();
    expect(hindsightPolicyAdmission({ context: f.context, state: f.state, at, query: "hello", layerIds: [] }))
      .toEqual({ eligible: true });
    expect(hindsightPolicyAdmission({ context: f.context, state: f.state, at, query: "hello", layerIds: ["profile"] }))
      .toEqual({ eligible: false, reason: "outside-layers" });
  });
});

describe("native rebinding and curator CAS", () => {
  it.each([
    { visibility: "hidden" },
    { visibility: "mood-gated", disclosure: "movie" },
    { retention: { kind: "expiring", expiresAt: later } },
    { visibility: "pinned" },
  ] as const)("preserves restriction %# after native tags are removed", (policy) => {
    const f = fixture(); f.body = TakiApplicationMemoryBodySchema.parse({ ...f.body,
      policy_basis: "curated", policy: { ...f.body.policy, layerId: "profile", ...policy } });
    f.state.body = f.body;
    const current = evolve(f.context); current.native.unit.tags = [];
    const result = rebindHindsightApplicationPolicy({ previous: { context: f.context, state: f.state },
      current, expectedArtifact: f.state.artifact });
    expect(result.policy).toEqual(f.body.policy);
    expect(result.policy_basis).toBe("curated");
    expect(result.assessment).toMatchObject({ state: "due", target: current.native.native, attempts: 0, completed_at: null });
    expect(result.original_record).toEqual(f.body.original_record);
    expect(f.body.assessment.target.object_revision).toBe(7);
  });

  it("cannot read a new native revision under an old policy binding", () => {
    const f = fixture(); const current = evolve(f.context);
    expect(() => hindsightPolicyAdmission({ context: current, state: f.state, at, query: "hello" })).toThrow("native_version_conflict");
    const rebound = rebindHindsightApplicationPolicy({ previous: { context: f.context, state: f.state },
      current, expectedArtifact: f.state.artifact });
    expect(hindsightPolicyAdmission({ context: current, state: { ...f.state, ...address(current), body: rebound }, at, query: "hello" })).toEqual({ eligible: true });
  });

  it.each(["world", "experience", "observation"] as const)("preserves policy while authoritative invalidation suppresses %s recall", (factType) => {
    const f = fixture(); f.context.native.unit.factType = factType; const current = evolve(f.context);
    current.native.unit.state = "invalidated"; current.native.unit.invalidatedAt = later;
    const body = rebindHindsightApplicationPolicy({ previous: { context: f.context, state: f.state },
      current, expectedArtifact: f.state.artifact });
    expect(body.policy).toEqual(f.body.policy);
    expect(hindsightPolicyAdmission({ context: current, state: { ...f.state, ...address(current), body }, at, query: "hello" }))
      .toEqual({ eligible: false, reason: "invalidated" });
    expect(() => resolveHindsightApplicationPolicy({ context: current,
      state: { ...address(current), status: "authenticated-absence" }, initial: f.initial })).toThrow("policy_context_invalid");
  });

  it("refuses same-ID rebind across generations or stale artifact state", () => {
    const f = fixture(); const current = evolve(f.context);
    const wrong = structuredClone(current); wrong.namespace.bank_generation = namespace.provider_lineage;
    wrong.native.namespace.bank_generation = namespace.provider_lineage;
    expect(() => rebindHindsightApplicationPolicy({ previous: { context: f.context, state: f.state }, current: wrong,
      expectedArtifact: f.state.artifact })).toThrow("namespace_mismatch");
    expect(() => rebindHindsightApplicationPolicy({ previous: { context: f.context, state: f.state }, current,
      expectedArtifact: { ...f.state.artifact, revision: 99 } })).toThrow("artifact_conflict");
    expect(() => rebindHindsightApplicationPolicy({ previous: { context: f.context, state: f.state }, current: f.context,
      expectedArtifact: f.state.artifact })).toThrow("native_version_conflict");
  });

  it("rebinds from the authenticated old artifact target without requiring a reconstructed historical native unit", () => {
    const f = fixture(); const current = evolve(f.context);
    const result = rebindHindsightApplicationPolicyEvidence({ previous: f.state, current, expectedArtifact: f.state.artifact });
    expect(result).toEqual(rebindHindsightApplicationPolicy({ previous: { context: f.context, state: f.state }, current,
      expectedArtifact: f.state.artifact }));
    expect(result.policy).toEqual(f.body.policy);
    expect(result.assessment.target).toEqual(current.native.native);
    expect(() => rebindHindsightApplicationPolicyEvidence({ previous: { ...f.state,
      body: { ...f.body, assessment: { ...f.body.assessment, target: current.native.native } } }, current,
    expectedArtifact: f.state.artifact })).toThrow("binding_invalid");
    expect(() => rebindHindsightApplicationPolicyEvidence({ previous: f.state, current: f.context,
      expectedArtifact: f.state.artifact })).toThrow("native_version_conflict");
  });

  it.each(["nativeRevision", "nativeHash", "nativeCursor", "artifactRevision", "artifactHash", "policyVersion"])(
    "rejects stale curated %s before making any policy proposal", (field) => {
      const f = fixture(); const target = assessmentTarget(f);
      if (field === "nativeRevision") target.expectedNative = { ...target.expectedNative, object_revision: 6 };
      if (field === "nativeHash") target.expectedNative = { ...target.expectedNative, payload_hash: "f".repeat(64) };
      if (field === "nativeCursor") target.expectedNative = { ...target.expectedNative, native_cursor: null };
      if (field === "artifactRevision") target.expectedArtifact = { ...target.expectedArtifact, revision: 99 };
      if (field === "artifactHash") target.expectedArtifact = { ...target.expectedArtifact, record_hash: "f".repeat(64) };
      if (field === "policyVersion") target.expectedPolicyVersion = 99;
      expect(() => proposeHindsightPolicyAssessment({ ...target, ...assessmentResult() })).toThrow();
      expect(f.body.policy.layerId).toBe("unclassified");
      expect(f.body.assessment.state).toBe("due");
    },
  );

  it("records actual successful evidence only in a CAS-ready policy proposal", () => {
    const f = fixture();
    const proposal = proposeHindsightPolicyAssessment({ ...assessmentTarget(f), ...assessmentResult() });
    expect(proposal.policy).toMatchObject({ layerId: "profile", visibility: "retrieved", policyVersion: 5, updatedAt: later });
    expect(proposal.policy_basis).toBe("curated");
    expect(proposal.assessment).toEqual({ state: "assessed", target: f.context.native.native, attempts: 1,
      next_attempt_at: null, last_failure_code: null, prompt_version: "policy-v1", prompt_hash: "e".repeat(64), completed_at: later });
    expect(f.body.policy.policyVersion).toBe(4);
  });

  it("keeps original policy identities and unit evidence through rebind, failed review and successful curation", () => {
    const f = fixture(); const original = originalRecord(f, { visibility: "hidden" });
    f.body = initialize(f, { evidence: { kind: "verified-unit", ...address(f.context), provenance: original.provenance,
      origin: original.policy.origin, sourceArtifacts: [], originalRecord: original, encodedMetadata: { unitOnly: "[1,null]" } } }).body;
    f.state.body = f.body;
    const current = evolve(f.context);
    const rebound = rebindHindsightApplicationPolicy({ previous: { context: f.context, state: f.state }, current,
      expectedArtifact: f.state.artifact });
    const state = { ...f.state, ...address(current), body: rebound };
    const target = { context: current, state, expectedNative: current.native.native,
      expectedArtifact: state.artifact, expectedPolicyVersion: rebound.policy.policyVersion };
    const failed = proposeHindsightPolicyFailure({ ...target, failure: "model_unavailable", nextAttemptAt: later, prompt: null });
    expect(failed.policy.visibility).toBe("hidden");
    const successful = proposeHindsightPolicyAssessment({ ...target, ...assessmentResult() });
    expect(successful.policy).toMatchObject({ authorityEpochId: "original-epoch", bankId: "original-bank",
      memoryId: "original-unit", origin: "self", policyVersion: original.policy.policyVersion + 1 });
    expect(successful.original_record).toEqual(original);
    expect(successful.provenance).toEqual(original.provenance);
    expect(successful.encoded_metadata).toEqual(f.body.encoded_metadata);
    expect(original.policy.visibility).toBe("hidden");
  });

  it("requires a deliberate action for a pin, including profile importance promotion", () => {
    const f = fixture("character");
    const result = assessmentResult(); result.policy.layerId = "relationship"; result.policy.visibility = "pinned";
    expect(() => proposeHindsightPolicyAssessment({ ...assessmentTarget(f), ...result, intent: "automatic" })).toThrow("policy_context_invalid");
    expect(proposeHindsightPolicyAssessment({ ...assessmentTarget(f), ...result, intent: "deliberate" }).policy.visibility).toBe("pinned");
    const global = fixture(); const high = assessmentResult(); high.policy.importance = 9;
    expect(() => proposeHindsightPolicyAssessment({ ...assessmentTarget(global), ...high, intent: "automatic" })).toThrow("policy_context_invalid");
  });

  it.each([
    { scope: "global", layerId: "profile", visibility: "retrieved", importance: 9, nextImportance: 9 },
    { scope: "character", layerId: "relationship", visibility: "pinned", importance: 8, nextImportance: 7 },
  ] as const)("allows an automatic assessment to retain the existing effective $layerId pin", (sample) => {
    const f = fixture(sample.scope);
    f.body = { ...f.body, policy_basis: "curated", policy: { ...f.body.policy,
      layerId: sample.layerId, visibility: sample.visibility, importance: sample.importance } };
    f.state.body = f.body;
    const result = assessmentResult();
    result.policy = { ...result.policy, layerId: sample.layerId, visibility: sample.visibility, importance: sample.nextImportance };
    const proposal = proposeHindsightPolicyAssessment({ ...assessmentTarget(f), ...result, intent: "automatic" });
    expect(proposal.policy).toMatchObject({ layerId: sample.layerId, visibility: sample.visibility, importance: sample.nextImportance });
    expect(proposal.assessment.state).toBe("assessed");
  });

  it.each([
    { scope: "global", previousLayer: "profile", previousVisibility: "retrieved", previousImportance: 8, layer: "profile", visibility: "retrieved", importance: 9 },
    { scope: "global", previousLayer: "profile", previousVisibility: "retrieved", previousImportance: 9, layer: "profile", visibility: "retrieved", importance: 10 },
    { scope: "global", previousLayer: "profile", previousVisibility: "retrieved", previousImportance: 9, layer: "profile", visibility: "pinned", importance: 9 },
    { scope: "global", previousLayer: "profile", previousVisibility: "hidden", previousImportance: 10, layer: "profile", visibility: "retrieved", importance: 9 },
    { scope: "global", previousLayer: "profile", previousVisibility: "hidden", previousImportance: 10, layer: "profile", visibility: "pinned", importance: 9 },
    { scope: "character", previousLayer: "relationship", previousVisibility: "pinned", previousImportance: 8, layer: "episodes", visibility: "pinned", importance: 8 },
  ] as const)("rejects automatic new-pin, hidden promotion, layer transfer or increased pin authority %#", (sample) => {
    const f = fixture(sample.scope);
    f.body = { ...f.body, policy_basis: "curated", policy: { ...f.body.policy,
      layerId: sample.previousLayer, visibility: sample.previousVisibility, importance: sample.previousImportance } };
    f.state.body = f.body;
    const result = assessmentResult();
    result.policy = { ...result.policy, layerId: sample.layer, visibility: sample.visibility, importance: sample.importance };
    expect(() => proposeHindsightPolicyAssessment({ ...assessmentTarget(f), ...result, intent: "automatic" }))
      .toThrow("policy_context_invalid");
  });

  it("rejects an assessment trying to replace identities, origin or source evidence", () => {
    const f = fixture(); const result = assessmentResult();
    const policy = { ...result.policy, authorityEpochId: "forged", memoryId: "forged", origin: "self" };
    expect(() => proposeHindsightPolicyAssessment({ ...assessmentTarget(f), ...result, policy })).toThrow();
  });
});

function fixture(kind: "global" | "character" = "global") {
  const version: TakiApplicationNativeVersion = { object_kind: "memory_unit", object_id: "native-unit",
    object_revision: 7, payload_hash: "a".repeat(64), native_cursor: 12 };
  const unit: CanonicalMemoryUnit = { authorityEpochId: "active-epoch", bankId: "native-bank", memoryId: "native-unit",
    documentId: null, chunkId: null, text: "An ordinary native memory", context: null, factType: "world", state: "valid",
    revision: 7, tags: [], metadata: { native: "untouched" }, entities: [], sourceMemoryIds: [], observationScopes: null,
    eventDate: null, occurredStart: null, occurredEnd: null, mentionedAt: null, createdAt: at, updatedAt: at, editedAt: null,
    consolidatedAt: null, consolidationFailedAt: null, invalidationReason: null, invalidatedAt: null, proofCount: 1 };
  const context: VerifiedHindsightPolicyContext = { namespace: { ...namespace }, authorityEpochId: "active-epoch", activeCharacterId: "taki",
    bank: { authorityEpochId: "active-epoch", bankId: "native-bank", scope: kind === "global"
      ? { kind: "global", characterId: null } : { kind: "character", characterId: "taki" }, name: "Memory",
      disposition: { skepticism: 3, literalism: 3, empathy: 3 }, mission: "", config: {}, revision: 1, createdAt: at, updatedAt: at },
    native: { status: "verified", namespace: { ...namespace }, bankId: "native-bank", native: version, unit } };
  const body = TakiApplicationMemoryBodySchema.parse({ policy_basis: "neutral",
    policy: { authorityEpochId: "active-epoch", bankId: "native-bank", memoryId: "native-unit", layerId: "unclassified",
      importance: 5, visibility: "retrieved", disclosure: null, origin: "observed", emotionalWeight: null,
      retention: { kind: "permanent" }, policyVersion: 4, updatedAt: at },
    assessment: { state: "due", target: version, attempts: 0, next_attempt_at: null,
      last_failure_code: null, prompt_version: null, prompt_hash: null, completed_at: null },
    provenance: { actor: "provider", origin: "provider-derived", characterId: context.bank.scope.characterId,
      timelineFromSeq: null, timelineToSeq: null, capturedAt: at, sanitized: true, sourceRef: "verified-native-reference" },
    source_artifacts: [], original_record: null, encoded_metadata: null });
  const state: PersistedHindsightMemoryPolicy = { status: "present", ...address(context), body,
    artifact: { key: { artifact_kind: "memory", artifact_id: "unit-artifact" }, revision: 2, record_hash: "b".repeat(64) } };
  const initial = { stamp: { policyVersion: 4, updatedAt: at }, evidence: { kind: "provider-derived" as const, observedAt: at } };
  return { context, body, state, initial, absence: { status: "authenticated-absence" as const, ...address(context) } };
}

function address(context: VerifiedHindsightPolicyContext) {
  return { namespace: { ...context.namespace }, bankId: context.bank.bankId, native: { ...context.native.native } };
}

function initialize(f: ReturnType<typeof fixture>, override: Partial<NonNullable<Parameters<typeof resolveHindsightApplicationPolicy>[0]["initial"]>> = {}) {
  return resolveHindsightApplicationPolicy({ context: f.context, state: f.absence, initial: { ...f.initial, ...override } });
}

function admit(f: ReturnType<typeof fixture>, body: TakiApplicationMemoryBody, query = "hello") {
  return hindsightPolicyAdmission({ context: f.context, state: { ...f.state, body }, at, query });
}

function evolve(context: VerifiedHindsightPolicyContext): VerifiedHindsightPolicyContext {
  const next = structuredClone(context);
  next.native.native.object_revision += 1; next.native.native.payload_hash = "d".repeat(64);
  next.native.native.native_cursor = 13;
  next.native.unit.revision += 1; next.native.unit.text = "Changed native memory"; next.native.unit.updatedAt = later;
  return next;
}

function originalRecord(f: ReturnType<typeof fixture>, policy: Partial<TakiMemoryPolicyProjection> = {}): CanonicalMemoryRecord {
  return HindsightCurrentCanonicalRecordSchema.parse({ unit: { ...f.context.native.unit, authorityEpochId: "original-epoch",
    bankId: "original-bank", memoryId: "original-unit", documentId: "original-source", revision: 3,
    text: "Original exact unit", tags: ["taki-layer:profile"], metadata: { unitOnly: [1, null], untouched: "1" } },
    policy: { ...f.body.policy, authorityEpochId: "original-epoch", bankId: "original-bank", memoryId: "original-unit",
      layerId: "profile", origin: "self", policyVersion: 11, ...policy },
    provenance: { actor: "agent", origin: "explicit-agent", characterId: null, timelineFromSeq: 10, timelineToSeq: 11,
      capturedAt: at, sanitized: true, sourceRef: "original-unit-witness" } });
}

function assessmentTarget(f: ReturnType<typeof fixture>) {
  return { context: f.context, state: f.state, expectedNative: { ...f.context.native.native },
    expectedArtifact: { ...f.state.artifact }, expectedPolicyVersion: f.body.policy.policyVersion };
}

function assessmentResult() {
  return { policy: { layerId: "profile", importance: 6, visibility: "retrieved" as TakiMemoryPolicyProjection["visibility"],
    disclosure: null, emotionalWeight: null, retention: { kind: "permanent" as const } },
    intent: "deliberate" as const, prompt: { promptVersion: "policy-v1", promptHash: "e".repeat(64) }, completedAt: later };
}
