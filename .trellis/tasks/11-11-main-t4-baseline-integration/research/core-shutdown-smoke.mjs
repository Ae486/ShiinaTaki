/** Actual Core shutdown over the journey IPC harness; fresh G data/profile, loopback provider, no Native/PG. */
import assert from "node:assert/strict";
import { once } from "node:events";
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { createServer as createTcpServer } from "node:net";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { bootCore, openOperator, runCoreChild, stopCore } from "../../08-09-memory-operations-ui/research/first-use-runtime/smoke-core.mjs";

function isolateProfile(profile) {
  for (const part of ["", "AppData/Local", "AppData/Roaming", "Temp"]) mkdirSync(join(profile, part), { recursive: true });
  Object.assign(process.env, { USERPROFILE: profile, LOCALAPPDATA: join(profile, "AppData/Local"),
    APPDATA: join(profile, "AppData/Roaming"), TEMP: join(profile, "Temp"), TMP: join(profile, "Temp") });
}

if (process.argv.includes("--core-child")) {
  // bootCore intentionally whitelists its environment; set the owned profile before importing production Core.
  isolateProfile(join(process.cwd(), "os-profile"));
  process.on("message", (message) => {
    if (message === "shutdown-observation") process.send?.({ kind: "shutdown-observation",
      exitCode: process.exitCode ?? null, ipcConnected: process.connected,
      resources: process.getActiveResourcesInfo(), profile: process.env.USERPROFILE });
  });
  await runCoreChild();
} else {
  await main();
}

async function freePort() {
  const server = createTcpServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = server.address().port;
  await new Promise((done) => server.close(done));
  return port;
}

async function main() {
  const expectedForced = process.argv.includes("--expect-forced");
  const phase = expectedForced ? "before" : "after";
  const root = mkdtempSync("G:/taki-codex-work/integration-core-shutdown-");
  const dataDir = join(root, "core-data");
  const credentialsDir = join(root, "credentials");
  mkdirSync(dataDir); mkdirSync(credentialsDir);
  isolateProfile(join(dataDir, "os-profile"));
  writeFileSync(join(credentialsDir, "taki-secret-catalog-master-key"), randomBytes(32));
  const helper = fileURLToPath(new URL("../../08-09-memory-operations-ui/research/first-use-runtime/smoke-core.mjs", import.meta.url));
  const production = fileURLToPath(new URL("../../../../packages/core/src/main.ts", import.meta.url));
  const hash = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
  const started = Date.now();
  const receipt = { phase, root, node: process.version, helperSha256: hash(helper), productionSha256: hash(production),
    shutdownBudgetMs: 60_000, resourcesAfterProductionClose: [], providerRequests: 0, status: "running" };
  const provider = createServer((request, response) => {
    receipt.providerRequests += 1;
    request.resume(); response.writeHead(400).end("isolated unused provider");
  });
  let core;
  let operator;
  let observationTimer;
  try {
    provider.listen(0, "127.0.0.1");
    await once(provider, "listening");
    const port = await freePort();
    core = await bootCore({ script: fileURLToPath(import.meta.url), dataDir, credentialsDir, port,
      providerPort: provider.address().port, nativePort: await freePort(), logFile: join(root, "core.log") });
    receipt.corePid = core.pid; receipt.corePort = port;
    operator = await openOperator(port, "isolated IPC shutdown regression");
    receipt.authenticatedPeerOpenAtShutdown = operator.socket.readyState === WebSocket.OPEN;
    core.child.on("message", (message) => {
      if (message?.kind === "shutdown-observation") {
        receipt.resourcesAfterProductionClose.push(message);
        console.log(JSON.stringify({ phase, observation: message }));
      }
    });
    observationTimer = setInterval(() => {
      if (!core.child.connected || !core.log().includes('"msg":"mcp manager closed"')) return;
      clearInterval(observationTimer);
      core.child.send("shutdown-observation");
    }, 500);
    observationTimer.unref();
    const stoppingAt = Date.now();
    const exit = await stopCore(core);
    receipt.shutdownMs = Date.now() - stoppingAt; receipt.exit = exit;
    receipt.operatorClosed = operator.socket.readyState === WebSocket.CLOSED;
    receipt.shutdownHandlerCalls = core.log().split('"msg":"shutting down"').length - 1;
    receipt.mcpClosed = core.log().includes('"msg":"mcp manager closed"');
    receipt.shutdownFailure = /CORE_SHUTDOWN_FAILED|Assertion failed:|database is not open/.test(core.log());
    assert.equal(receipt.authenticatedPeerOpenAtShutdown, true);
    assert.equal(receipt.operatorClosed, true);
    assert.equal(receipt.shutdownHandlerCalls, 1); assert.equal(receipt.mcpClosed, true);
    assert.equal(receipt.shutdownFailure, false); assert.deepEqual(exit.egress?.refused, []);
    assert.equal(receipt.providerRequests, 0);
    if (expectedForced) {
      assert.equal(exit.forced, true, "baseline must expose the original IPC pin");
      assert.notEqual(exit.code, 0);
      const observation = receipt.resourcesAfterProductionClose.at(-1);
      assert.equal(observation?.exitCode, 0, "production teardown did not reach its successful natural exit");
      assert.equal(observation.ipcConnected, true);
      assert.ok(observation.resources.length > 0 && observation.resources.every((resource) => resource === "PipeWrap"),
        "baseline still owns a non-pipe resource");
    } else {
      assert.equal(exit.code, 0); assert.equal(exit.signal, null); assert.equal(exit.forced, false);
    }
    receipt.status = "passed";
  } catch (error) {
    receipt.status = "failed"; receipt.error = error.message; throw error;
  } finally {
    clearInterval(observationTimer);
    operator?.close();
    if (core && core.child.exitCode === null && core.child.signalCode === null) {
      const closed = once(core.child, "close"); core.child.kill(); await closed;
    }
    provider.closeAllConnections();
    await new Promise((done) => provider.close(done));
    receipt.coreExited = !core || core.child.exitCode !== null || core.child.signalCode !== null;
    receipt.providerClosed = !provider.listening;
    receipt.productionUnchanged = hash(production) === receipt.productionSha256;
    receipt.helperUnchanged = hash(helper) === receipt.helperSha256;
    receipt.durationMs = Date.now() - started;
    const output = fileURLToPath(new URL(`./core-shutdown-${phase}-${new Date().toISOString().replaceAll(":", "-")}.json`, import.meta.url));
    writeFileSync(output, JSON.stringify(receipt, null, 2) + "\n");
    console.log(JSON.stringify({ receipt: output, ...receipt }, null, 2));
  }
}
