/** W5 strip-only Core and authenticated transition RPC smoke. All data stays in a new task-owned directory. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { once } from "node:events";
import { createServer as createTcpServer } from "node:net";

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
      previewId, owner: "w5-implementer" });
    assert.equal(prepared.status, "ready");
    const result = await runner.activate({ runId: "independent-smoke", workspaceRoot: workspace,
      timeoutMs: 5_000, transactionId: "independent-smoke-activation", owner: "w5-implementer" });
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

async function runCore(mode, dataDir, endpoint) {
  const port = await freePort();
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
    ["PATH", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "COMSPEC", "PATHEXT", "USERPROFILE"].includes(key.toUpperCase())));
  Object.assign(env, { TAKI_DATA_DIR: dataDir, TAKI_WS_HOST: "127.0.0.1", TAKI_WS_PORT: String(port),
    TAKI_PROVIDER_BASE_URL: endpoint, TAKI_PROVIDER_API_KEY: "task-owned-fake-key",
    TAKI_PROVIDER_MODEL: "task-owned-no-call-model", TAKI_LOG_LEVEL: "info" });
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
    assert.equal((await rpc(socket, "connect", { deviceId: randomUUID(), deviceName: "W5 transition smoke",
      role: "operator", capabilities: [] })).status, "ok");
    const status = await rpc(socket, "memory.authority.status", {});
    assert.equal(status.authority.mode, mode);
    assert.equal(status.runtime.available, true);
    assert.equal(status.runtime.providerId, mode === "canonical-local" ? "local" : "legacy-markdown");
    await assert.rejects(rpc(socket, "memory.transitions.status", { transitionId: randomUUID() }), /MEMORY_OPERATION_REFUSED/);
    await assert.rejects(rpc(socket, "memory.transitions.preview", { kind: "transition.reenter-hindsight" }), /MEMORY_OPERATION_REFUSED/);
    const closed = once(socket, "close");
    socket.close();
    await closed;
    child.send("shutdown");
    const result = await ended;
    assert.equal(result.code, 0, output);
    assert.equal(result.signal, null);
    assert.match(output, /shutting down/);
    assert.doesNotMatch(output, /CORE_SHUTDOWN_FAILED/);
    const [{ openDatabase }, { MIGRATIONS }, { readMemoryAuthoritySelection }] = await Promise.all([
      coreModule("db/sqlite.ts"), coreModule("db/migrations/index-list.ts"),
      coreModule("memory/legacy-migration/legacy-activation-repo.ts"),
    ]);
    const db = openDatabase({ path: join(dataDir, "taki.db"), migrations: MIGRATIONS });
    try {
      assert.equal(readMemoryAuthoritySelection(db).mode, mode);
      assert.equal(db.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
    } finally { db.close(); }
    return { mode, exitCode: result.code, websocket: "opened-and-closed", gracefulSignal: "SIGINT",
      runtime: status.runtime, reopenedDatabase: "integrity-ok", dataDir };
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
  const ownedRoot = join(root, ".trellis/.runtime/w5-boot", randomUUID());
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
    assert.equal(modelRequests, 0);
    const report = { node: process.version, loader: "native-type-stripping", modelRequests,
      localData: "synthetic Markdown through genuine B2 snapshot, prepare and activation producers", results };
    writeFileSync(join(ownedRoot, "result.json"), JSON.stringify(report, null, 2) + "\n", "utf8");
    console.log(JSON.stringify(report, null, 2));
  } finally { await new Promise((resolve) => trap.close(resolve)); }
}
