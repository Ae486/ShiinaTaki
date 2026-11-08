import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HINDSIGHT_APPLICATION_UPLOAD_BYTES, HINDSIGHT_TEMPLATE_VERSION, HindsightTemplateLabelEvidenceResultSchema,
  type TakiApplicationBlockBody, type TakiApplicationMemoryBody, type CanonicalMemoryRecord, type TakiApplicationNativeRecord } from "@taki/shared";
import type { HindsightApplicationBootstrapEvidence } from "../../db/hindsight-application-bootstrap-evidence.ts";
import { applicationCommandList } from "../../db/hindsight-application-command-contract.ts";
import { applicationTestMemoryBody, applicationTestMemoryPayload, applicationTestNative, applicationTestSourcePayload, applicationTestEvent,
  applicationTestBody, APPLICATION_TEST_AT } from "../../testing/hindsight-application-fixtures.ts";
import { createHindsightApplicationBindingRunner } from "./hindsight-application-binding-runner.ts";
import { hindsightApplicationBindingBody, hindsightApplicationEvidenceReader, hindsightApplicationPolicyContext } from "./hindsight-application-binding-context.ts";
import { curatorTestBank, curatorTestFixture, curatorTestRemotePolicy, type CuratorTestBank } from "./hindsight-policy-curator-fixtures.ts";
import { createHindsightClient, type HindsightClient } from "./hindsight-client.ts";
import { hindsightBankBindings } from "./hindsight-bank-identity.ts";
import { loadManagedTemplate, TAKI_MANAGED_TEMPLATE_REVISION } from "./template-lifecycle/template-catalog.ts";
import { templateHash } from "./template-lifecycle/template-integrity.ts";
import { hindsightError } from "./hindsight-errors.ts";
import { HindsightApplicationRefusal } from "./hindsight-application-client.ts";
import { HindsightTemplateRefusal } from "./hindsight-template-client.ts";
import { hindsightApplicationClientOverlay } from "../../testing/hindsight-runtime-composition-fixtures.ts";
import { loadHindsightApplicationEvent } from "./hindsight-application-bundle-loader.ts";
import { rmTempDir } from "../../testing/rm-temp.ts";

const UNIT = "33333333-3333-4333-8333-333333333333";
const fixtures: Array<{ close(): Promise<void> }> = [];
const directories: string[] = [];
afterEach(async () => {
  for (const f of fixtures.splice(0)) await f.close();
  for (const directory of directories.splice(0)) rmTempDir(directory);
});

function fixture(input: { characterId?: string; value?: string; tags?: string[]; seed?: (bank: CuratorTestBank) => void;
  blocks?: TakiApplicationBlockBody[]; timeoutMs?: number; path?: string; bank?: CuratorTestBank } = {}) {
  const bankId = hindsightBankBindings(input.characterId ?? "taki")[input.characterId ? 1 : 0].externalBankId;
  const bank = input.bank ?? curatorTestBank({ bankId, characterId: input.characterId, memories: [] });
  const value = input.value ?? (input.characterId ? "episodes" : "profile");
  const native = applicationTestNative({ kind: "memory_unit", scope: bank.scope, cursor: 2,
    payload: applicationTestMemoryPayload({ bank_id: bankId, memory_id: UNIT, document_id: null,
      tags: input.tags ?? ["unrelated", "taki-layer:" + value] }) });
  if (!input.bank) bank.native.push(native);
  input.seed?.(bank);
  const f = curatorTestFixture({ banks: [bank], path: input.path });
  const remote = hindsightApplicationClientOverlay([bank]);
  const group = loadManagedTemplate(TAKI_MANAGED_TEMPLATE_REVISION, bank.bankScope.kind).labelGroup;
  const version = native.head.version!;
  const target = { bank_id: bankId, provider_lineage: bank.scope.namespace.provider_lineage, bank_generation: bank.scope.namespace.bank_generation };
  const response = HindsightTemplateLabelEvidenceResultSchema.parse({ contract_version: HINDSIGHT_TEMPLATE_VERSION, target,
    evidence: [{ contract_version: HINDSIGHT_TEMPLATE_VERSION,
    target, unit_id: UNIT, unit_revision: version.object_revision, unit_payload_hash: version.payload_hash,
    group_key: "taki-layer" as const, group_definition_hash: templateHash("definition", group), value,
    scope: bank.bankScope.kind, producer: "taki-structured-label-v1" as const }] });
  const method = vi.fn<NonNullable<HindsightClient["templateLabelEvidence"]>>(async ({ request }) => ({ ...response,
    evidence: request.units.map((unit) => ({ ...response.evidence[0]!, ...unit })) }));
  const client = createHindsightClient({ endpoint: "http://127.0.0.1:18481", resolveApiKey: () => "fixture",
    transport: async () => { throw new Error("binding test forbids unexpected HTTP"); } });
  client.templateLabelEvidence = method;
  const control = { original: undefined as HindsightApplicationBootstrapEvidence | undefined,
    abort: new AbortController(), revoke: () => undefined as void };
  const createBinding = () => createHindsightApplicationBindingRunner({ repo: f.replica, writer: f.writer, client,
    bootstrap: () => control.original, templateLabelGroup: () => group, blocks: () => input.blocks ?? [] });
  const bind = createBinding();
  const run = async (binding = bind) => {
    const lease = f.replica.leases.acquire({ bankId, ownerId: "label-binding-test", durationMs: 60_000 }); let held = true;
    control.revoke = () => { f.replica.leases.release(lease); held = false; };
    try { return await binding({ ...bank.scope, bank: { bankId, scope: bank.bankScope.kind, characterId: bank.bankScope.characterId },
      authorityEpochId: "epoch", checkpoint: f.replica.checkpoint(bankId)!, request: () => {
        if (control.abort.signal.aborted) throw new Error("HINDSIGHT_CANCELLED");
        f.replica.leases.assert(lease); return { timeoutMs: input.timeoutMs ?? 1000, signal: control.abort.signal };
      } }); }
    finally { if (held) f.replica.leases.release(lease); }
  };
  const refresh = async () => {
    const lease = f.replica.leases.acquire({ bankId, ownerId: "label-pull-test", durationMs: 60_000 });
    try {
      const page = await remote.overlay.applicationChanges({ ...bank.scope, afterStateCursor: f.replica.checkpoint(bankId)!.checkpoint.state_cursor,
        limit: 128, context: { timeoutMs: 60_000 } });
      for (const manifest of page.changes) {
        const guard = { ...bank.scope, authorityEpochId: "epoch", expectedBank: { bankId, scope: bank.bankScope.kind,
          characterId: bank.bankScope.characterId }, expectedCheckpoint: f.replica.checkpoint(bankId)!,
          expectedNativeCheckpoint: f.replica.nativeCheckpoint(bankId)!, lease,
          deadlineAt: new Date(Date.parse(APPLICATION_TEST_AT) + 60_000).toISOString() };
        const event = await loadHindsightApplicationEvent({ ...bank.scope, manifest, client: { ...client, ...remote.overlay },
          context: { timeoutMs: 60_000 }, cachedBody: (ref) => f.replica.cachedBody({ ...guard, ref }) });
        f.replica.applyEvent({ ...guard, event });
      }
    } finally { f.replica.leases.release(lease); }
  };
  const result = { ...f, bank, native, method, response, group, control, run, createBinding, remote, refresh,
    jobs: () => f.db.prepare("SELECT * FROM hindsight_application_command_jobs ORDER BY operation_id").all() };
  fixtures.push(result); return result;
}

function extraMemory(bank: CuratorTestBank, id = "44444444-4444-4444-8444-444444444444", metadata = {}) {
  return applicationTestNative({ kind: "memory_unit", scope: bank.scope, cursor: bank.server.cursor.native,
    payload: applicationTestMemoryPayload({ bank_id: bank.scope.bankId, memory_id: id,
      document_id: null, metadata, tags: ["taki-layer:profile"] }) });
}

function publishNative(f: ReturnType<typeof fixture>, native: ReturnType<typeof applicationTestNative>) {
  const from = { native_cursor: f.bank.server.cursor.native, state_cursor: f.bank.server.cursor.state++ };
  const content = native.body.content;
  if (content.body_schema !== "application-native-record.v1") throw new Error("fixture native missing");
  const next = applicationTestNative({ kind: "memory_unit", scope: f.bank.scope, cursor: ++f.bank.server.cursor.native,
    payload: content.value.payload });
  f.bank.native = [...f.bank.native.filter((entry) => entry.head.object_id !== next.head.object_id), next];
  f.bank.events.push(applicationTestEvent({ scope: f.bank.scope, native: [next], from,
    to: { native_cursor: f.bank.server.cursor.native, state_cursor: f.bank.server.cursor.state } }));
}

function block(id: string, content: string): TakiApplicationBlockBody {
  return { block_id: id, scope: { kind: "global", characterId: null }, content,
    block_revision: 1, updated_at: APPLICATION_TEST_AT, writer: "background", block_contract_version: 1 };
}

function jobs(f: ReturnType<typeof fixture>) {
  return f.jobs().map((row) => f.commands.get({ authorityEpochId: "epoch", bankId: f.bank.scope.bankId, requestId: String(row.request_id) })!);
}

function body(f: ReturnType<typeof fixture>): TakiApplicationMemoryBody {
  const head = f.replica.nativeHead({ ...f.bank.scope, objectKind: "memory_unit", objectId: UNIT })!;
  const artifact = f.replica.artifact({ ...f.bank.scope, version: head.bound_artifact! })!;
  const content = f.replica.body({ ...f.bank.scope, bodyId: artifact.body_ref.body_id })!.content;
  if (content.body_schema !== "application-memory.v1") throw new Error("memory body missing"); return content.value;
}

describe("first-binding label preload and durable policy publication", () => {
  it("packs the exact 16 MiB boundary including the envelope, and splits when it exceeds by one byte", async () => {
    for (const extra of [0, 1]) {
      const blocks = [block("user-model", "x".repeat(8 * 1024 * 1024)), { ...block("user-card", "y".repeat(7 * 1024 * 1024)), writer: "user" as const }];
      const f = fixture({ blocks, timeoutMs: 60_000, seed: (bank) => { bank.native = bank.native.slice(0, 1); } });
      const size = () => {
        const bodies = blocks.map((value) => applicationTestBody("application-block.v1", value, f.bank.scope));
        const commands = applicationTestBody("application-commands.v1", { commands: bodies.map((entry, i) => ({
          command: "put_artifact", key: { artifact_kind: "block", artifact_id: blocks[i]!.block_id }, expected_artifact: null,
          expected_native: null, body_ref: entry.ref, binding: { kind: "core_block" }, actor: { kind: "restore", actor_ref: "taki-application-binding" },
        })) }, f.bank.scope);
        return commands.bytes.byteLength + bodies.reduce((total, entry) => total + entry.bytes.byteLength, 0);
      };
      blocks[1]!.content += "y".repeat(HINDSIGHT_APPLICATION_UPLOAD_BYTES - size());
      expect(size()).toBe(HINDSIGHT_APPLICATION_UPLOAD_BYTES);
      blocks[1]!.content += "y".repeat(extra);
      expect(await f.run()).toBe(true);
      const first = jobs(f)[0]!;
      expect(applicationCommandList(first.commands)).toHaveLength(extra ? 1 : 2);
      expect(first.commands.bytes.byteLength + first.bodies.reduce((total, entry) => total + entry.bytes.byteLength, 0))
        .toBeLessThanOrEqual(HINDSIGHT_APPLICATION_UPLOAD_BYTES);
      await f.refresh();
      expect(await f.run()).toBe(Boolean(extra));
      if (extra) await f.refresh();
      expect(await f.run()).toBe(false);
    }
  }, 60_000);

  it("commits the preceding batch then preserves the oversized-singleton failure", async () => {
    const blocks = [block("user-model", "valid preceding work"), { ...block("user-card", "x".repeat(HINDSIGHT_APPLICATION_UPLOAD_BYTES)), writer: "user" as const }];
    const f = fixture({ blocks, timeoutMs: 60_000, seed: (bank) => { bank.native = bank.native.slice(0, 1); } });
    expect(await f.run()).toBe(true); expect(applicationCommandList(jobs(f)[0]!.commands)).toHaveLength(1);
    await f.refresh(); const before = f.replica.checkpoint(f.bank.scope.bankId);
    await expect(f.run()).rejects.toThrow("HINDSIGHT_APPLICATION_PAYLOAD_TOO_LARGE");
    expect(f.jobs()).toHaveLength(1); expect(f.replica.checkpoint(f.bank.scope.bankId)).toEqual(before);
  }, 30_000);

  it("fetches fresh spill evidence after a large preserved Memory while reusing a prepared prefix", async () => {
    const f = fixture({ timeoutMs: 60_000, seed: (bank) => bank.native.push(extraMemory(bank)) });
    const native = f.native.body.content;
    if (native.body_schema !== "application-native-record.v1") throw new Error("fixture native missing");
    const bank = f.replica.bankBinding(f.bank.scope.bankId)!.bank!;
    const context = { ...f.bank.scope, authorityEpochId: "epoch", bankScope: f.bank.bankScope, bank,
      repo: f.replica, evidence: hindsightApplicationEvidenceReader(f.replica, f.bank.scope), original: undefined };
    const unit = hindsightApplicationPolicyContext(context, native.value).native.unit;
    const initial = applicationTestMemoryBody(native.value.version);
    // A preserved Canonical record carries its metadata both in the original and
    // encoded witness. Each string/container remains within the supported limits.
    const metadata = { wide: Array.from({ length: 2 }, () => Array.from({ length: 255 }, () => "x".repeat(16_384))), padding: ["", ""] };
    const original: CanonicalMemoryRecord = { unit: { ...unit, metadata }, provenance: initial.provenance,
      policy: { ...initial.policy, bankId: bank.bankId, layerId: "profile" } };
    f.control.original = { bank: { value: bank, native: f.bank.native[0]!.head.version!, operationId: "original-bank" },
      originalProviderLineage: "original-lineage", sources: new Map(), blocks: [],
      memories: new Map([[UNIT, { value: original, native: native.value.version, operationId: "original-unit" }]]) };
    const value = hindsightApplicationBindingBody({ ...context, original: f.control.original },
      { native: native.value, head: f.native.head, prior: null, at: APPLICATION_TEST_AT });
    const prepared = applicationTestBody(value.schema, value.value, f.bank.scope);
    const envelope = applicationTestBody("application-commands.v1", { commands: [{ command: "put_artifact",
      key: { artifact_kind: "memory", artifact_id: UNIT }, expected_artifact: null, expected_native: native.value.version,
      body_ref: prepared.ref, binding: { kind: "exact_native", native: native.value.version },
      actor: { kind: "background", actor_ref: "taki-application-binding" } }] }, f.bank.scope);
    const padding = Math.floor((HINDSIGHT_APPLICATION_UPLOAD_BYTES - 512 - prepared.bytes.byteLength - envelope.bytes.byteLength) / 2);
    metadata.padding = ["x".repeat(Math.min(16_384, padding)), "x".repeat(Math.max(0, padding - 16_384))];
    expect(await f.run()).toBe(true); expect(applicationCommandList(jobs(f)[0]!.commands)).toHaveLength(1);
    expect(f.method).toHaveBeenCalledOnce();
    // Re-entry before pull reuses the persisted prefix without fetching labels.
    expect(await f.run()).toBe(true); expect(f.method).toHaveBeenCalledOnce();
    await f.refresh(); expect(await f.run()).toBe(true); await f.refresh();
    expect(await f.run()).toBe(false); expect(f.method).toHaveBeenCalledTimes(2); expect(f.jobs()).toHaveLength(2);
  }, 60_000);

  it("publishes Bank alone, then Blocks, multiple Sources, then Memories referencing those exact Sources", async () => {
    const blocks = [block("user-model", "Observed preferences"), { ...block("user-card", "User facts"), writer: "user" as const }];
    const f = fixture({ blocks, seed: (bank) => {
      bank.artifacts = [];
      bank.native[0]!.head = { ...bank.native[0]!.head, binding_state: "binding_missing", bound_artifact: null };
      bank.native = bank.native.filter((entry) => entry.head.object_kind !== "memory_unit");
      for (let i = 0; i < 2; i++) {
        const documentId = `document-${i}`;
        bank.native.push(applicationTestNative({ kind: "document", scope: bank.scope, cursor: 2,
          payload: { ...applicationTestSourcePayload(bank.scope), document_id: documentId },
          source: { text: `Original source ${i}`, context: null, metadata: {} } }));
        bank.native.push(applicationTestNative({ kind: "memory_unit", scope: bank.scope, cursor: 2,
          payload: applicationTestMemoryPayload({ bank_id: bank.scope.bankId, document_id: documentId,
            memory_id: i === 0 ? UNIT : "44444444-4444-4444-8444-444444444444", tags: ["taki-layer:profile"] }) }));
      }
    } });
    const stages: string[][] = [];
    const execute = f.writer.run;
    vi.spyOn(f.writer, "run").mockImplementation(async (input) => {
      const job = f.commands.get(input.key)!;
      const commands = applicationCommandList(job.commands); stages.push(commands.map((command) => command.key.artifact_kind));
      for (const memory of job.bodies) if (memory.content.body_schema === "application-memory.v1") {
        expect(memory.content.value.source_artifacts).toHaveLength(1);
        for (const version of memory.content.value.source_artifacts) {
          expect(f.replica.artifact({ ...f.bank.scope, version })).toMatchObject({ key: version.key, revision: version.revision });
        }
      }
      return execute(input);
    });
    while (await f.run()) await f.refresh();
    expect(stages).toEqual([["bank"], ["block", "block"], ["source", "source"], ["memory", "memory"]]);
    expect(f.method).toHaveBeenCalledOnce(); expect(body(f).source_artifacts).toHaveLength(1);
  });

  it("does not dispatch any member when the batch label request fails", async () => {
    const f = fixture({ seed: (bank) => bank.native.push(extraMemory(bank)) });
    f.method.mockRejectedValueOnce(hindsightError("HINDSIGHT_UNREACHABLE"));
    await expect(f.run()).rejects.toMatchObject({ code: "HINDSIGHT_UNREACHABLE" });
    expect(f.jobs()).toEqual([]); expect(f.bank.server.receipts.size).toBe(0);
  });

  it("refuses a label-selection change during the batch request before preparing any member", async () => {
    const f = fixture({ seed: (bank) => bank.native.push(extraMemory(bank)) });
    const label = f.method.getMockImplementation()!;
    f.method.mockImplementationOnce(async (input) => {
      f.group.description = "Selection changed during batch labels";
      return label(input);
    });
    await expect(f.run()).rejects.toThrow("MEMORY_TEMPLATE_IDENTITY_CHANGED");
    expect(f.jobs()).toEqual([]); expect(f.bank.server.receipts.size).toBe(0);
  });

  it("recovers a lost-ACK batch already published by the first pull, then binds changed membership", async () => {
    const f = fixture({ seed: (bank) => bank.native.push(extraMemory(bank)) });
    const actual = f.bank.server.client.commitApplication;
    const commit = vi.spyOn(f.bank.server.client, "commitApplication").mockImplementationOnce(async (input) => {
      await actual(input); throw hindsightError("HINDSIGHT_UNREACHABLE");
    });
    await expect(f.run()).rejects.toMatchObject({ code: "HINDSIGHT_UNREACHABLE" });
    const original = jobs(f)[0]!;
    expect(applicationCommandList(original.commands)).toHaveLength(2);
    publishNative(f, extraMemory(f.bank, "11111111-1111-4111-8111-111111111111"));
    await f.refresh();
    const status = vi.spyOn(f.bank.server.client, "applicationCommit");
    expect(await f.run(f.createBinding())).toBe(true);
    expect(status).toHaveBeenCalledWith(expect.objectContaining({ operationId: original.operationId }));
    const recovered = f.commands.get(original.key)!;
    expect(recovered).toMatchObject({ state: "completed", operationId: original.operationId, request: original.request,
      commands: original.commands, bodies: original.bodies });
    expect(jobs(f)).toHaveLength(2); expect(commit).toHaveBeenCalledTimes(2); expect(f.method).toHaveBeenCalledTimes(2);
    await f.refresh(); expect(await f.run()).toBe(false);
    expect(f.bank.server.receipts.size).toBe(2);
  });

  it("resumes a prepared batch before new candidates after interrupted upload", async () => {
    const f = fixture({ seed: (bank) => bank.native.push(extraMemory(bank)) });
    vi.spyOn(f.bank.server.client, "uploadApplicationBody").mockRejectedValueOnce(hindsightError("HINDSIGHT_TIMEOUT"));
    await expect(f.run()).rejects.toMatchObject({ code: "HINDSIGHT_TIMEOUT" });
    const original = jobs(f)[0]!; expect(original.state).toBe("prepared");
    publishNative(f, extraMemory(f.bank, "11111111-1111-4111-8111-111111111111"));
    await f.refresh();
    expect(await f.run(f.createBinding())).toBe(true);
    expect(jobs(f)).toHaveLength(1); expect(f.method).toHaveBeenCalledOnce();
    expect(f.commands.get(original.key)).toMatchObject({ operationId: original.operationId, request: original.request,
      commands: original.commands, bodies: original.bodies, state: "completed" });
    await f.refresh(); expect(await f.run()).toBe(true); await f.refresh();
    expect(await f.run()).toBe(false); expect(f.method).toHaveBeenCalledTimes(2);
  });

  it.each([{ count: 8, sizes: [8], requests: 33 }, { count: 20, sizes: [8, 8, 4], requests: 87 }])(
    "binds $count Memories with one label read per batch and zero own-body downloads", async ({ count, sizes: expectedSizes, requests }) => {
    const f = fixture({ seed: (bank) => {
      for (let i = 1; i < count; i++) bank.native.push(applicationTestNative({ kind: "memory_unit", scope: bank.scope, cursor: 2,
        payload: applicationTestMemoryPayload({ bank_id: bank.scope.bankId,
          memory_id: `33333333-3333-4333-8333-${String(i).padStart(12, "0")}`, document_id: null, tags: ["taki-layer:profile"] }) }));
    } });
    const sizes: number[] = [];
    while (await f.run()) {
      const row = f.jobs().find((job) => job.operation_id === [...f.bank.server.receipts.keys()].at(-1))!;
      sizes.push(applicationCommandList(f.commands.get({ authorityEpochId: "epoch", bankId: f.bank.scope.bankId,
        requestId: String(row.request_id) })!.commands).length);
      await f.refresh();
    }
    expect(sizes).toEqual(expectedSizes); expect(f.jobs()).toHaveLength(expectedSizes.length);
    expect(f.method.mock.calls.map(([input]) => input.request.units.length)).toEqual(expectedSizes);
    expect(f.remote.calls.filter((call) => ["body", "part"].includes(call.operation))).toEqual([]);
    expect(f.remote.calls.filter((call) => call.operation === "change-page")).toHaveLength(expectedSizes.length);
    expect(f.bank.server.calls.filter((call) => call.startsWith("read-body:")).sort()).toEqual(jobs(f)
      .map((job) => `read-body:${job.receipt!.affected_versions_ref!.body_id}`).sort());
    expect(f.bank.server.calls.length + f.remote.calls.length + f.method.mock.calls.length).toBe(requests);
    for (const native of f.bank.native.filter((entry) => entry.head.object_kind === "memory_unit")) {
      expect(f.replica.record({ ...f.bank.scope, memoryId: native.head.object_id })?.policy.layerId).toBe("profile");
    }
  });

  it.each(["missing", "revision", "hash", "target", "scope", "group", "value", "producer", "duplicate"])(
    "keeps siblings labelled when one unit has %s evidence", async (failure) => {
      const f = fixture({ seed: (bank) => bank.native.push(extraMemory(bank)) });
      const original = f.method.getMockImplementation()!;
      f.method.mockImplementation(async (input) => {
        const result = await original(input); const proof = result.evidence.find((entry) => entry.unit_id === UNIT)!;
        if (failure === "missing") result.evidence = result.evidence.filter((entry) => entry !== proof);
        if (failure === "revision") proof.unit_revision++;
        if (failure === "hash") proof.unit_payload_hash = "0".repeat(64);
        if (failure === "target") proof.target = { ...proof.target, bank_id: "foreign-bank" };
        if (failure === "scope") proof.scope = "character";
        if (failure === "group") proof.group_definition_hash = "0".repeat(64);
        if (failure === "value") proof.value = "unknown-layer";
        if (failure === "producer") Object.assign(proof, { producer: "invalid-producer" });
        if (failure === "duplicate") result.evidence.push(structuredClone(proof));
        return result;
      });
      expect(await f.run()).toBe(true); await f.refresh(); expect(await f.run()).toBe(false);
      expect(body(f).policy.layerId).toBe("unclassified");
      expect(f.replica.record({ ...f.bank.scope, memoryId: "44444444-4444-4444-8444-444444444444" })?.policy.layerId).toBe("profile");
      expect(f.method).toHaveBeenCalledOnce(); expect(f.jobs()).toHaveLength(1);
    });

  it("excludes an imported non-UUID from the batch request without losing its sibling's label", async () => {
    const f = fixture({ seed: (bank) => bank.native.push(extraMemory(bank, "imported-memory")) });
    expect(await f.run()).toBe(true); await f.refresh();
    expect(f.method.mock.calls[0]![0].request.units.map((unit) => unit.unit_id)).toEqual([UNIT]);
    expect(body(f).policy.layerId).toBe("profile");
    expect(f.replica.record({ ...f.bank.scope, memoryId: "imported-memory" })?.policy.layerId).toBe("unclassified");
    expect(applicationCommandList(jobs(f)[0]!.commands)).toHaveLength(2);
  });

  it("keeps the complete batch neutral when the label endpoint is unavailable", async () => {
    const f = fixture({ seed: (bank) => bank.native.push(extraMemory(bank)) });
    f.method.mockRejectedValueOnce(new HindsightTemplateRefusal("unsupported_storage"));
    expect(await f.run()).toBe(true); await f.refresh(); expect(await f.run()).toBe(false);
    for (const id of [UNIT, "44444444-4444-4444-8444-444444444444"]) {
      expect(f.replica.record({ ...f.bank.scope, memoryId: id })?.policy.layerId).toBe("unclassified");
    }
    expect(f.method).toHaveBeenCalledOnce(); expect(f.bank.server.receipts.size).toBe(1);
  });

  it.each(["prepared", "completed"] as const)("reopens a %s job and publishes its original bodies without consuming labels", async (state) => {
    const directory = mkdtempSync(join(tmpdir(), "taki-binding-reopen-")); directories.push(directory);
    const path = join(directory, "core.sqlite");
    const f = fixture({ path, seed: (bank) => bank.native.push(extraMemory(bank)) });
    if (state === "prepared") {
      vi.spyOn(f.bank.server.client, "uploadApplicationBody").mockRejectedValueOnce(hindsightError("HINDSIGHT_TIMEOUT"));
      await expect(f.run()).rejects.toMatchObject({ code: "HINDSIGHT_TIMEOUT" });
    } else expect(await f.run()).toBe(true);
    const original = jobs(f)[0]!; expect(original.state).toBe(state);
    const checkpoint = f.replica.checkpoint(f.bank.scope.bankId);
    expect(f.replica.record({ ...f.bank.scope, memoryId: UNIT })).toBeUndefined();
    await f.close();
    const reopened = fixture({ path, bank: f.bank });
    reopened.method.mockRejectedValue(new Error("recovery must not consume another label"));
    expect(reopened.replica.checkpoint(f.bank.scope.bankId)).toEqual(checkpoint);
    expect(await reopened.run()).toBe(true);
    const recovered = reopened.commands.get(original.key)!;
    expect(recovered).toMatchObject({ commands: original.commands, bodies: original.bodies, request: original.request,
      operationId: original.operationId, preparedAt: original.preparedAt, state: "completed" });
    expect(reopened.writer.applied(recovered)).toBe(false);
    await reopened.refresh(); expect(await reopened.run()).toBe(false);
    expect(reopened.writer.applied(recovered)).toBe(true); expect(reopened.method).not.toHaveBeenCalled();
    expect(reopened.remote.calls.filter((call) => ["body", "part"].includes(call.operation))).toEqual([]);
    expect(reopened.bank.server.receipts.size).toBe(1);
    expect(reopened.replica.checkpoint(f.bank.scope.bankId)?.checkpoint).toEqual(recovered.receipt!.checkpoint);
    expect(body(reopened).policy.layerId).toBe("profile");
    for (const memory of recovered.bodies) {
      expect(reopened.replica.body({ ...f.bank.scope, bodyId: memory.ref.body_id })).toEqual(memory);
    }
  });

  it("continues past a full page of ineligible leading Memories", async () => {
    const f = fixture({ seed: (bank) => {
      for (let i = 0; i < 9; i++) bank.native.push(applicationTestNative({ kind: "memory_unit", scope: bank.scope, cursor: 2,
        payload: applicationTestMemoryPayload({ bank_id: bank.scope.bankId,
          memory_id: `11111111-1111-4111-8111-${String(i).padStart(12, "0")}`, document_id: null, state: "invalidated",
          invalidated_at: APPLICATION_TEST_AT, invalidation_reason: "fixture" }) }));
    } });
    expect(await f.run()).toBe(true); await f.refresh(); expect(body(f).policy.layerId).toBe("profile");
    expect(await f.run()).toBe(false); expect(f.method).toHaveBeenCalledOnce(); expect(f.jobs()).toHaveLength(1);
  });

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

  it.each(["HINDSIGHT_TIMEOUT", "HINDSIGHT_UNREACHABLE"] as const)(
    "preserves %s after lost ACK and lease loss, then recovers the original command once", async (code) => {
      const f = fixture(); const actual = f.bank.server.client.commitApplication;
      const commit = vi.spyOn(f.bank.server.client, "commitApplication").mockImplementationOnce(async (input) => {
        await actual(input); throw hindsightError(code);
      });
      const run = f.writer.run;
      vi.spyOn(f.writer, "run").mockImplementationOnce(async (input) => {
        const result = await run(input);
        expect(result).toMatchObject({ status: "pending", outcome: "unknown", code });
        f.control.revoke(); return result;
      });
      const applied = vi.spyOn(f.writer, "applied");
      await expect(f.run()).rejects.toMatchObject({ code });
      expect(applied).not.toHaveBeenCalled(); expect(f.jobs()).toHaveLength(1);
      const original = f.jobs()[0]!;
      expect(original.state).toBe("dispatched"); expect(f.bank.events).toHaveLength(1);
      const receipt = [...f.bank.server.receipts.values()][0]!;
      const status = vi.spyOn(f.bank.server.client, "applicationCommit");
      expect(await f.run()).toBe(true);
      expect(status).toHaveBeenCalledOnce(); expect(commit).toHaveBeenCalledOnce();
      expect(f.jobs()).toHaveLength(1); expect(f.jobs()[0]).toMatchObject({
        operation_id: original.operation_id, request_id: original.request_id, request_bytes: original.request_bytes, state: "completed" });
      expect([...f.bank.server.receipts.values()]).toEqual([receipt]); expect(f.method).toHaveBeenCalledOnce();
      await f.refresh(); expect(body(f).policy.layerId).toBe("profile");
      expect(await f.run()).toBe(false); expect(f.bank.events).toHaveLength(1);
    });

  it("preserves an exact durable binding refusal after the lease is lost", async () => {
    const f = fixture(); const actual = f.bank.server.client.commitApplication;
    vi.spyOn(f.bank.server.client, "commitApplication").mockImplementationOnce(async (input) => {
      // The Native unit changed after the pull; the original expected version must refuse.
      const head = f.bank.native.find((native) => native.head.object_id === UNIT)!.head;
      head.version = { ...head.version!, object_revision: 2 };
      return actual(input);
    });
    const run = f.writer.run; const applied = vi.spyOn(f.writer, "applied");
    vi.spyOn(f.writer, "run").mockImplementationOnce(async (input) => {
      const result = await run(input); expect(result.status).toBe("refused"); f.control.revoke(); return result;
    });
    const error = await f.run().catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(HindsightApplicationRefusal);
    expect(error).toMatchObject({ refusal: { code: "native_version_conflict" } });
    expect(applied).not.toHaveBeenCalled(); expect(f.bank.events).toEqual([]);
    expect(f.jobs()).toHaveLength(1); expect(f.jobs()[0]!.state).toBe("refused");
  });

  it.each(["lease", "cancel"] as const)("refuses successful writer continuation after %s loss", async (failure) => {
    const f = fixture(); const run = f.writer.run; const applied = vi.spyOn(f.writer, "applied");
    vi.spyOn(f.writer, "run").mockImplementationOnce(async (input) => {
      const result = await run(input); expect(result.status).toBe("completed");
      if (failure === "lease") f.control.revoke(); else f.control.abort.abort();
      return result;
    });
    await expect(f.run()).rejects.toThrow(new Error(failure === "lease" ? "HINDSIGHT_REPLICA_LEASE_LOST" : "HINDSIGHT_CANCELLED"));
    expect(applied).not.toHaveBeenCalled(); expect(f.jobs()[0]!.state).toBe("completed");
    expect(f.replica.record({ ...f.bank.scope, memoryId: UNIT })).toBeUndefined();
    expect(f.bank.server.receipts.size).toBe(1);
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
