/** W8 final main.ts boot, current operator routes and synthetic committed recovery. All data stays in a new task-owned directory. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { cpSync, mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { once } from "node:events";
import { createConnection, createServer as createTcpServer } from "node:net";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
const coreModule = (name) => import(pathToFileURL(join(root, "packages/core/src", name)).href);

if (process.argv[2] === "child") {
  await coreModule("main.ts");
  process.on("message", (message) => {
    if (message === "shutdown") process.emit("SIGINT");
  });
  process.send({ ready: true });
} else {
  await smoke();
}

async function seedLocal(dataDir) {
  const [{ openDatabase }, { MIGRATIONS }, { createLegacyMigrationRunner }, { createMemoryAuthorityFence }] =
    await Promise.all([coreModule("db/sqlite.ts"), coreModule("db/migrations/index-list.ts"),
      coreModule("memory/legacy-migration/legacy-migration-runner.ts"),
      coreModule("memory/legacy-migration/memory-authority-fence.ts")]);
  const workspace = join(dataDir, "workspace");
  const entryDir = join(workspace, "memory/global/profile");
  mkdirSync(entryDir, { recursive: true });
  writeFileSync(join(entryDir, "entry.md"), "---\nid: independent-smoke\nlayer: profile\nimportance: 8\ncreated: 2026-10-03T00:00:00.000Z\nstatus: active\n---\nTask-owned deterministic smoke memory.\n", "utf8");
  const db = openDatabase({ path: join(dataDir, "taki.db"), migrations: MIGRATIONS });
  try {
    const runner = createLegacyMigrationRunner({ db, destinationRoot: join(workspace, "memory-migration"),
      fence: createMemoryAuthorityFence() });
    const previewId = runner.dryRun(workspace).reportId;
    const prepared = await runner.prepare({ runId: "independent-smoke", workspaceRoot: workspace,
      previewId, owner: "w8-independent-reviewer" });
    assert.equal(prepared.status, "ready");
    const result = await runner.activate({ runId: "independent-smoke", workspaceRoot: workspace,
      timeoutMs: 5_000, transactionId: "independent-smoke-activation", owner: "w8-independent-reviewer" });
    assert.equal(result.activated, true);
  } finally { db.close(); }
}

async function freePort() {
  const server = createTcpServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function runCore(mode, dataDir, endpoint, expected = {}) {
  const port = await freePort();
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
    ["PATH", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "COMSPEC", "PATHEXT", "USERPROFILE"].includes(key.toUpperCase())));
  Object.assign(env, { TAKI_DATA_DIR: dataDir, TAKI_WS_HOST: "127.0.0.1", TAKI_WS_PORT: String(port),
    TAKI_PROVIDER_BASE_URL: endpoint, TAKI_PROVIDER_API_KEY: "task-owned-fake-key",
    TAKI_PROVIDER_MODEL: "task-owned-no-call-model", TAKI_LOG_LEVEL: "info", TAKI_HINDSIGHT_ENABLED: "false" });
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), "child"], {
    cwd: root, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  const ended = new Promise((resolve) => child.once("exit", (code, signal) => resolve({ code, signal })));
  const deadline = setTimeout(() => child.kill(), 45_000);
  try {
    const ready = await Promise.race([once(child, "message").then(([message]) => message),
      ended.then((result) => { throw new Error(`Core exited before ready: ${JSON.stringify(result)}\n${output}`); })]);
    assert.equal(ready.ready, true);
    // A real WebSocket handshake proves the production server is accepting connections after startup.
    const require = createRequire(join(root, "packages/core/package.json"));
    const WebSocket = require("ws");
    const socket = new WebSocket(`ws://127.0.0.1:${port}`);
    await once(socket, "open");
    assert.equal((await rpc(socket, "connect", { deviceId: randomUUID(), deviceName: "W8 transition smoke",
      role: "operator", capabilities: [] })).status, "ok");
    const status = await rpc(socket, "memory.authority.status", {});
    assert.equal(status.authority.mode, mode);
    assert.equal(status.runtime.available, mode !== "hindsight");
    assert.equal(status.runtime.providerId, mode === "canonical-local" ? "local" : mode === "hindsight" ? "hindsight" : "legacy-markdown");
    let overview = await rpc(socket, "memory.transitions.overview", {});
    assert.equal(overview.provider, mode === "legacy-markdown" ? null : mode === "hindsight" ? "hindsight" : "local");
    assert.equal(overview.actions.length, 3);
    await assert.rejects(rpc(socket, "memory.transitions.status", { transitionId: randomUUID() }), /MEMORY_OPERATION_REFUSED/);
    await assert.rejects(rpc(socket, "memory.transitions.preview", { kind: "transition.reenter-hindsight" }), /MEMORY_OPERATION_REFUSED/);
    if (expected.transitionId) {
      const entry = overview.entries.find((item) => item.operation.operationId === expected.operationId);
      assert.equal(entry.operation.state, "outcome_unknown");
      assert.equal(entry.status.transition.receipt.receiptId, expected.receiptId);
      assert.equal(entry.currentAuthority, true);
      assert.equal(entry.status.progress.nativeReleasePending, false);
      assert.equal(overview.actions.find((item) => item.kind === "transition.reenter-hindsight").reason, "foreign-branch");
      if (entry.recovery.allowed) {
        const preview = await rpc(socket, "memory.transitions.preview", { kind: "transition.emergency-local", recoveryTransitionId: expected.transitionId });
        assert.equal(preview.takeover, "eligible");
        const admitted = await rpc(socket, "memory.operations.submit", { request: {
          kind: preview.kind, requestId: randomUUID(), previewId: preview.previewId, previewHash: preview.previewHash,
          expected: preview.expected, recovery: preview.recovery, confirmation: "emergency-takeover",
        } });
        const recoveryId = admitted.operation.operationId;
        for (let index = 0; index < 100; index++) {
          overview = await rpc(socket, "memory.transitions.overview", {});
          if (overview.entries.find((item) => item.operation.operationId === recoveryId)?.operation.state === "completed") break;
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        assert.equal(overview.entries.find((item) => item.operation.operationId === recoveryId).operation.state, "completed");
        expected.recoveryOperationId = recoveryId;
      }
      assert.equal((await rpc(socket, "memory.operations.status", { operationId: expected.operationId })).operation.state, "outcome_unknown");
      assert.equal((await rpc(socket, "memory.transitions.status", { transitionId: expected.transitionId })).transition.receipt.receiptId, expected.receiptId);
    }
    const closed = once(socket, "close");
    socket.close();
    await closed;
    child.send("shutdown");
    const result = await ended;
    assert.equal(result.code, 0, output);
    assert.equal(result.signal, null);
    assert.match(output, /shutting down/);
    assert.doesNotMatch(output, /CORE_SHUTDOWN_FAILED/);
    await assertListenerClosed(port);
    const [{ openDatabase }, { MIGRATIONS }, { readMemoryAuthoritySelection }] = await Promise.all([
      coreModule("db/sqlite.ts"), coreModule("db/migrations/index-list.ts"),
      coreModule("memory/legacy-migration/legacy-activation-repo.ts"),
    ]);
    const db = openDatabase({ path: join(dataDir, "taki.db"), migrations: MIGRATIONS });
    try {
      assert.equal(readMemoryAuthoritySelection(db).mode, mode);
      assert.equal(Number(db.prepare("SELECT max(version) AS n FROM migrations").get().n), 57);
      assert.equal(db.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
    } finally { db.close(); }
    return { mode, exitCode: result.code, websocket: "opened-and-closed", gracefulSignal: "SIGINT",
      runtime: status.runtime, overviewProvider: overview.provider, expected, pid: child.pid, port, listenerClosed: true, reopenedDatabase: "integrity-ok", dataDir };
  } finally {
    clearTimeout(deadline);
    if (child.exitCode === null && child.signalCode === null) child.kill();
    writeFileSync(join(dataDir, "core-boot.log"), output, "utf8");
  }
}

async function rpc(socket, method, params) {
  const id = randomUUID();
  const reply = new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.off("message", receive); reject(new Error(`RPC timed out: ${method}`)); }, 5_000);
    const receive = (bytes) => {
      const response = JSON.parse(String(bytes));
      if (response.id !== id) return;
      clearTimeout(timer);
      socket.off("message", receive);
      if (response.error) reject(new Error(`RPC refused: ${method} ${JSON.stringify(response.error)}`));
      else resolve(response.result);
    };
    socket.on("message", receive);
  });
  socket.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
  return reply;
}

async function smoke() {
  const ownedRoot = join(root, ".trellis/.runtime/w8-boot", randomUUID());
  mkdirSync(ownedRoot, { recursive: true });
  let modelRequests = 0;
  const trap = createServer((_request, response) => { modelRequests++; response.writeHead(503); response.end(); });
  trap.listen(0, "127.0.0.1");
  await once(trap, "listening");
  const endpoint = `http://127.0.0.1:${trap.address().port}/v1`;
  const results = [];
  try {
    for (const mode of ["legacy-markdown", "canonical-local"]) {
      const dataDir = join(ownedRoot, mode);
      mkdirSync(dataDir);
      if (mode === "canonical-local") await seedLocal(dataDir);
      results.push(await runCore(mode, dataDir, endpoint));
      results.push(await runCore(mode, dataDir, endpoint));
    }
    const transitionDirs = { hindsight: join(ownedRoot, "hindsight-unavailable"), emergency: join(ownedRoot, "emergency-local") };
    const expected = await seedTransitions(transitionDirs);
    results.push(await runCore("hindsight", transitionDirs.hindsight, endpoint));
    results.push(await runCore("canonical-local", transitionDirs.emergency, endpoint, expected));
    results.push(await runCore("canonical-local", transitionDirs.emergency, endpoint, expected));
    assert.ok(expected.recoveryOperationId);
    assert.equal(modelRequests, 0);
    const report = { node: process.version, loader: "native-type-stripping", modelRequests,
      localData: "owned synthetic B2/healthy/emergency producers; deterministic Native fixture, no real corpus", results };
    writeFileSync(join(ownedRoot, "result.json"), JSON.stringify(report, null, 2) + "\n", "utf8");
    console.log(JSON.stringify(report, null, 2));
  } finally { await new Promise((resolve) => trap.close(resolve)); }
}

async function assertListenerClosed(port) {
  await new Promise((resolve, reject) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    socket.once("connect", () => { socket.destroy(); reject(new Error("owned listener remained open")); });
    socket.once("error", (error) => error.code === "ECONNREFUSED" ? resolve() : reject(error));
  });
}

async function seedTransitions(dirs) {
  const OriginalDate = Date;
  const fixed = OriginalDate.parse("2026-10-01T00:00:00.000Z");
  // Fixture identity timestamps are fixed, but all transport and shutdown timers remain real.
  globalThis.Date = class extends OriginalDate {
    constructor(...args) { super(...(args.length ? args : [fixed])); }
    static now() { return fixed; }
  };
  let h; let e;
  try {
    const { createHealthyTransitionHarness } = await coreModule("testing/memory-transition-healthy-fixtures.ts");
    const { composeEmergencyFixture } = await coreModule("testing/memory-transition-emergency-service-fixtures.ts");
    h = await createHealthyTransitionHarness({ aliases: true });
    // The unit harness normally supplies B3's complete projection through its fake setup reader. Main.ts reads
    // the persisted row, so materialize that same synthetic manifest via the real compatibility projector.
    const { projectHindsightCompatibilityManifest } = await coreModule("memory/hindsight/hindsight-compatibility-service.ts");
    h.db.prepare("UPDATE hindsight_connection_state SET compatibility_json=:value WHERE singleton=1")
      .run({ value: JSON.stringify(projectHindsightCompatibilityManifest(h.remote.manifest)) });
    for (const kind of ["transition.return-local", "transition.reenter-hindsight"]) {
      const operation = h.owner.submit(await h.request(undefined, kind)); await h.owner.stop();
      assert.equal(h.owner.status(operation.operationId).state, "completed");
    }
    mkdirSync(dirs.hindsight); mkdirSync(dirs.emergency);
    await h.db.backupTo(join(dirs.hindsight, "taki.db"));
    e = composeEmergencyFixture(h);
    const callsBefore = { ...h.remote.calls };
    h.runtime.transitions.bind = async () => { throw new Error("owned committed bind interruption"); };
    const operation = e.emergencyOwner.submit(await e.emergencyRequest()); await e.emergencyOwner.stop();
    assert.equal(e.emergencyOwner.status(operation.operationId).state, "outcome_unknown");
    const entry = e.emergency.overview().entries[0];
    assert.ok(entry.status.transition.receipt);
    assert.deepEqual(h.remote.calls, callsBefore);
    await e.stopEmergency(); await h.stop();
    await h.db.backupTo(join(dirs.emergency, "taki.db"));
    cpSync(join(h.dataDir, "backups"), join(dirs.emergency, "backups"), { recursive: true, errorOnExist: true, force: false });
    return { transitionId: entry.status.transition.intent.transitionId, operationId: operation.operationId,
      receiptId: entry.status.transition.receipt.receiptId };
  } finally {
    if (e) await e.stopEmergency();
    if (h) await h.close();
    globalThis.Date = OriginalDate;
  }
}
