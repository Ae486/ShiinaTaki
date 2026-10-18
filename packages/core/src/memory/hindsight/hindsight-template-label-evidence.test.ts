import { describe, expect, it, vi } from "vitest";
import { HINDSIGHT_TEMPLATE_VERSION, HindsightTemplateLabelEvidenceResultSchema, type HindsightTemplateLabelGroup } from "@taki/shared";
import { applicationTestBankPayload, applicationTestMemoryPayload, applicationTestNative, APPLICATION_TEST_SCOPE,
  APPLICATION_TEST_AT } from "../../testing/hindsight-application-fixtures.ts";
import { loadHindsightTemplateUnitLabel } from "./hindsight-template-label-evidence.ts";
import { hindsightBankBindings } from "./hindsight-bank-identity.ts";
import { hindsightApplicationPolicyContext } from "./hindsight-application-binding-context.ts";
import { projectHindsightApplicationNativeBank } from "./hindsight-application-projection.ts";
import { resolveHindsightApplicationPolicy } from "./hindsight-application-policy.ts";
import { hindsightError } from "./hindsight-errors.ts";
import { HindsightTemplateRefusal } from "./hindsight-template-client.ts";
import { createHindsightClient } from "./hindsight-client.ts";
import { loadManagedTemplate, TAKI_MANAGED_TEMPLATE_REVISION } from "./template-lifecycle/template-catalog.ts";
import { templateHash } from "./template-lifecycle/template-integrity.ts";

const UNIT_ID = "33333333-3333-4333-8333-333333333333";
const OTHER_ID = "44444444-4444-4444-8444-444444444444";

function fixture(kind: "global" | "character" = "global", value = kind === "global" ? "profile" : "episodes") {
  const bankId = hindsightBankBindings("taki")[kind === "global" ? 0 : 1].externalBankId;
  const scope = { ...APPLICATION_TEST_SCOPE, bankId };
  const bankScope = kind === "global" ? { kind, characterId: null } as const : { kind, characterId: "taki" } as const;
  const nativeBank = applicationTestNative({ kind: "bank", scope, payload: applicationTestBankPayload(scope) }).body.content;
  const native = applicationTestNative({ kind: "memory_unit", scope, cursor: 7,
    payload: applicationTestMemoryPayload({ memory_id: UNIT_ID, bank_id: bankId, document_id: null, revision: 3,
      tags: ["unrelated", "taki-layer:" + value] }) }).body.content;
  if (nativeBank.body_schema !== "application-native-record.v1" || native.body_schema !== "application-native-record.v1") throw new Error("fixture kind");
  const bank = projectHindsightApplicationNativeBank({ ...scope, authorityEpochId: "epoch", bankScope, native: nativeBank.value });
  const context = hindsightApplicationPolicyContext({ ...scope, authorityEpochId: "epoch", bankScope, bank }, native.value);
  const group = loadManagedTemplate(TAKI_MANAGED_TEMPLATE_REVISION, kind).labelGroup;
  const target = { bank_id: bankId, provider_lineage: scope.namespace.provider_lineage, bank_generation: scope.namespace.bank_generation };
  const result = HindsightTemplateLabelEvidenceResultSchema.parse({ contract_version: HINDSIGHT_TEMPLATE_VERSION, target,
    evidence: [{ contract_version: HINDSIGHT_TEMPLATE_VERSION,
    target: { ...target }, unit_id: UNIT_ID, unit_revision: 3, unit_payload_hash: native.value.version.payload_hash,
    group_key: "taki-layer" as const, group_definition_hash: templateHash("definition", group), value,
    scope: kind, producer: "taki-structured-label-v1" as const }] });
  const control = { group: group as HindsightTemplateLabelGroup | null, stale: false };
  const method = vi.fn(async () => result);
  const request = vi.fn(() => { if (control.stale) throw new Error("HINDSIGHT_REPLICA_LEASE_LOST"); return { timeoutMs: 1000 }; });
  const input = { client: { templateLabelEvidence: method }, context, group: () => control.group, request };
  return { input, result, control, method, group, context, request };
}

async function firstPolicy(f: ReturnType<typeof fixture>) {
  const label = await loadHindsightTemplateUnitLabel(f.input);
  const context = f.context;
  const result = resolveHindsightApplicationPolicy({ context,
    state: { status: "authenticated-absence", namespace: context.namespace, bankId: context.bank.bankId, native: context.native.native },
    initial: { stamp: { policyVersion: 1, updatedAt: APPLICATION_TEST_AT },
      evidence: { kind: "provider-derived", observedAt: APPLICATION_TEST_AT }, label } });
  return result.body;
}

describe("authenticated per-unit template label consumption", () => {
  it.each(["profile", "activity", "episodes"])("initializes the safe registry policy for %s using one exact requested version", async (layer) => {
    const f = fixture(layer === "episodes" ? "character" : "global", layer);
    const body = await firstPolicy(f);
    expect(body).toMatchObject({ policy_basis: "registry", policy: { layerId: layer, importance: 5,
      visibility: "retrieved", disclosure: null }, assessment: { state: "not_required", attempts: 0 },
    provenance: { actor: "provider", origin: "provider-derived", timelineFromSeq: null, timelineToSeq: null } });
    expect(f.method).toHaveBeenCalledExactlyOnceWith({ request: { contract_version: HINDSIGHT_TEMPLATE_VERSION, target: f.result.target,
      units: [{ unit_id: UNIT_ID, unit_revision: 3, unit_payload_hash: f.result.evidence[0]!.unit_payload_hash }] }, context: { timeoutMs: 1000 } });
  });

  it.each(["relationship", "intentions", "unclassified"])("keeps %s neutral without inventing a pin or disclosure", async (layer) => {
    const body = await firstPolicy(fixture("character", layer));
    expect(body).toMatchObject({ policy_basis: "neutral", policy: { layerId: "unclassified", visibility: "retrieved",
      importance: 5, disclosure: null, emotionalWeight: null, retention: { kind: "permanent" } }, assessment: { state: "due" } });
  });

  it("preserves omitted defaults and ordered custom enum bytes in the hash", async () => {
    const f = fixture();
    const group = { key: "taki-layer", tag: true, values: [{ value: "activity", description: "Any order is intentional" }, { value: "profile" }] };
    f.control.group = group; f.result.evidence[0]!.group_definition_hash = templateHash("definition", group);
    expect((await firstPolicy(f)).policy.layerId).toBe("profile");
    expect(group).not.toHaveProperty("type"); expect(group).not.toHaveProperty("optional");
    f.result.evidence[0]!.group_definition_hash = templateHash("definition", { ...group, values: [...group.values].reverse() });
    expect((await firstPolicy(f)).policy.layerId).toBe("unclassified");
  });

  it.each([
    ["outer Bank", (f: ReturnType<typeof fixture>) => { f.result.target = { ...f.result.target, bank_id: "foreign-bank" }; }],
    ["outer lineage", (f: ReturnType<typeof fixture>) => { f.result.target = { ...f.result.target, provider_lineage: OTHER_ID }; }],
    ["outer incarnation", (f: ReturnType<typeof fixture>) => { f.result.target = { ...f.result.target, bank_generation: OTHER_ID }; }],
    ["row Bank", (f: ReturnType<typeof fixture>) => { f.result.evidence[0]!.target.bank_id = "foreign-bank"; }],
    ["row lineage", (f: ReturnType<typeof fixture>) => { f.result.evidence[0]!.target.provider_lineage = OTHER_ID; }],
    ["row incarnation", (f: ReturnType<typeof fixture>) => { f.result.evidence[0]!.target.bank_generation = OTHER_ID; }],
    ["unit ID", (f: ReturnType<typeof fixture>) => { f.result.evidence[0]!.unit_id = OTHER_ID; }],
    ["unit revision", (f: ReturnType<typeof fixture>) => { f.result.evidence[0]!.unit_revision--; }],
    ["payload hash", (f: ReturnType<typeof fixture>) => { f.result.evidence[0]!.unit_payload_hash = "0".repeat(64); }],
    ["selected group", (f: ReturnType<typeof fixture>) => { f.result.evidence[0]!.group_definition_hash = "0".repeat(64); }],
    ["scope", (f: ReturnType<typeof fixture>) => { f.result.evidence[0]!.scope = "character"; }],
    ["duplicate", (f: ReturnType<typeof fixture>) => { f.result.evidence.push(structuredClone(f.result.evidence[0]!)); }],
    ["unsolicited", (f: ReturnType<typeof fixture>) => { f.result.evidence.push({ ...f.result.evidence[0]!, unit_id: OTHER_ID }); }],
    ["producer", (f: ReturnType<typeof fixture>) => { Object.assign(f.result.evidence[0]!, { producer: "caller-metadata" }); }],
    ["group key", (f: ReturnType<typeof fixture>) => { Object.assign(f.result.evidence[0]!, { group_key: "content-wide" }); }],
    ["missing", (f: ReturnType<typeof fixture>) => { f.result.evidence = []; }],
  ] as const)("keeps %s evidence neutral", async (_name, change) => {
    const f = fixture(); change(f);
    expect((await firstPolicy(f)).policy.layerId).toBe("unclassified");
  });

  it.each([[], ["taki-layer:profile", "taki-layer:activity"], ["taki-layer:profile", "taki-layer:profile"], ["taki-layer:Profile"]].map((tags) => ({ tags })))(
    "refuses ambiguous or noncanonical reserved tags $tags", async ({ tags }) => {
      const f = fixture(); f.context.native.unit.tags = tags;
      expect((await firstPolicy(f)).policy.layerId).toBe("unclassified");
    });

  it("does not infer provenance from caller metadata or content-wide entities", async () => {
    const f = fixture(); f.result.evidence = [];
    f.context.native.unit.metadata = { "taki-layer": "profile", producer: "taki-structured-label-v1", disclosure: "fabricated" };
    f.context.native.unit.entities = ["taki-layer:profile"];
    expect((await firstPolicy(f)).policy.layerId).toBe("unclassified");
  });

  it.each(["episodes", "unknown-layer"])("checks registry scope for the actual selected value %s", async (value) => {
    const f = fixture("global", value);
    f.group.values!.push({ value }); f.result.evidence[0]!.group_definition_hash = templateHash("definition", f.group);
    expect((await firstPolicy(f)).policy.layerId).toBe("unclassified");
  });

  it.each([
    null, { key: "other", type: "value", tag: true, values: [{ value: "profile" }] },
    { key: "taki-layer", type: "text", tag: true, values: [{ value: "profile" }] },
    { key: "taki-layer", multi_value: true, tag: true, values: [{ value: "profile" }] },
    { key: "taki-layer", free_values: true, tag: true, values: [{ value: "profile" }] },
    { key: "taki-layer", type: "value", values: [{ value: "profile" }] },
    { key: "taki-layer", type: "value", tag: true, values: [] },
    { key: "taki-layer", type: "value", tag: true, values: [{ value: "profile" }, { value: "profile" }] },
  ] as const)("makes no evidence request for an absent, suppressed or unsupported group %#", async (group) => {
    const f = fixture(); f.control.group = group as HindsightTemplateLabelGroup | null;
    expect((await firstPolicy(f)).policy.layerId).toBe("unclassified"); expect(f.method).not.toHaveBeenCalled();
  });

  it.each(["same-shape-foreign-id", "different-character"])("verifies the full canonical Bank binding: %s", async (failure) => {
    const f = fixture("character");
    const bankId = failure === "different-character" ? hindsightBankBindings("other")[1].externalBankId
      : "taki-hs-v1-c-" + "0".repeat(32);
    f.context.bank.bankId = bankId; f.context.native.bankId = bankId; f.context.native.unit.bankId = bankId;
    expect((await firstPolicy(f)).policy.layerId).toBe("unclassified"); expect(f.method).not.toHaveBeenCalled();
  });

  it("keeps old clients and non-extraction native IDs neutral", async () => {
    const f = fixture();
    expect(await loadHindsightTemplateUnitLabel({ ...f.input, client: {} })).toBeUndefined();
    f.context.native.native.object_id = "old-import-id"; f.context.native.unit.memoryId = "old-import-id";
    expect(await loadHindsightTemplateUnitLabel(f.input)).toBeUndefined(); expect(f.method).not.toHaveBeenCalled();
  });

  it.each([new HindsightTemplateRefusal("unsupported_storage"), new HindsightTemplateRefusal("unsupported_value"),
    hindsightError("HINDSIGHT_EXTENSION_UNSUPPORTED"), hindsightError("HINDSIGHT_RESPONSE_INVALID")])(
    "keeps explicitly unsupported or malformed label-only responses neutral: %s", async (error) => {
      const f = fixture(); f.method.mockRejectedValueOnce(error);
      expect((await firstPolicy(f)).policy.layerId).toBe("unclassified");
    });

  it.each([hindsightError("HINDSIGHT_AUTHENTICATION_FAILED"), hindsightError("HINDSIGHT_CANCELLED"), hindsightError("HINDSIGHT_TIMEOUT"),
    new HindsightTemplateRefusal("generation_mismatch"), new Error("unclassified transport failure")])(
    "preserves authentication, lifetime and identity failures: %s", async (error) => {
      const f = fixture(); f.method.mockRejectedValueOnce(error);
      await expect(loadHindsightTemplateUnitLabel(f.input)).rejects.toBe(error);
    });

  it("rechecks the owner before and after the await, including unsupported responses", async () => {
    const f = fixture(); f.control.stale = true;
    await expect(loadHindsightTemplateUnitLabel(f.input)).rejects.toThrow("HINDSIGHT_REPLICA_LEASE_LOST");
    expect(f.method).not.toHaveBeenCalled(); f.control.stale = false;
    f.method.mockImplementationOnce(async () => { f.control.stale = true; return f.result; });
    await expect(loadHindsightTemplateUnitLabel(f.input)).rejects.toThrow("HINDSIGHT_REPLICA_LEASE_LOST");
    f.control.stale = false;
    f.method.mockImplementationOnce(async () => { f.control.stale = true; throw new HindsightTemplateRefusal("unsupported_storage"); });
    await expect(loadHindsightTemplateUnitLabel(f.input)).rejects.toThrow("HINDSIGHT_REPLICA_LEASE_LOST");
  });

  it("refuses selection drift while authenticated evidence is in flight", async () => {
    const f = fixture(); f.method.mockImplementationOnce(async () => { f.group.values!.reverse(); return f.result; });
    await expect(loadHindsightTemplateUnitLabel(f.input)).rejects.toThrow("MEMORY_TEMPLATE_IDENTITY_CHANGED");
  });

  it("uses the real authenticated bounded client and keeps a malformed producer response neutral", async () => {
    const f = fixture(); const transport = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer fixture-key");
      return { status: 200, body: JSON.stringify({ ...f.result, evidence: [{ ...f.result.evidence[0], producer: "forged" }] }) };
    });
    const client = createHindsightClient({ endpoint: "http://127.0.0.1:18481", resolveApiKey: () => "fixture-key", transport });
    expect(await loadHindsightTemplateUnitLabel({ ...f.input, client })).toBeUndefined();
    expect(transport).toHaveBeenCalledOnce();
  });

  it.each(["outer evidence", "nested target", "selected value"] as const)(
    "rejects duplicate raw JSON keys at the %s boundary before they can be collapsed", async (location) => {
      const f = fixture(); const valid = JSON.stringify(f.result);
      const raw = location === "outer evidence" ? valid.slice(0, -1) + ',"evidence":' + JSON.stringify(f.result.evidence) + "}"
        : location === "nested target" ? valid.replace('"bank_id":', '"bank_id":"foreign-bank","bank_id":')
          : valid.replace('"value":"profile"', '"value":"activity","value":"profile"');
      const client = createHindsightClient({ endpoint: "http://127.0.0.1:18481", resolveApiKey: () => "fixture-key",
        transport: async () => ({ status: 200, body: raw }) });
      expect(await loadHindsightTemplateUnitLabel({ ...f.input, client })).toBeUndefined();
    });
});
