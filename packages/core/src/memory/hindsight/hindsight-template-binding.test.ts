import { afterEach, describe, expect, it, vi } from "vitest";
import { HINDSIGHT_TEMPLATE_VERSION, HindsightTemplateLabelEvidenceResultSchema, type TakiApplicationMemoryBody, type CanonicalMemoryRecord,
  type TakiApplicationNativeRecord } from "@taki/shared";
import type { HindsightApplicationBootstrapEvidence } from "../../db/hindsight-application-bootstrap-evidence.ts";
import { applicationTestMemoryPayload, applicationTestNative, APPLICATION_TEST_AT } from "../../testing/hindsight-application-fixtures.ts";
import { createHindsightApplicationBindingRunner } from "./hindsight-application-binding-runner.ts";
import { hindsightApplicationBindingBody, hindsightApplicationEvidenceReader, hindsightApplicationPolicyContext } from "./hindsight-application-binding-context.ts";
import { curatorTestBank, curatorTestFixture, curatorTestRemotePolicy } from "./hindsight-policy-curator-fixtures.ts";
import { createHindsightClient } from "./hindsight-client.ts";
import { hindsightBankBindings } from "./hindsight-bank-identity.ts";
import { loadManagedTemplate, TAKI_MANAGED_TEMPLATE_REVISION } from "./template-lifecycle/template-catalog.ts";
import { templateHash } from "./template-lifecycle/template-integrity.ts";

const UNIT = "33333333-3333-4333-8333-333333333333";
const fixtures: Array<{ close(): Promise<void> }> = [];
afterEach(async () => { for (const f of fixtures.splice(0)) await f.close(); });

function fixture(input: { characterId?: string; value?: string; tags?: string[] } = {}) {
  const bankId = hindsightBankBindings(input.characterId ?? "taki")[input.characterId ? 1 : 0].externalBankId;
  const bank = curatorTestBank({ bankId, characterId: input.characterId, memories: [] });
  const value = input.value ?? (input.characterId ? "episodes" : "profile");
  const native = applicationTestNative({ kind: "memory_unit", scope: bank.scope, cursor: 2,
    payload: applicationTestMemoryPayload({ bank_id: bankId, memory_id: UNIT, document_id: null,
      tags: input.tags ?? ["unrelated", "taki-layer:" + value] }) });
  bank.native.push(native);
  const f = curatorTestFixture({ banks: [bank] });
  const group = loadManagedTemplate(TAKI_MANAGED_TEMPLATE_REVISION, bank.bankScope.kind).labelGroup;
  const version = native.head.version!;
  const target = { bank_id: bankId, provider_lineage: bank.scope.namespace.provider_lineage, bank_generation: bank.scope.namespace.bank_generation };
  const response = HindsightTemplateLabelEvidenceResultSchema.parse({ contract_version: HINDSIGHT_TEMPLATE_VERSION, target,
    evidence: [{ contract_version: HINDSIGHT_TEMPLATE_VERSION,
    target, unit_id: UNIT, unit_revision: version.object_revision, unit_payload_hash: version.payload_hash,
    group_key: "taki-layer" as const, group_definition_hash: templateHash("definition", group), value,
    scope: bank.bankScope.kind, producer: "taki-structured-label-v1" as const }] });
  const method = vi.fn(async () => response);
  const client = createHindsightClient({ endpoint: "http://127.0.0.1:18481", resolveApiKey: () => "fixture",
    transport: async () => { throw new Error("binding test forbids unexpected HTTP"); } });
  client.templateLabelEvidence = method;
  const control = { original: undefined as HindsightApplicationBootstrapEvidence | undefined,
    abort: new AbortController(), revoke: () => undefined as void };
  const bind = createHindsightApplicationBindingRunner({ repo: f.replica, writer: f.writer, client,
    bootstrap: () => control.original, templateLabelGroup: () => group });
  const run = async () => {
    const lease = f.replica.leases.acquire({ bankId, ownerId: "label-binding-test", durationMs: 60_000 }); let held = true;
    control.revoke = () => { f.replica.leases.release(lease); held = false; };
    try { return await bind({ ...bank.scope, bank: { bankId, scope: bank.bankScope.kind, characterId: bank.bankScope.characterId },
      authorityEpochId: "epoch", checkpoint: f.replica.checkpoint(bankId)!, request: () => {
        if (control.abort.signal.aborted) throw new Error("HINDSIGHT_CANCELLED");
        f.replica.leases.assert(lease); return { timeoutMs: 1000, signal: control.abort.signal };
      } }); }
    finally { if (held) f.replica.leases.release(lease); }
  };
  const result = { ...f, bank, native, method, response, group, control, run,
    refresh: () => f.deps.refreshBank(bankId, { timeoutMs: 1000 }),
    jobs: () => f.db.prepare("SELECT * FROM hindsight_application_command_jobs ORDER BY operation_id").all() };
  fixtures.push(result); return result;
}

function body(f: ReturnType<typeof fixture>): TakiApplicationMemoryBody {
  const head = f.replica.nativeHead({ ...f.bank.scope, objectKind: "memory_unit", objectId: UNIT })!;
  const artifact = f.replica.artifact({ ...f.bank.scope, version: head.bound_artifact! })!;
  const content = f.replica.body({ ...f.bank.scope, bodyId: artifact.body_ref.body_id })!.content;
  if (content.body_schema !== "application-memory.v1") throw new Error("memory body missing"); return content.value;
}

describe("first-binding label preload and durable policy publication", () => {
  it.each([{ value: "profile" }, { characterId: "taki", value: "episodes" }])(
    "publishes the exact $value policy through the real SQLite command and replica owners", async (input) => {
      const f = fixture(input);
      expect(f.replica.record({ ...f.bank.scope, memoryId: UNIT })).toBeUndefined();
      await f.run(); expect(f.replica.record({ ...f.bank.scope, memoryId: UNIT })).toBeUndefined();
      await f.refresh();
      expect(body(f)).toMatchObject({ policy_basis: "registry", policy: { layerId: input.value, visibility: "retrieved", disclosure: null } });
      expect(f.replica.record({ ...f.bank.scope, memoryId: UNIT })?.policy.layerId).toBe(input.value);
      expect(f.method).toHaveBeenCalledOnce(); expect(f.jobs()).toHaveLength(1);
    });

  it("waits for evidence outside SQLite before creating a body or preparing a job", async () => {
    const f = fixture(); let release: () => void = () => { throw new Error("gate not created"); };
    const gate = new Promise<void>((resolve) => { release = resolve; }); let resolved = false; let depth = 0;
    const transaction = f.db.transaction;
    vi.spyOn(f.db, "transaction").mockImplementation((callback) => transaction(() => { depth++; try { callback(); } finally { depth--; } }));
    f.method.mockImplementation(async () => { expect(depth).toBe(0); await gate; resolved = true; return f.response; });
    const prepare = f.writer.prepare;
    const prepared = vi.spyOn(f.writer, "prepare").mockImplementation((work) => { expect(resolved).toBe(true); return prepare(work); });
    const pending = f.run();
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(f.method).toHaveBeenCalledOnce(); expect(prepared).not.toHaveBeenCalled(); expect(f.jobs()).toEqual([]);
    release(); await pending; expect(prepared).toHaveBeenCalledOnce(); await f.refresh(); expect(body(f).policy.layerId).toBe("profile");
  });

  it.each(["cancel", "lease", "selection"] as const)("refuses %s loss during preload before any body/job is prepared", async (failure) => {
    const f = fixture(); const prepare = vi.spyOn(f.writer, "prepare");
    f.method.mockImplementation(async () => {
      if (failure === "cancel") f.control.abort.abort();
      if (failure === "lease") f.control.revoke();
      if (failure === "selection") f.group.description = "Changed selection while the response was pending";
      return f.response;
    });
    await expect(f.run()).rejects.toThrow(failure === "cancel" ? "HINDSIGHT_CANCELLED"
      : failure === "lease" ? "HINDSIGHT_REPLICA_LEASE_LOST" : "MEMORY_TEMPLATE_IDENTITY_CHANGED");
    expect(prepare).not.toHaveBeenCalled(); expect(f.jobs()).toEqual([]); expect(f.bank.server.receipts.size).toBe(0);
  });

  it("reuses the first durable command and its label without a second evidence read before local publication", async () => {
    const f = fixture(); await f.run(); const before = f.jobs();
    f.method.mockRejectedValue(new Error("a persisted command must not refresh inference"));
    await f.run(); expect(f.method).toHaveBeenCalledOnce(); expect(f.jobs()).toEqual(before);
    expect(f.bank.server.receipts.size).toBe(1); await f.refresh(); expect(body(f).policy.layerId).toBe("profile");
    expect(await f.run()).toBe(false); expect(f.method).toHaveBeenCalledOnce();
  });

  it.each([
    { value: "profile", tags: ["taki-layer:profile", "taki-layer:activity"] },
    { characterId: "taki", value: "relationship" }, { characterId: "taki", value: "intentions" },
    { value: "unclassified" },
  ])("publishes neutral policy for ambiguous or guarded $value output", async (input) => {
    const f = fixture(input); await f.run(); await f.refresh();
    expect(body(f)).toMatchObject({ policy_basis: "neutral", policy: { layerId: "unclassified", visibility: "retrieved",
      disclosure: null, importance: 5, retention: { kind: "permanent" } }, assessment: { state: "due" } });
  });

  it("preserves an original curated policy before considering an extracted label", async () => {
    const f = fixture(); const bank = f.replica.bankBinding(f.bank.scope.bankId)!.bank!;
    const native = f.native.body.content;
    if (native.body_schema !== "application-native-record.v1") throw new Error("native missing");
    const context = { ...f.bank.scope, authorityEpochId: "epoch", bankScope: f.bank.bankScope, bank };
    const unit = hindsightApplicationPolicyContext(context, native.value).native.unit;
    const original: CanonicalMemoryRecord = { unit: { ...unit, tags: ["unrelated", "taki-layer:activity"] },
      policy: { authorityEpochId: "epoch", bankId: bank.bankId, memoryId: UNIT,
      layerId: "activity", importance: 7, visibility: "hidden", disclosure: "original", origin: "self", emotionalWeight: 0.2,
      policyVersion: 9, updatedAt: APPLICATION_TEST_AT, retention: { kind: "rolling-window", days: 30 } },
    provenance: { actor: "user", origin: "explicit-user", characterId: null, timelineFromSeq: 1, timelineToSeq: 2,
      capturedAt: APPLICATION_TEST_AT, sanitized: true, sourceRef: "original-fixture-witness" } };
    f.control.original = { bank: { value: bank, native: f.bank.native[0]!.head.version!, operationId: "original-bank" },
      originalProviderLineage: "original-lineage", sources: new Map(), blocks: [],
      memories: new Map([[UNIT, { value: original, native: native.value.version, operationId: "original-unit" }]]) };
    await f.run(); await f.refresh();
    expect(f.method).not.toHaveBeenCalled(); expect(body(f).policy_basis).toBe("curated");
    expect(body(f).policy).toEqual(original.policy); expect(body(f).provenance).toEqual(original.provenance);
  });

  it("keeps a later curated restriction while rebinding to a newly labeled exact version", async () => {
    const f = fixture(); await f.run(); await f.refresh();
    curatorTestRemotePolicy(f.bank, UNIT, (memory) => ({ ...memory, policy_basis: "curated",
      policy: { ...memory.policy, layerId: "activity", visibility: "hidden", policyVersion: 9 } }));
    await f.refresh(); const previous = body(f);
    const priorHead = f.replica.nativeHead({ ...f.bank.scope, objectKind: "memory_unit", objectId: UNIT })!;
    const prior = f.replica.artifact({ ...f.bank.scope, version: priorHead.bound_artifact! })!;
    const next = applicationTestNative({ kind: "memory_unit", scope: f.bank.scope, cursor: 3,
      payload: applicationTestMemoryPayload({ bank_id: f.bank.scope.bankId, memory_id: UNIT, document_id: null, revision: 2,
        text: "Changed native fact with a new exact label", tags: ["taki-layer:profile"] }) });
    const native = next.body.content;
    if (native.body_schema !== "application-native-record.v1") throw new Error("native missing");
    const result = hindsightApplicationBindingBody({ ...f.bank.scope, authorityEpochId: "epoch", bankScope: f.bank.bankScope,
      bank: f.replica.bankBinding(f.bank.scope.bankId)!.bank!, repo: f.replica,
      evidence: hindsightApplicationEvidenceReader(f.replica, f.bank.scope), original: undefined },
    { native: native.value as TakiApplicationNativeRecord, head: { ...next.head, binding_state: "rebind_required", cause: "native_change",
      bound_artifact: priorHead.bound_artifact, previous_version: priorHead.version }, prior, at: APPLICATION_TEST_AT,
    label: { ...f.bank.scope, native: native.value.version, layerId: "profile", disclosure: null } });
    expect(result.schema).toBe("application-memory.v1");
    expect(result.value).toMatchObject({ policy_basis: "curated", policy: previous.policy,
      assessment: { state: "due", target: native.value.version } });
    expect(f.method).toHaveBeenCalledOnce();
  });
});
