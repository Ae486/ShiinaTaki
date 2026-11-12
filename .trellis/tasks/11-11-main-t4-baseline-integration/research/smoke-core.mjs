import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer as createHttpServer } from "node:http";
import { createServer } from "node:net";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { ChatCompleteSchema, ChatDeltaSchema, ChatSendResultSchema } from "../../../../packages/shared/src/chat-schema.ts";

const repo = fileURLToPath(new URL("../../../../", import.meta.url));
const WebSocket = createRequire(new URL("../../../../packages/core/package.json", import.meta.url))("ws");
const startedAt = new Date().toISOString();
const resultUrl = new URL(`./smoke-core-result-${startedAt.replace(/[:.]/g, "-")}-${process.pid}.json`, import.meta.url);
const artifactRoot = mkdtempSync("G:/taki-integration-boot-");
const profileDir = join(artifactRoot, "os-profile");
const tempDir = join(artifactRoot, "temp");
const localAppData = join(profileDir, "AppData", "Local");
const appData = join(profileDir, "AppData", "Roaming");
for (const path of [profileDir, tempDir, localAppData, appData]) mkdirSync(path, { recursive: true });
const systemKeys = ["PATH", "SystemRoot", "WINDIR", "COMSPEC", "PATHEXT"];
const systemEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => systemKeys.some((allowed) => allowed.toLowerCase() === key.toLowerCase())));
const controlledReply = "Integration live configuration recovered without a Core restart.";

function persistedEvidence(dataDir) {
  // A live WAL-aware reader must not use the immutable-backup helper or run migrations.
  const db = new DatabaseSync(join(dataDir, "taki.db"), { readOnly: true });
  try {
    return {
      runs: db.prepare("SELECT count(*) AS n FROM runs").get().n,
      completedRuns: db.prepare("SELECT count(*) AS n FROM runs WHERE state = 'completed' AND outcome = 'completed'").get().n,
      migrationHead: db.prepare("SELECT max(version) AS n FROM migrations").get().n,
      runRecords: db.prepare("SELECT run_id, initiator, state, outcome, terminal_at FROM runs ORDER BY queued_at, run_id").all(),
      attempts: db.prepare("SELECT run_id, model_id, state, outcome FROM run_attempts ORDER BY run_id, ordinal").all(),
      assistantReplies: db.prepare("SELECT content FROM timeline_messages WHERE role = 'assistant' ORDER BY seq").all().map((row) => ({ ...row })),
    };
  } finally { db.close(); }
}

async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function probe(name, overrides, options = {}) {
  const dataDir = options.dataDir ?? join(artifactRoot, name); mkdirSync(dataDir, { recursive: true });
  const port = await freePort();
  const start = performance.now();
  const child = spawn(process.execPath, [join(repo, "packages/core/src/main.ts")], {
    cwd: repo, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
    env: { ...systemEnv, USERPROFILE: profileDir, LOCALAPPDATA: localAppData, APPDATA: appData,
      TEMP: tempDir, TMP: tempDir, TAKI_DATA_DIR: dataDir, TAKI_WS_HOST: "127.0.0.1", TAKI_WS_PORT: String(port),
      TAKI_TRUST_LOOPBACK_OPERATOR: "true", TAKI_LOG_LEVEL: "info", ...overrides },
  });
  const exited = new Promise((resolve) => child.once("exit", (code, signal) => resolve({ code, signal })));
  let output = ""; let socket;
  const result = { name, dataDir, port, corePid: child.pid };
  const callsBeforeBoot = providerCalls.length;
  const notifications = [];
  const pending = new Map(); let requestId = 0;
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Core readiness deadline")), 30_000);
      const consume = (chunk) => {
        output += chunk.toString();
        if (output.includes("ws server listening")) { clearTimeout(timer); resolve(); }
      };
      child.stdout.on("data", consume); child.stderr.on("data", consume);
      child.once("error", (error) => { clearTimeout(timer); reject(error); });
      child.once("exit", () => { clearTimeout(timer); reject(new Error("Core exited before listening")); });
    });
    const listeningMs = Math.round(performance.now() - start);
    socket = new WebSocket(`ws://127.0.0.1:${port}`);
    socket.on("message", (bytes) => {
      const frame = JSON.parse(bytes.toString());
      if (frame.method) notifications.push(frame);
      pending.get(frame.id)?.(frame);
    });
    await new Promise((resolve, reject) => { socket.once("open", resolve); socket.once("error", reject); });
    const rpc = (method, params) => new Promise((resolve, reject) => {
      const id = ++requestId;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} deadline`)); }, 10_000);
      pending.set(id, (frame) => { clearTimeout(timer); pending.delete(id); resolve(frame); });
      socket.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
    });
    const connected = await rpc("connect", { deviceId: randomUUID(), deviceName: "isolated-baseline-probe", role: "operator", capabilities: [] });
    assert.equal(connected.error, undefined, "isolated operator authentication");
    result.listeningMs = listeningMs;
    result.beforeAdmission = persistedEvidence(dataDir);
    assert.equal(providerCalls.length, callsBeforeBoot, "startup never invokes the controlled provider");
    const config = await rpc("config.list", {});
    assert.equal(config.error, undefined, "configuration basic plane stays available");
    const history = await rpc("timeline.history", { characterId: "taki", limit: 10 });
    assert.equal(history.error, undefined, "history basic plane stays available");
    result.basicPlaneAvailable = true;
    if (options.reopenedProfile) {
      const profiles = await rpc("config.modelProfiles", {});
      const main = profiles.result.profiles.find((profile) => profile.slot === "main");
      assert.equal(main.active.model, "integration-controlled-model");
      assert.equal(main.active.source, "application");
      assert.equal(main.applicationState, "failed");
      assert.equal(result.beforeAdmission.runs, 1);
      assert.equal(result.beforeAdmission.completedRuns, 1);
      assert.equal(result.beforeAdmission.runRecords[0].run_id, options.runId);
      assert.deepEqual(result.beforeAdmission.assistantReplies, [{ content: controlledReply }]);
      return Object.assign(result, { reopenedLastGood: true, modelConfigured: true, reopenedCompletedRun: true });
    }
    assert.equal(result.beforeAdmission.runs, 0, "fresh no-model startup has zero Runs before refusal");
    const refused = await rpc("chat.send", { characterId: "taki", message: "isolated readiness probe" });
    assert.equal(refused.error?.data?.code, "CONFIG_REFUSED");
    assert.equal(refused.error?.data?.reason, "MODEL_UNAVAILABLE");
    result.afterRefusal = persistedEvidence(dataDir);
    assert.equal(result.afterRefusal.runs, 0, "no-model refusal occurs before Run admission");
    assert.equal(providerCalls.length, callsBeforeBoot, "refusal invokes no provider");
    Object.assign(result, { refusal: "CONFIG_REFUSED", reason: "MODEL_UNAVAILABLE", modelConfigured: false });
    if (options.recover) {
      const profiles = await rpc("config.modelProfiles", {});
      const main = profiles.result.profiles.find((profile) => profile.slot === "main");
      const form = { mode: "configured", baseUrl: options.recover.baseUrl, model: "integration-controlled-model", auth: "none" };
      const applied = await rpc("config.modelProfileSave", { slot: "main", expectedRevision: main.revision, action: "apply", profile: form });
      assert.equal(applied.error, undefined);
      const active = applied.result.profiles.find((profile) => profile.slot === "main");
      assert.equal(active.state, "ready"); assert.equal(active.active.model, form.model);
      assert.equal(active.active.source, "application");
      assert.equal(providerCalls.length, callsBeforeBoot, "apply does not automatically test the provider");
      const tested = await rpc("config.modelProfileTest", { slot: "main", expectedRevision: active.revision });
      assert.deepEqual(tested.result, { ok: true, code: "MODEL_TEST_OK", message: "连接测试成功。" });
      assert.equal(providerCalls.length, callsBeforeBoot + 1, "one explicit model connection test");
      result.beforeRecoveredChat = persistedEvidence(dataDir);
      assert.equal(result.beforeRecoveredChat.runs, 0, "model connection test does not admit a Run");

      const chatStarted = performance.now();
      const sent = await rpc("chat.send", { characterId: "taki", message: "Reply to this isolated live-configuration recovery probe." });
      assert.equal(sent.error, undefined, "next real chat is admitted after live configuration");
      const { messageId, runId } = ChatSendResultSchema.parse(sent.result);
      const end = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => { socket.off("message", finish); reject(new Error("recovered chat deadline")); }, 20_000);
        function finish() {
          const note = notifications.find((frame) => ["chat.complete", "chat.error"].includes(frame.method)
            && frame.params?.messageId === messageId);
          if (note) { clearTimeout(timer); socket.off("message", finish); resolve(note); }
        }
        socket.on("message", finish);
        finish();
      });
      assert.equal(end.method, "chat.complete", "real chat completes without a provider error");
      ChatCompleteSchema.parse(end.params);
      const reply = notifications.filter((frame) => frame.method === "chat.delta")
        .map((frame) => ChatDeltaSchema.parse(frame.params)).filter((delta) => delta.messageId === messageId)
        .map((delta) => delta.delta).join("");
      assert.equal(reply, controlledReply);
      assert.equal(child.exitCode, null, "the original Core remains alive after the real chat");
      assert.equal(child.pid, result.corePid);
      assert.equal(socket.readyState, WebSocket.OPEN, "the original operator connection remains open");
      result.afterRecoveredChat = persistedEvidence(dataDir);
      assert.equal(result.afterRecoveredChat.runs, 1);
      assert.equal(result.afterRecoveredChat.completedRuns, 1);
      assert.equal(result.afterRecoveredChat.runRecords[0].run_id, runId);
      assert.equal(result.afterRecoveredChat.runRecords[0].initiator, "primary");
      assert.ok(result.afterRecoveredChat.runRecords[0].terminal_at);
      assert.equal(result.afterRecoveredChat.attempts[0].model_id, form.model);
      assert.equal(result.afterRecoveredChat.attempts[0].outcome, "completed");
      assert.deepEqual(result.afterRecoveredChat.assistantReplies, [{ content: controlledReply }]);
      assert.equal(providerCalls.length, callsBeforeBoot + 2, "one model test plus one real streamed chat");
      result.chat = { runId, messageId, reply, completedMs: Math.round(performance.now() - chatStarted),
        sameCorePid: child.pid, sameOperatorConnection: true };
      const invalid = await rpc("config.modelProfileSave", { slot: "main", expectedRevision: active.revision,
        action: "apply", profile: { ...form, model: "" } });
      assert.equal(invalid.error, undefined);
      const retained = invalid.result.profiles.find((profile) => profile.slot === "main");
      assert.equal(retained.applicationState, "failed");
      assert.equal(retained.active.model, form.model);
      assert.equal(providerCalls.length, callsBeforeBoot + 2, "invalid apply invokes no provider");
      Object.assign(result, { modelConfigured: true, applyRecovered: true, controlledProviderTest: true, failedApplyRetainsLastGood: true });
    }
    return result;
  } catch (error) {
    error.message += `\n${output.slice(-6000)}`; throw error;
  } finally {
    socket?.close(); child.kill("SIGTERM"); result.processExit = await exited;
    result.providerCalls = providerCalls.length - callsBeforeBoot;
    result.durationMs = Math.round(performance.now() - start);
    writeFileSync(join(dataDir, "boot.log"), output);
  }
}

const results = [];
const providerCalls = [];
const provider = createHttpServer((request, response) => {
  const chunks = [];
  request.on("data", (chunk) => chunks.push(chunk));
  request.on("end", () => {
    const input = JSON.parse(Buffer.concat(chunks).toString());
    providerCalls.push({ path: request.url, model: input.model, stream: input.stream === true,
      authorizationPresent: request.headers.authorization !== undefined });
    // Same OpenAI-compatible stream frames as e2e/src/fixture/scripted-provider.ts.
    if (input.stream === true) {
      response.writeHead(200, { "content-type": "text/event-stream" });
      const id = randomUUID();
      for (const [delta, finishReason] of [[{ role: "assistant", content: controlledReply }, null], [{}, "stop"]]) {
        response.write(`data: ${JSON.stringify({ id, object: "chat.completion.chunk",
          choices: [{ index: 0, delta, finish_reason: finishReason }] })}\n\n`);
      }
      response.write(`data: ${JSON.stringify({ id, object: "chat.completion.chunk", choices: [],
        usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 } })}\n\n`);
      response.end("data: [DONE]\n\n");
      return;
    }
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ id: "isolated-completion", object: "chat.completion", created: 0, model: input.model,
      choices: [{ index: 0, message: { role: "assistant", content: "OK" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 } }));
  });
});
await new Promise((resolve) => provider.listen(0, "127.0.0.1", resolve));
const recovery = { baseUrl: `http://127.0.0.1:${provider.address().port}/v1` };
let failure;
try {
for (const [name, overrides] of [["no-model", {}], ["invalid-optional-memory", {
  TAKI_MEMORY_STOPLIST: "invalid", TAKI_MEMORY_TIDY_MAX_STEPS: "bad",
}]]) {
  const result = await probe(name, overrides, name === "no-model" ? { recover: recovery } : {});
  result.afterProcessExit = persistedEvidence(result.dataDir);
  assert.equal(result.afterProcessExit.runs, name === "no-model" ? 1 : 0);
  assert.equal(result.afterProcessExit.completedRuns, name === "no-model" ? 1 : 0);
  assert.equal(result.afterProcessExit.migrationHead, 77);
  results.push(result);
}
results.push(await probe("reopen-last-good", {}, { dataDir: results[0].dataDir, reopenedProfile: true, runId: results[0].chat.runId }));
assert.deepEqual(providerCalls.map((call) => call.stream), [false, true], "only explicit test and next real chat invoke the provider");
assert.ok(providerCalls.every((call) => call.path === "/v1/chat/completions"
  && call.model === "integration-controlled-model" && call.authorizationPresent === false));
} catch (error) { failure = error; }
finally { provider.closeAllConnections(); await new Promise((resolve) => provider.close(resolve)); }
const receipt = { startedAt, finishedAt: new Date().toISOString(), passed: failure === undefined,
  resultPath: fileURLToPath(resultUrl), artifactRoot, profileDir, tempDir, node: process.version, repo,
  environment: "allowlisted OS executable variables plus fresh G: USERPROFILE/APPDATA/LOCALAPPDATA/TEMP/TMP and isolated test settings; no env file/real provider/key helper",
  stop: "Windows force termination via child.kill(SIGTERM) after socket close; not graceful shutdown evidence",
  ...(failure ? { failure: failure.message } : {}), providerCalls, results };
writeFileSync(resultUrl, JSON.stringify(receipt, null, 2), { flag: "wx" });
console.log(JSON.stringify(receipt, null, 2));
if (failure) process.exitCode = 1;
