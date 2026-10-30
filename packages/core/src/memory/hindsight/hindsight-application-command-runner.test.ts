import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { rmTempDir } from "../../testing/rm-temp.ts";
import { applicationTestBody } from "../../testing/hindsight-application-fixtures.ts";
import { applicationCommandTestInput, applicationCommandTestRepo, applicationCommandTestClient,
  applicationCommandTestReceipt } from "../../db/hindsight-application-command-fixtures.ts";
import { createHindsightApplicationCommandRunner } from "./hindsight-application-command-runner.ts";
import { HindsightApplicationRefusal } from "./hindsight-application-client.ts";
import { hindsightError } from "./hindsight-errors.ts";
import { hindsightApplicationHash, withoutApplicationHash } from "./hindsight-application-integrity.ts";

const cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); vi.restoreAllMocks(); });
function tempPath() { const root = mkdtempSync(join(tmpdir(), "taki-application-runner-")); cleanup.push(() => rmTempDir(root)); return join(root, "state.sqlite"); }
function fixture(path = ":memory:", server = applicationCommandTestClient()) {
  const f = applicationCommandTestRepo(path); const job = f.repo.prepare(applicationCommandTestInput());
  const runner = createHindsightApplicationCommandRunner({ repo: f.repo, client: server.client });
  cleanup.push(async () => { await runner.stop(); f.close(); });
  const run = (context: { timeoutMs: number; signal?: AbortSignal } = { timeoutMs: 20_000 }) => runner.run({ key: job.key, context });
  return { ...f, job, server, runner, run };
}
function calls(f: ReturnType<typeof fixture>, name: string) { return f.server.calls.filter((call) => call.startsWith(`${name}:`)); }
function storedState(f: ReturnType<typeof fixture>) { return f.db.prepare("SELECT state,receipt_bytes FROM hindsight_application_command_jobs").get(); }
function tick() { return new Promise<void>((resolve) => setImmediate(resolve)); }
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((complete) => { resolve = complete; });
  return { promise, resolve };
}

describe("application command recovery runner", () => {
  it("uploads complete immutable bodies, persists dispatch before commit and returns remote completion without replay", async () => {
    const f = fixture(); const actual = f.server.client.commitApplication;
    const commit = vi.spyOn(f.server.client, "commitApplication").mockImplementation(async (input) => {
      expect(storedState(f)).toMatchObject({ state: "dispatched", receipt_bytes: null });
      expect(input.request).toEqual(f.job.request); return actual(input);
    });
    const result = await f.run(); expect(result.status).toBe("completed");
    expect(f.repo.get(f.job.key)?.receipt).toEqual(result.job.receipt); expect(result.job.affectedVersionsBody).not.toBeNull();
    expect(calls(f, "upload")).toHaveLength(2); expect(calls(f, "seal")).toHaveLength(2);
    expect(calls(f, "status")).toHaveLength(0); expect(commit).toHaveBeenCalledTimes(1);
    const count = f.server.calls.length;
    expect((await f.run()).job.receipt).toEqual(result.job.receipt); expect(f.server.calls).toHaveLength(count);
    expect(f.db.prepare("SELECT COUNT(*) AS n FROM pending_memory").get()?.n).toBe(0);
  });

  it("resumes a part upload ACK loss using the original body IDs and preparation after SQLite reopen", async () => {
    const path = tempPath(); const f = fixture(path); const actual = f.server.client.putApplicationBodyPart;
    vi.spyOn(f.server.client, "putApplicationBodyPart").mockImplementationOnce(async (input) => { await actual(input); throw new Error("PRIVATE_UPLOAD_ACK_LOST"); });
    const first = await f.run(); expect(first).toMatchObject({ status: "pending", outcome: "not_dispatched", code: "HINDSIGHT_UNREACHABLE" });
    expect(first.job.state).toBe("prepared"); expect(calls(f, "commit")).toHaveLength(0);
    await f.runner.stop(); f.close(); const next = fixture(path, f.server);
    expect((await next.run()).status).toBe("completed"); expect(next.job.request).toEqual(f.job.request);
    expect(next.calls.ids).toBe(0); expect(calls(next, "commit")).toEqual([`commit:${f.job.operationId}`]);
    expect(calls(next, "part").filter((call) => call === `part:${f.job.bodies[0]!.ref.body_id}:0`)).toHaveLength(2);
  });

  it("reads the original receipt after commit ACK loss and later native/application supersession without another commit", async () => {
    const path = tempPath(); const f = fixture(path); const actual = f.server.client.commitApplication;
    vi.spyOn(f.server.client, "commitApplication").mockImplementationOnce(async (input) => { await actual(input); throw new Error("PRIVATE_COMMIT_ACK_LOST"); });
    const lost = await f.run(); expect(lost).toMatchObject({ status: "pending", outcome: "unknown", job: { state: "dispatched" } });
    const historical = f.server.receipts.get(f.job.operationId)!; const uploadCount = calls(f, "upload").length;
    f.server.cursor.native = 100; f.server.cursor.state = 200;
    await f.runner.stop(); f.close(); const next = fixture(path, f.server);
    const recovered = await next.run(); expect(recovered.status).toBe("completed"); expect(recovered.job.receipt).toEqual(historical);
    expect(calls(next, "status")).toEqual([`status:${f.job.operationId}`]);
    expect(calls(next, "commit")).toHaveLength(1); expect(calls(next, "upload")).toHaveLength(uploadCount);
    expect(next.calls.ids).toBe(0);
  });

  it("queries exact historical status before replaying a dispatched job only after authenticated absence", async () => {
    const f = fixture(); f.repo.markDispatched({ key: f.job.key, revision: f.job.revision });
    const commit = vi.spyOn(f.server.client, "commitApplication");
    expect((await f.run()).status).toBe("completed");
    expect(f.server.calls[0]).toBe(`status:${f.job.operationId}`);
    expect(commit.mock.calls[0]?.[0].request).toEqual(f.job.request); expect(f.calls.ids).toBe(1);
  });

  it("does not interpret an unscoped error or an inconsistent absence as permission to replay", async () => {
    const f = fixture(); f.repo.markDispatched({ key: f.job.key, revision: f.job.revision });
    vi.spyOn(f.server.client, "applicationCommit").mockRejectedValueOnce(new HindsightApplicationRefusal({
      error: "application_state_error", code: "bank_not_found", detail: "PRIVATE_BAD_BANK",
    }));
    expect(await f.run()).toMatchObject({ status: "pending", outcome: "unknown", refusalCode: "bank_not_found" });
    expect(calls(f, "commit")).toHaveLength(0); expect(calls(f, "upload")).toHaveLength(0);
    const proof = applicationCommandTestReceipt({ job: f.job });
    vi.spyOn(f.server.client, "applicationCommit").mockResolvedValueOnce({ namespace: f.job.namespace, bank_id: f.job.key.bankId,
      operation_id: f.job.operationId, state: "absent", receipt: proof.receipt });
    await expect(f.run()).rejects.toThrow("MEMORY_INTEGRITY_ERROR"); expect(calls(f, "commit")).toHaveLength(0);
  });

  it("refuses a historical operation with a conflicting original request hash", async () => {
    const f = fixture(); f.repo.markDispatched({ key: f.job.key, revision: f.job.revision });
    const { receipt } = applicationCommandTestReceipt({ job: f.job }); receipt.request_hash = "f".repeat(64);
    receipt.result_hash = hindsightApplicationHash({ bankId: f.job.key.bankId, namespace: f.job.namespace,
      domain: "receipt", value: withoutApplicationHash(receipt, "result_hash") });
    f.server.receipts.set(f.job.operationId, receipt);
    await expect(f.run()).rejects.toThrow("MEMORY_INTEGRITY_ERROR");
    expect(calls(f, "commit")).toHaveLength(0); expect(f.repo.get(f.job.key)?.state).toBe("dispatched");
  });

  it("persists a real refused historical receipt and never manufactures one from a transport refusal", async () => {
    const f = fixture(); f.repo.markDispatched({ key: f.job.key, revision: f.job.revision });
    const { receipt } = applicationCommandTestReceipt({ job: f.job, refusal: "native_version_conflict" });
    f.server.receipts.set(f.job.operationId, receipt);
    expect(await f.run()).toMatchObject({ status: "refused", job: { receipt, affectedVersionsBody: null } });
    const count = f.server.calls.length; expect((await f.run()).status).toBe("refused"); expect(f.server.calls).toHaveLength(count);
    expect(calls(f, "commit")).toHaveLength(0);
  });

  it("retains a dispatched job when a commit refusal has no immutable historical receipt", async () => {
    const f = fixture();
    vi.spyOn(f.server.client, "commitApplication").mockRejectedValue(new HindsightApplicationRefusal({
      error: "application_state_error", code: "native_version_conflict", detail: "PRIVATE_CAS_DETAILS",
    }));
    const result = await f.run();
    expect(result).toMatchObject({ status: "pending", outcome: "unknown", code: "HINDSIGHT_STATE_CONFLICT", refusalCode: "native_version_conflict" });
    expect(JSON.stringify(result)).not.toContain("PRIVATE_CAS_DETAILS"); expect(f.repo.get(f.job.key)?.receipt).toBeNull();
  });

  it("retries a receipt-body download failure from historical status without sending the command again", async () => {
    const f = fixture(); vi.spyOn(f.server.client, "applicationBodyPart").mockRejectedValueOnce(hindsightError("HINDSIGHT_TIMEOUT"));
    expect(await f.run()).toMatchObject({ status: "pending", outcome: "unknown", code: "HINDSIGHT_TIMEOUT" });
    expect(f.repo.get(f.job.key)?.state).toBe("dispatched");
    expect((await f.run()).status).toBe("completed"); expect(calls(f, "commit")).toHaveLength(1); expect(calls(f, "status")).toHaveLength(1);
  });

  it("recovers a local receipt transaction rollback through the remote historical receipt", async () => {
    const f = fixture();
    f.db.exec(`CREATE TRIGGER fail_remote_receipt BEFORE UPDATE OF receipt_bytes ON hindsight_application_command_jobs
      WHEN NEW.receipt_bytes IS NOT NULL BEGIN SELECT RAISE(ABORT,'fixture receipt rollback'); END`);
    await expect(f.run()).rejects.toThrow("fixture receipt rollback");
    expect(f.repo.get(f.job.key)?.state).toBe("dispatched");
    f.db.exec("DROP TRIGGER fail_remote_receipt");
    expect((await f.run()).status).toBe("completed"); expect(calls(f, "commit")).toHaveLength(1); expect(calls(f, "status")).toHaveLength(1);
  });

  it("refuses a hash-valid affected body for the wrong key before accepting remote completion", async () => {
    const f = fixture(); const actual = f.server.client.commitApplication;
    vi.spyOn(f.server.client, "commitApplication").mockImplementationOnce(async (input) => {
      const original = await actual(input);
      const body = applicationTestBody("application-affected-versions.v1", { artifacts: [
        { key: { artifact_kind: "block", artifact_id: "unrelated" }, revision: 1, record_hash: "a".repeat(64) },
      ] });
      f.server.storeBody(body); const receipt = { ...original, affected_versions_ref: body.ref };
      receipt.result_hash = hindsightApplicationHash({ bankId: f.job.key.bankId, namespace: f.job.namespace,
        domain: "receipt", value: withoutApplicationHash(receipt, "result_hash") }); return receipt;
    });
    await expect(f.run()).rejects.toThrow("MEMORY_INTEGRITY_ERROR");
    expect(f.repo.get(f.job.key)?.state).toBe("dispatched");
    expect((await f.run()).status).toBe("completed"); expect(calls(f, "commit")).toHaveLength(1);
  });

  it("serializes the same local request while allowing the historical terminal receipt to satisfy another waiter", async () => {
    const f = fixture(); const [first, second] = await Promise.all([f.run(), f.run()]);
    expect(first.status).toBe("completed"); expect(second.job.receipt).toEqual(first.job.receipt);
    expect(calls(f, "commit")).toHaveLength(1); await f.runner.settle();
  });

  it("fences namespace drift after upload and before any commit dispatch", async () => {
    const f = fixture(); const actual = f.server.client.sealApplicationBody;
    vi.spyOn(f.server.client, "sealApplicationBody").mockImplementation(async (input) => {
      const result = await actual(input); f.control.namespace.bank_generation = randomUUID(); return result;
    });
    await expect(f.run()).rejects.toThrow("MEMORY_AUTHORITY_MISMATCH"); expect(calls(f, "commit")).toHaveLength(0);
    expect(storedState(f)).toMatchObject({ state: "prepared", receipt_bytes: null });
  });

  it("rejects a late completion after authority/namespace drift without discarding the remote receipt", async () => {
    const f = fixture(); const actual = f.server.client.commitApplication;
    vi.spyOn(f.server.client, "commitApplication").mockImplementationOnce(async (input) => {
      const receipt = await actual(input); f.control.namespace.bank_generation = randomUUID(); return receipt;
    });
    await expect(f.run()).rejects.toThrow("MEMORY_AUTHORITY_MISMATCH");
    expect(storedState(f)).toMatchObject({ state: "dispatched", receipt_bytes: null }); expect(f.server.receipts.has(f.job.operationId)).toBe(true);
  });

  it("stops and settles an abort-ignoring commit, then permits no late SQLite callback", async () => {
    const f = fixture(); const actual = f.server.client.commitApplication;
    const entered = deferred(); const release = deferred();
    vi.spyOn(f.server.client, "commitApplication").mockImplementationOnce(async (input) => {
      const receipt = await actual(input); entered.resolve(); await release.promise; return receipt;
    });
    const record = vi.spyOn(f.repo, "recordReceipt"); const get = vi.spyOn(f.repo, "get");
    const running = f.run(); await entered.promise; await f.runner.stop();
    expect(await running).toMatchObject({ status: "pending", outcome: "unknown", code: "HINDSIGHT_CANCELLED" });
    expect(storedState(f)).toMatchObject({ state: "dispatched", receipt_bytes: null });
    const reads = get.mock.calls.length; f.close(); release.resolve(); await tick(); await tick();
    expect(record).not.toHaveBeenCalled(); expect(get).toHaveBeenCalledTimes(reads);
    await expect(f.run()).rejects.toMatchObject({ code: "HINDSIGHT_CANCELLED" }); expect(get).toHaveBeenCalledTimes(reads);
  });

  it("stops an already queued retry before it reads SQLite or dispatches another operation", async () => {
    const f = fixture(); const actual = f.server.client.commitApplication; const entered = deferred(); const release = deferred();
    vi.spyOn(f.server.client, "commitApplication").mockImplementationOnce(async (input) => {
      const receipt = await actual(input); entered.resolve(); await release.promise; return receipt;
    });
    const get = vi.spyOn(f.repo, "get"); const first = f.run(); const queued = f.run();
    const outcomes = Promise.allSettled([first, queued]); await entered.promise; await f.runner.stop();
    const result = await outcomes;
    expect(result[0]).toMatchObject({ status: "fulfilled", value: { status: "pending", code: "HINDSIGHT_CANCELLED" } });
    expect(result[1]).toMatchObject({ status: "rejected", reason: { code: "HINDSIGHT_CANCELLED" } });
    expect(get).toHaveBeenCalledTimes(1); expect(calls(f, "commit")).toHaveLength(1);
    f.close(); release.resolve(); await tick(); expect(get).toHaveBeenCalledTimes(1);
  });

  it("settles active work without cancelling it when the caller requests an ordinary drain", async () => {
    const f = fixture(); const actual = f.server.client.commitApplication; const entered = deferred(); const release = deferred();
    vi.spyOn(f.server.client, "commitApplication").mockImplementationOnce(async (input) => {
      const receipt = await actual(input); entered.resolve(); await release.promise; return receipt;
    });
    const running = f.run(); await entered.promise; let settled = false;
    const settling = f.runner.settle().then(() => { settled = true; }); await tick(); expect(settled).toBe(false);
    release.resolve(); await settling; expect((await running).status).toBe("completed"); expect(settled).toBe(true);
  });

  it("cancels one caller without stopping an independent job or reissuing the first command", async () => {
    const f = fixture(); const second = f.repo.prepare(applicationCommandTestInput({ requestId: "second" }));
    const actual = f.server.client.commitApplication; const entered = deferred(); const release = deferred();
    vi.spyOn(f.server.client, "commitApplication").mockImplementation(async (input) => {
      const receipt = await actual(input);
      if (input.request.operation_id === f.job.operationId) { entered.resolve(); await release.promise; }
      return receipt;
    });
    const controller = new AbortController(); const first = f.run({ timeoutMs: 20_000, signal: controller.signal });
    await entered.promise; controller.abort();
    expect(await first).toMatchObject({ status: "pending", code: "HINDSIGHT_CANCELLED" });
    expect((await f.runner.run({ key: second.key, context: { timeoutMs: 20_000 } })).status).toBe("completed");
    release.resolve(); await tick(); expect((await f.run()).status).toBe("completed"); expect(calls(f, "commit")).toHaveLength(2);
  });

  it("uses one total deadline and cannot renew it between upload and commit phases", async () => {
    const f = fixture(); const actual = f.server.client.uploadApplicationBody;
    vi.spyOn(f.server.client, "uploadApplicationBody").mockImplementation(async (input) => {
      await new Promise((resolve) => setTimeout(resolve, 35)); return actual(input);
    });
    expect(await f.run({ timeoutMs: 50 })).toMatchObject({ status: "pending", outcome: "not_dispatched", code: "HINDSIGHT_TIMEOUT" });
    expect(calls(f, "commit")).toHaveLength(0); expect(storedState(f)?.state).toBe("prepared");
    await new Promise((resolve) => setTimeout(resolve, 50)); expect(calls(f, "commit")).toHaveLength(0);
  });

  it("does not touch storage or network for a caller already cancelled or an overflowing deadline", async () => {
    const f = fixture(); const get = vi.spyOn(f.repo, "get"); const controller = new AbortController(); controller.abort();
    await expect(f.run({ timeoutMs: 10_000, signal: controller.signal })).rejects.toMatchObject({ code: "HINDSIGHT_CANCELLED" });
    await expect(f.run({ timeoutMs: 2_147_483_648 })).rejects.toMatchObject({ code: "HINDSIGHT_TIMEOUT" });
    expect(get).not.toHaveBeenCalled(); expect(f.server.calls).toHaveLength(0);
  });
});
