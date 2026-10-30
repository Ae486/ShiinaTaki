import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { HINDSIGHT_APPLICATION_UPLOAD_BYTES, type JsonValue, type TakiApplicationCommitReceipt } from "@taki/shared";
import { rmTempDir } from "../testing/rm-temp.ts";
import { APPLICATION_TEST_SCOPE, applicationTestBody, applicationTestMemoryBody,
  applicationTestMemoryPayload, applicationTestNative } from "../testing/hindsight-application-fixtures.ts";
import { applicationCommandTestInput, applicationCommandTestRepo, applicationCommandTestReceipt } from "./hindsight-application-command-fixtures.ts";
import { prepareHindsightApplicationBody } from "../memory/hindsight/hindsight-application-body-transfer.ts";
import { hindsightApplicationBytesHash, hindsightApplicationHash, withoutApplicationHash } from "../memory/hindsight/hindsight-application-integrity.ts";
import { applicationCommandJsonBytes, applicationCommandList } from "./hindsight-application-command-contract.ts";
import { createHindsightApplicationCommandRepo } from "./hindsight-application-command-repo.ts";

const cleanup: Array<() => void> = [];
afterEach(() => { for (const close of cleanup.splice(0).reverse()) close(); });
function fixture(path = ":memory:") { const value = applicationCommandTestRepo(path); cleanup.push(value.close); return value; }
function tempPath() { const root = mkdtempSync(join(tmpdir(), "taki-application-command-")); cleanup.push(() => rmTempDir(root)); return join(root, "state.sqlite"); }
function rowCount(f: ReturnType<typeof fixture>, table: "hindsight_application_command_jobs" | "hindsight_application_command_bodies") {
  return f.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()?.n;
}
function dispatched(f: ReturnType<typeof fixture>) {
  const job = f.repo.prepare(applicationCommandTestInput()); return f.repo.markDispatched({ key: job.key, revision: job.revision });
}
function receiptHash(receipt: TakiApplicationCommitReceipt) {
  receipt.result_hash = hindsightApplicationHash({ bankId: receipt.bank_id, namespace: receipt.namespace,
    domain: "receipt", value: withoutApplicationHash(receipt, "result_hash") }); return receipt;
}

describe("durable application command preparation", () => {
  it("freezes UUID, intent and all raw bodies once and reopens with the exact original wire request", () => {
    const path = tempPath(); const first = fixture(path); const input = applicationCommandTestInput({ content: "Original \uD800 \u0000 source" });
    const job = first.repo.prepare(input);
    const stored = first.db.prepare("SELECT intent_bytes,request_bytes FROM hindsight_application_command_jobs").get();
    expect(stored?.intent_bytes).toBeInstanceOf(Uint8Array); expect(stored?.request_bytes).toBeInstanceOf(Uint8Array);
    expect(first.calls.ids).toBe(1); expect(first.calls.clocks).toBe(1);
    input.bodies[0]!.bytes.fill(0);
    first.close(); const second = fixture(path); const reopened = second.repo.get(job.key)!;
    expect(reopened.request).toEqual(job.request); expect(reopened.operationId).toBe(job.operationId);
    expect(Buffer.from(reopened.bodies[0]!.bytes).equals(job.bodies[0]!.bytes)).toBe(true);
    expect(reopened.bodies[0]!.content).toMatchObject({ value: { content: "Original \uD800 \u0000 source" } });
    const retry = second.repo.prepare(applicationCommandTestInput());
    expect(retry.request).toEqual(job.request); expect(retry.preparedAt).toBe(job.preparedAt);
    expect(second.calls.ids).toBe(0); expect(second.calls.clocks).toBe(0);
    expect(second.db.prepare("SELECT intent_bytes,request_bytes FROM hindsight_application_command_jobs").get()).toEqual(stored);
  });

  it("compares semantic intent independently of object ordering and rejects a different intent under one key", () => {
    const f = fixture(); const job = f.repo.prepare(applicationCommandTestInput({ intent: { keep: true, items: [null, 1, "1"] } }));
    expect(f.repo.prepare(applicationCommandTestInput({ intent: { items: [null, 1, "1"], keep: true } })).operationId).toBe(job.operationId);
    expect(() => f.repo.prepare(applicationCommandTestInput({ intent: { items: [null, "1", "1"], keep: true } }))).toThrow("MEMORY_REQUEST_ID_CONFLICT");
    expect(f.calls.ids).toBe(1); expect(rowCount(f, "hindsight_application_command_jobs")).toBe(1);
  });

  it("keeps deep typed original intent as BLOB bytes beyond SQLite JSON1's recursion limit", () => {
    const f = fixture(); const intent: Record<string, JsonValue> = {}; let next = intent;
    for (let i = 0; i < 1500; i++) { const child: Record<string, JsonValue> = {}; next.child = child; next = child; }
    next.value = [false, null, "{\"typed\":false}", "\uD800", 1e-200];
    const job = f.repo.prepare(applicationCommandTestInput({ intent }));
    const raw = f.db.prepare("SELECT intent_bytes FROM hindsight_application_command_jobs").get()?.intent_bytes;
    expect(f.db.prepare("SELECT json_valid(:raw) AS valid").get({ raw: raw! })?.valid).toBe(0);
    expect(hindsightApplicationBytesHash(applicationCommandJsonBytes(f.repo.get(job.key)!.intent)))
      .toBe(hindsightApplicationBytesHash(applicationCommandJsonBytes(intent)));
  });

  it("never repurposes an immutable body ID even for a same-intent retry or a different local request", () => {
    const f = fixture(); const input = applicationCommandTestInput(); const job = f.repo.prepare(input);
    const original = input.bodies[0]!;
    if (original.content.body_schema !== "application-block.v1") throw new Error("bad fixture");
    const body = prepareHindsightApplicationBody({ ...APPLICATION_TEST_SCOPE, bodyId: original.ref.body_id,
      schema: "application-block.v1", value: { ...original.content.value, content: "Different bytes" } });
    const commands = applicationTestBody("application-commands.v1", { commands: [{ ...applicationCommandList(input.commands)[0], body_ref: body.ref }] });
    for (const requestId of [job.key.requestId, "second-request"]) expect(() => f.repo.prepare({ ...input,
      key: { ...input.key, requestId }, commands, bodies: [body] })).toThrow("MEMORY_REQUEST_ID_CONFLICT");
    expect(rowCount(f, "hindsight_application_command_jobs")).toBe(1);
    expect(rowCount(f, "hindsight_application_command_bodies")).toBe(2);
  });

  it("rejects a missing direct body, extra body, conflicting descriptor and changed command key", () => {
    const f = fixture(); const input = applicationCommandTestInput();
    expect(() => f.repo.prepare({ ...input, bodies: [] })).toThrow("MEMORY_INVALID_REQUEST");
    expect(() => f.repo.prepare({ ...input, bodies: [...input.bodies, applicationCommandTestInput().bodies[0]!] })).toThrow("MEMORY_INVALID_REQUEST");
    const commands = applicationTestBody("application-commands.v1", { commands: [{ ...applicationCommandList(input.commands)[0],
      body_ref: { ...input.bodies[0]!.ref, body_id: randomUUID() } }] });
    expect(() => f.repo.prepare({ ...input, commands })).toThrow("MEMORY_INVALID_REQUEST");
    const mismatched = applicationTestBody("application-commands.v1", { commands: [{ ...applicationCommandList(input.commands)[0],
      expected_artifact: { key: { artifact_kind: "block", artifact_id: "another" }, revision: 1, record_hash: "a".repeat(64) } }] });
    expect(() => f.repo.prepare({ ...input, commands: mismatched })).toThrow("MEMORY_INVALID_REQUEST");
    expect(rowCount(f, "hindsight_application_command_jobs")).toBe(0); expect(f.calls.ids).toBe(0);
  });

  it("refuses an aggregate direct-body closure over 16 MiB before allocating or storing a command", () => {
    const f = fixture(); const left = applicationCommandTestInput({ content: "x".repeat(HINDSIGHT_APPLICATION_UPLOAD_BYTES / 2) });
    const right = applicationCommandTestInput({ content: "y".repeat(HINDSIGHT_APPLICATION_UPLOAD_BYTES / 2) });
    const commands = applicationTestBody("application-commands.v1", { commands: [applicationCommandList(left.commands)[0],
      { ...applicationCommandList(right.commands)[0], key: { artifact_kind: "block", artifact_id: "other" } }] });
    expect(() => f.repo.prepare({ ...left, commands, bodies: [...left.bodies, ...right.bodies] })).toThrow("HINDSIGHT_APPLICATION_PAYLOAD_TOO_LARGE");
    expect(f.calls.ids).toBe(0); expect(rowCount(f, "hindsight_application_command_jobs")).toBe(0);
    expect(rowCount(f, "hindsight_application_command_bodies")).toBe(0);
  });

  it("counts the command body in the ceiling and deduplicates repeated direct references by immutable ID", () => {
    const f = fixture(); const input = applicationCommandTestInput();
    expect(f.repo.prepare({ ...input, bodies: [input.bodies[0]!, input.bodies[0]!] }).bodies).toHaveLength(1);
    const other = applicationCommandTestInput({ requestId: "near-limit" }); const empty = other.bodies[0]!;
    if (empty.content.body_schema !== "application-block.v1") throw new Error("bad fixture");
    const fixed = applicationTestBody("application-block.v1", { ...empty.content.value, content: "" });
    const body = applicationTestBody("application-block.v1", { ...empty.content.value,
      content: "x".repeat(HINDSIGHT_APPLICATION_UPLOAD_BYTES - fixed.bytes.byteLength - 1) });
    expect(body.bytes.byteLength).toBe(HINDSIGHT_APPLICATION_UPLOAD_BYTES - 1);
    const commands = applicationTestBody("application-commands.v1", { commands: [{ ...applicationCommandList(other.commands)[0], body_ref: body.ref }] });
    expect(() => f.repo.prepare({ ...other, commands, bodies: [body] })).toThrow("HINDSIGHT_APPLICATION_PAYLOAD_TOO_LARGE");
    expect(rowCount(f, "hindsight_application_command_jobs")).toBe(1);
    const exactBody = applicationTestBody("application-block.v1", { ...empty.content.value,
      content: "x".repeat(HINDSIGHT_APPLICATION_UPLOAD_BYTES - fixed.bytes.byteLength - commands.bytes.byteLength) });
    const exactCommands = applicationTestBody("application-commands.v1", { commands: [{ ...applicationCommandList(other.commands)[0], body_ref: exactBody.ref }] });
    expect(exactCommands.bytes.byteLength + exactBody.bytes.byteLength).toBe(HINDSIGHT_APPLICATION_UPLOAD_BYTES);
    expect(f.repo.prepare({ ...other, commands: exactCommands, bodies: [exactBody] }).state).toBe("prepared");
  });

  it("rolls back UUID/time, job and bodies together when its final guard refuses", () => {
    const f = fixture(); f.control.failWhenPrepared = true;
    expect(() => f.repo.prepare(applicationCommandTestInput())).toThrow("MEMORY_AUTHORITY_MISMATCH");
    expect(rowCount(f, "hindsight_application_command_jobs")).toBe(0); expect(rowCount(f, "hindsight_application_command_bodies")).toBe(0);
    f.control.failWhenPrepared = false; expect(f.repo.prepare(applicationCommandTestInput()).state).toBe("prepared");
    expect(f.calls.ids).toBe(2);
  });

  it("participates in an outer transaction so another durable-intent failure leaves no orphan preparation", () => {
    const f = fixture();
    expect(() => f.db.transaction(() => { f.repo.prepare(applicationCommandTestInput()); f.db.exec("INSERT INTO missing_compound_intent VALUES (1)"); })).toThrow();
    expect(rowCount(f, "hindsight_application_command_jobs")).toBe(0); expect(rowCount(f, "hindsight_application_command_bodies")).toBe(0);
  });

  it("requires a synchronous active guard and refuses a changed namespace without touching existing evidence", () => {
    const f = fixture(); const input = applicationCommandTestInput(); const job = f.repo.prepare(input);
    const before = f.db.prepare("SELECT * FROM hindsight_application_command_jobs").get();
    f.control.namespace.bank_generation = randomUUID();
    expect(() => f.repo.get(job.key)).toThrow("MEMORY_AUTHORITY_MISMATCH");
    expect(() => f.repo.markDispatched({ key: job.key, revision: job.revision })).toThrow("MEMORY_AUTHORITY_MISMATCH");
    expect(f.db.prepare("SELECT * FROM hindsight_application_command_jobs").get()).toEqual(before);
    const invalid = createHindsightApplicationCommandRepo({ db: f.db, assertActive: async () => undefined });
    expect(() => invalid.prepare(applicationCommandTestInput({ requestId: "async-guard" }))).toThrow("MEMORY_INVALID_REQUEST");
  });
});

describe("application remote receipt persistence", () => {
  it("checks exact prior artifact revisions for rebind and retire and preserves independent native cursor bounds", () => {
    const f = fixture(); const input = applicationCommandTestInput();
    const native = applicationTestNative({ payload: applicationTestMemoryPayload({ revision: 4 }), kind: "memory_unit", cursor: 12 });
    if (!native.head.version) throw new Error("bad fixture");
    const memory = applicationTestBody("application-memory.v1", applicationTestMemoryBody(native.head.version));
    const key = { artifact_kind: "memory", artifact_id: native.head.object_id };
    const commands = applicationTestBody("application-commands.v1", { commands: [
      { command: "rebind_artifact", key, expected_artifact: { key, revision: 7, record_hash: "a".repeat(64) },
        expected_native: native.head.version, body_ref: memory.ref, actor: { kind: "background", actor_ref: "curator" } },
      { command: "retire_artifact", key: { artifact_kind: "block", artifact_id: "user-model" },
        expected_artifact: { key: { artifact_kind: "block", artifact_id: "user-model" }, revision: 2, record_hash: "b".repeat(64) },
        expected_native: null, reason: "explicit_delete", actor: { kind: "user", actor_ref: "owner" } },
    ] });
    const prepared = f.repo.prepare({ ...input, commands, bodies: [memory] });
    const job = f.repo.markDispatched({ key: prepared.key, revision: prepared.revision });
    const stale = applicationCommandTestReceipt({ job, nativeCursor: 11 });
    expect(() => f.repo.recordReceipt({ key: job.key, revision: job.revision, receipt: stale.receipt, affectedVersionsBody: stale.body })).toThrow("MEMORY_INTEGRITY_ERROR");
    const proof = applicationCommandTestReceipt({ job, nativeCursor: 12 });
    const completed = f.repo.recordReceipt({ key: job.key, revision: job.revision, receipt: proof.receipt, affectedVersionsBody: proof.body });
    expect(completed.affectedVersionsBody?.content).toMatchObject({ value: { artifacts: [
      { key, revision: 8 }, { key: { artifact_kind: "block", artifact_id: "user-model" }, revision: 3 },
    ] } });
  });

  it("requires version CAS and stores a complete immutable historical receipt/body across reopen", () => {
    const path = tempPath(); const f = fixture(path); const job = dispatched(f); const proof = applicationCommandTestReceipt({ job });
    expect(() => f.repo.markDispatched({ key: job.key, revision: job.revision - 1 })).toThrow("MEMORY_REVISION_MISMATCH");
    expect(() => f.repo.recordReceipt({ key: job.key, revision: job.revision - 1, receipt: proof.receipt, affectedVersionsBody: proof.body })).toThrow("MEMORY_REVISION_MISMATCH");
    const completed = f.repo.recordReceipt({ key: job.key, revision: job.revision, receipt: proof.receipt, affectedVersionsBody: proof.body });
    expect(completed.state).toBe("completed"); expect(completed.revision).toBe(job.revision + 1);
    const row = f.db.prepare("SELECT receipt_bytes,receipt_bytes_hash FROM hindsight_application_command_jobs").get();
    expect(row?.receipt_bytes).toEqual(applicationCommandJsonBytes(proof.receipt));
    f.close(); const next = fixture(path); const reopened = next.repo.get(job.key)!;
    expect(reopened.receipt).toEqual(proof.receipt); expect(reopened.affectedVersionsBody?.bytes).toEqual(proof.body?.bytes);
    expect(next.repo.recordReceipt({ key: job.key, revision: job.revision, receipt: proof.receipt, affectedVersionsBody: proof.body })).toEqual(reopened);
    expect(next.db.prepare("SELECT receipt_bytes,receipt_bytes_hash FROM hindsight_application_command_jobs").get()).toEqual(row);
    const different = applicationCommandTestReceipt({ job, nativeCursor: 99, stateCursor: 20 });
    expect(() => next.repo.recordReceipt({ key: job.key, revision: reopened.revision,
      receipt: different.receipt, affectedVersionsBody: different.body })).toThrow("MEMORY_REQUEST_ID_CONFLICT");
  });

  it("retains a refused historical receipt without a checkpoint or invented affected versions", () => {
    const f = fixture(); const job = dispatched(f); const proof = applicationCommandTestReceipt({ job, refusal: "artifact_conflict" });
    const refused = f.repo.recordReceipt({ key: job.key, revision: job.revision, receipt: proof.receipt });
    expect(refused).toMatchObject({ state: "refused", receipt: { state: "refused", checkpoint: null, affected_versions_ref: null }, affectedVersionsBody: null });
  });

  it.each([
    ["operation", (receipt: TakiApplicationCommitReceipt) => { receipt.operation_id = randomUUID(); }],
    ["request", (receipt: TakiApplicationCommitReceipt) => { receipt.request_hash = "f".repeat(64); }],
    ["Bank", (receipt: TakiApplicationCommitReceipt) => { receipt.bank_id = "another-bank"; }],
    ["namespace", (receipt: TakiApplicationCommitReceipt) => { receipt.namespace.bank_generation = randomUUID(); }],
    ["completed refusal", (receipt: TakiApplicationCommitReceipt) => { receipt.refusal = { error: "application_state_error", code: "artifact_conflict", detail: "private" }; }],
    ["missing checkpoint", (receipt: TakiApplicationCommitReceipt) => { receipt.checkpoint = null; }],
  ] as const)("refuses a mismatched %s even with a recomputed receipt digest", (_name, mutate) => {
    const f = fixture(); const job = dispatched(f); const proof = applicationCommandTestReceipt({ job });
    const changed = structuredClone(proof.receipt); mutate(changed); receiptHash(changed);
    expect(() => f.repo.recordReceipt({ key: job.key, revision: job.revision, receipt: changed, affectedVersionsBody: proof.body })).toThrow();
    expect(f.repo.get(job.key)?.state).toBe("dispatched"); expect(f.repo.get(job.key)?.receipt).toBeNull();
  });

  it.each(["key", "revision", "extra", "duplicate", "missing"])("requires exact complete affected versions: %s", (mode) => {
    const f = fixture(); const job = dispatched(f); const proof = applicationCommandTestReceipt({ job });
    if (proof.body?.content.body_schema !== "application-affected-versions.v1") throw new Error("bad fixture");
    const versions = structuredClone(proof.body.content.value.artifacts); const first = versions[0]!;
    if (mode === "key") first.key.artifact_id = "different";
    if (mode === "revision") first.revision = 2;
    if (mode === "extra") versions.push({ ...first, key: { ...first.key, artifact_id: "extra" } });
    if (mode === "duplicate") versions.push(first);
    if (mode === "missing") versions.length = 0;
    const body = applicationTestBody("application-affected-versions.v1", { artifacts: versions });
    const receipt = receiptHash({ ...proof.receipt, affected_versions_ref: body.ref });
    expect(() => f.repo.recordReceipt({ key: job.key, revision: job.revision, receipt, affectedVersionsBody: body })).toThrow("MEMORY_INTEGRITY_ERROR");
    expect(f.repo.get(job.key)?.state).toBe("dispatched");
  });

  it("rolls back a failed receipt transaction including its newly downloaded affected body", () => {
    const f = fixture(); const job = dispatched(f); const proof = applicationCommandTestReceipt({ job });
    f.db.exec(`CREATE TRIGGER fail_application_receipt BEFORE UPDATE OF receipt_bytes ON hindsight_application_command_jobs
      WHEN NEW.receipt_bytes IS NOT NULL BEGIN SELECT RAISE(ABORT,'fixture receipt failure'); END`);
    expect(() => f.repo.recordReceipt({ key: job.key, revision: job.revision, receipt: proof.receipt, affectedVersionsBody: proof.body })).toThrow("fixture receipt failure");
    expect(f.repo.get(job.key)?.state).toBe("dispatched"); expect(rowCount(f, "hindsight_application_command_bodies")).toBe(2);
    f.db.exec("DROP TRIGGER fail_application_receipt");
    expect(f.repo.recordReceipt({ key: job.key, revision: job.revision, receipt: proof.receipt, affectedVersionsBody: proof.body }).state).toBe("completed");
  });

  it.each(["intent_bytes", "request_bytes", "body_bytes", "receipt_bytes"])("detects corrupted %s on a reopened read", (column) => {
    const path = tempPath(); const f = fixture(path); const job = dispatched(f); const proof = applicationCommandTestReceipt({ job });
    f.repo.recordReceipt({ key: job.key, revision: job.revision, receipt: proof.receipt, affectedVersionsBody: proof.body });
    const table = column === "body_bytes" ? "hindsight_application_command_bodies" : "hindsight_application_command_jobs";
    f.db.prepare(`UPDATE ${table} SET ${column}=:bad`).run({ bad: new TextEncoder().encode("{}") });
    f.close(); const reopened = fixture(path); expect(() => reopened.repo.get(job.key)).toThrow("MEMORY_INTEGRITY_ERROR");
  });
});
