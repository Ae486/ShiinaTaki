import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { setImmediate } from "node:timers/promises";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { createHindsightBankSetupRepo } from "../../../../../packages/core/src/db/hindsight-bank-setup-repo.ts";
import { createHindsightConnectionRepo } from "../../../../../packages/core/src/db/hindsight-connection-repo.ts";
import { MIGRATIONS } from "../../../../../packages/core/src/db/migrations/index-list.ts";
import { openDatabase } from "../../../../../packages/core/src/db/sqlite.ts";
import { createHindsightClient } from "../../../../../packages/core/src/memory/hindsight/hindsight-client.ts";
import { HindsightError } from "../../../../../packages/core/src/memory/hindsight/hindsight-errors.ts";
import { recoverInterruptedSetup, resolveCurrentRequestTimeout, withRunCancellation } from "./current-cutover-real-data-client.ts";
import { OWNED_RUN_ID, consumeInterruptedRunnerOwner, listenForOperatorAbort, preserveInterruptedRunnerOwner,
  requireOwnedCopy, selectOwnedRunId } from "./current-cutover-real-data-state.ts";

test("run selection admits only the literal owner-approved IDs and preserves the original default", () => {
  assert.equal(selectOwnedRunId(undefined), "06acadec47e7");
  assert.equal(selectOwnedRunId("06acadec47e7"), "06acadec47e7");
  assert.equal(selectOwnedRunId("cd01c5453b1e"), "cd01c5453b1e");
  assert.equal(selectOwnedRunId("654131f0175a"), "654131f0175a");
  for (const input of ["", "unknown", "CD01C5453B1E", " cd01c5453b1e", "cd01c5453b1e ",
    "cd01c5453b1e/nested", "cd01c5453b1e\\nested", "../cd01c5453b1e", "/cd01c5453b1e", "H:/cd01c5453b1e"]) {
    assert.throws(() => selectOwnedRunId(input), /REAL_DATA_RUN_ID_REFUSED/);
  }
});

test("copy admission rejects the other history, nested paths, snapshots and outside paths before reading files", () => {
  const root = fileURLToPath(new URL("../../../../.runtime/d78-real-data/", import.meta.url));
  const others = ["06acadec47e7", "cd01c5453b1e", "654131f0175a"].filter((value) => value !== OWNED_RUN_ID);
  for (const path of [...others.map((value) => join(root, value, "validation.sqlite")), join(root, OWNED_RUN_ID, "nested", "validation.sqlite"),
    join(root, OWNED_RUN_ID, "source-snapshot.sqlite"), join(tmpdir(), "validation.sqlite")]) {
    assert.throws(() => requireOwnedCopy(path), /REAL_DATA_COPY_PATH_REFUSED/);
  }
});

test("the task uses an explicit three-hour request budget with finite validated overrides", () => {
  assert.equal(resolveCurrentRequestTimeout(undefined), 10_800_000);
  assert.equal(resolveCurrentRequestTimeout("14400000"), 14_400_000);
  assert.equal(resolveCurrentRequestTimeout("120000"), 120_000);
  for (const value of ["", "0", "-1", "Infinity", "NaN", "1000", "120000.1", "86400001"]) {
    assert.throws(() => resolveCurrentRequestTimeout(value), /REAL_DATA_DEADLINE_INVALID/);
  }
});

test("run stdin accepts only exact complete abort lines and releases the stream", async () => {
  const stream = new PassThrough();
  let aborted = 0;
  const stop = listenForOperatorAbort(stream, () => { aborted++; });
  try {
    stream.write("not-abort\nabort\r\n");
    stream.write("x".repeat(10_000));
    stream.write("\nab");
    await setImmediate();
    assert.equal(aborted, 0);
    stream.write("ort\n");
    await setImmediate();
    assert.equal(aborted, 1);
    stop();
    assert.equal(stream.listenerCount("data"), 0);
    assert.equal(stream.isPaused(), true);
    stream.write("abort\n");
    await setImmediate();
    assert.equal(aborted, 1);
  } finally { stop(); stream.destroy(); }
});

test("run stdin EOF or pipe closure cancels once and cleans up every lifecycle listener", async () => {
  for (const event of ["end", "close", "already-closed"] as const) {
    const stream = new PassThrough();
    const controller = new AbortController();
    let cancellations = 0;
    if (event === "already-closed") { stream.destroy(); await setImmediate(); }
    const stop = listenForOperatorAbort(stream, () => { cancellations++; controller.abort(); });
    try {
      if (event === "end") stream.end();
      else if (event === "close") stream.destroy();
      await setImmediate();
      assert.equal(controller.signal.aborted, true);
      stream.emit("end");
      stream.emit("close");
      assert.equal(cancellations, 1);
      stop();
      for (const name of ["data", "end", "close"]) assert.equal(stream.listenerCount(name), 0);
      assert.equal(stream.isPaused(), true);
    } finally { stop(); stream.destroy(); }
  }
});

test("operator cancellation reaches B3 HTTP without losing the service's own signal", async () => {
  const operator = new AbortController();
  const service = new AbortController();
  let observedSignal: AbortSignal | null = null;
  const client = createHindsightClient({ endpoint: "http://127.0.0.1:1", resolveApiKey: () => "unit-test-only",
    transport: async (_url, init) => {
      observedSignal = init?.signal ?? null;
      assert(observedSignal);
      return new Promise((_resolve, reject) => {
        observedSignal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
      });
    } });
  const result = withRunCancellation(client, operator.signal).health({ timeoutMs: 120_000, signal: service.signal });
  operator.abort();
  await assert.rejects(result, (error: unknown) => error instanceof HindsightError && error.code === "HINDSIGHT_CANCELLED");
  assert.equal(service.signal.aborted, false);
  assert(observedSignal);
  assert.equal((observedSignal as AbortSignal).aborted, true);
});

const busyPhases = ["validating", "validating-templates", "initializing-banks", "applying-templates", "waiting-template-operations"] as const;
for (const phase of busyPhases) {
  test(`stopped-runner recovery records ${phase} as failed and preserves Bank operation identities`, () => {
    const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS });
    try {
      const bankRepo = createHindsightBankSetupRepo(db);
      bankRepo.upsert({ scope: "global", canonicalIdentity: "global", externalBankId: "unit-test-bank",
        templateRevision: "taki-bank-v1", templateDigest: "a".repeat(64), status: "applied",
        operationIds: ["unit-test-operation"], lastVerifiedAt: null, lastError: null });
      const repo = createHindsightConnectionRepo(db);
      const before = repo.read(bankRepo.list());
      const active = repo.save({ ...before, revision: before.revision + 1, phase, attemptId: "unit-test-attempt" }, before.revision);
      const bankRows = db.prepare("SELECT * FROM hindsight_bank_setup").all();
      const reports: Array<{ code: string; value: Record<string, unknown> }> = [];
      let consumed: number | null = null;
      recoverInterruptedSetup({ db, requireStoppedOwner: () => 12345, consumeStoppedOwner: (pid) => { consumed = pid; },
        report: (code, value) => reports.push({ code, value }) });
      const after = repo.read(bankRepo.list());
      assert.equal(after.phase, "failed");
      assert.equal(after.revision, active.revision + 1);
      assert.equal(after.latestError?.code, "HINDSIGHT_CANCELLED");
      assert.equal(after.attemptId, active.attemptId);
      assert.deepEqual(after.compatibility, active.compatibility);
      assert.deepEqual(after.banks, active.banks);
      assert.equal(after.lastSuccessfulPhase, active.lastSuccessfulPhase);
      assert.deepEqual(db.prepare("SELECT * FROM hindsight_bank_setup").all(), bankRows);
      assert.equal(reports[0]?.value.priorPhase, phase);
      assert.equal(reports[0]?.value.priorRevision, active.revision);
      assert.equal(consumed, 12345);
    } finally { db.close(); }
  });
}

test("a busy B3 attempt without stopped-owner proof is left unchanged", () => {
  const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS });
  try {
    const repo = createHindsightConnectionRepo(db);
    const initial = repo.read();
    const before = repo.save({ ...initial, phase: "validating", revision: initial.revision + 1 }, initial.revision);
    assert.throws(() => recoverInterruptedSetup({ db,
      requireStoppedOwner: () => { throw new Error("REAL_DATA_B3_INTERRUPTED_OWNER_UNPROVEN"); },
      consumeStoppedOwner: () => assert.fail("refused recovery must preserve owner evidence"),
      report: () => assert.fail("refused recovery must not report success") }), /REAL_DATA_B3_INTERRUPTED_OWNER_UNPROVEN/);
    assert.deepEqual(repo.read(), before);
  } finally { db.close(); }
});

test("B3 recovery uses the captured revision CAS and cannot overwrite a concurrent state change", () => {
  const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS });
  try {
    const repo = createHindsightConnectionRepo(db);
    const initial = repo.read();
    const busy = repo.save({ ...initial, phase: "validating", revision: initial.revision + 1 }, initial.revision);
    assert.throws(() => recoverInterruptedSetup({ db, requireStoppedOwner: () => {
      repo.save({ ...busy, phase: "failed", revision: busy.revision + 1 }, busy.revision);
      return 12345;
    }, consumeStoppedOwner: () => assert.fail("lost CAS must preserve owner evidence"),
    report: () => assert.fail("lost CAS must not report recovery") }), /HINDSIGHT_STATE_CONFLICT/);
    assert.equal(repo.read().revision, busy.revision + 1);
    assert.equal(repo.read().latestError, null);
  } finally { db.close(); }
});

test("idle B3 state does not use recovery or change its revision", () => {
  const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS });
  try {
    const repo = createHindsightConnectionRepo(db);
    const before = repo.read();
    recoverInterruptedSetup({ db, requireStoppedOwner: () => assert.fail("idle state needs no recovery"),
      consumeStoppedOwner: () => assert.fail("idle state needs no recovery"),
      report: () => assert.fail("idle state needs no recovery") });
    assert.deepEqual(repo.read(), before);
  } finally { db.close(); }
});

test("interrupted busy owner survives preflight and is consumed only after run recovery commits", () => {
  const directory = mkdtempSync(join(tmpdir(), "taki-d78-owner-test-"));
  const lockPath = join(directory, "runner.lock");
  const proofPath = join(directory, "pending-owner.json");
  const stopped = spawnSync(process.execPath, ["-e", "process.exit(0)"], { windowsHide: true });
  assert.equal(stopped.status, 0);
  const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS });
  try {
    const repo = createHindsightConnectionRepo(db);
    const initial = repo.read();
    const busy = repo.save({ ...initial, phase: "applying-templates", attemptId: "interrupted-attempt",
      revision: initial.revision + 1 }, initial.revision);
    writeFileSync(lockPath, JSON.stringify({ runDirectoryId: OWNED_RUN_ID, processId: stopped.pid }), "utf8");
    assert.equal(preserveInterruptedRunnerOwner({ lockPath, proofPath }), stopped.pid);
    assert.equal(existsSync(lockPath), false);
    assert.equal(existsSync(proofPath), true);
    // A standalone preflight owns and then releases a new lock without entering B3 recovery.
    writeFileSync(lockPath, JSON.stringify({ runDirectoryId: OWNED_RUN_ID, processId: process.pid }), "utf8");
    unlinkSync(lockPath);
    assert.deepEqual(repo.read(), busy);
    const recoveredOwner = preserveInterruptedRunnerOwner({ lockPath, proofPath });
    assert.equal(recoveredOwner, stopped.pid);
    recoverInterruptedSetup({ db, requireStoppedOwner: () => {
      assert.equal(existsSync(proofPath), true);
      assert.equal(typeof recoveredOwner, "number");
      return recoveredOwner as number;
    }, consumeStoppedOwner: (pid) => consumeInterruptedRunnerOwner(proofPath, pid), report: () => undefined });
    assert.equal(repo.read().phase, "failed");
    assert.equal(repo.read().attemptId, busy.attemptId);
    assert.equal(existsSync(proofPath), false);
  } finally {
    db.close();
    for (const path of [lockPath, proofPath]) if (existsSync(path)) unlinkSync(path);
    rmdirSync(directory);
  }
});
