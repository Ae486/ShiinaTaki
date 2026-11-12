/** Isolated production-Core control-plane proof; no provider calls or real profiles. */
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createMemoryStore } from "../../../../packages/core/src/memory/store.ts";
import { childEnv, getFreePort, killTree } from "../../../../e2e/src/fixture/procs.ts";
import { captureLines, jsonLine } from "../../../../e2e/src/fixture/line-buffer.ts";
import { openRpcSocket } from "../../../../e2e/src/fixture/rpc-socket.ts";
import { strict as assert } from "node:assert";

const root = process.cwd();
const output = `G:/taki-native-flow-artifacts-20261110/live-settings-${randomUUID()}`;
const data = join(output, "profile");
mkdirSync(data, { recursive: true });
createMemoryStore({ root: join(data, "workspace", "memory") }).write({ layer: "profile", content: "我 喜欢 拉面", importance: 5 });
const control = join(output, "stop.mjs");
writeFileSync(control, "process.on('message',()=>{process.disconnect();process.emit('SIGTERM','SIGTERM')});\n");
const port = await getFreePort();
const nextPort = await getFreePort();
const child = spawn(process.execPath, ["--import", pathToFileURL(control).href, "src/main.ts"], {
  cwd: join(root, "packages/core"), windowsHide: true,
  env: childEnv({ TAKI_DATA_DIR: data, TAKI_WS_HOST: "127.0.0.1", TAKI_WS_PORT: String(port), TAKI_LOG_LEVEL: "info",
    TAKI_TRUST_LOOPBACK_OPERATOR: "true", TAKI_CREDENTIALS_DIRECTORY: join(data, "absent-credentials"), CREDENTIALS_DIRECTORY: "",
    TAKI_PROVIDER_BASE_URL: "http://127.0.0.1:1/v1", TAKI_PROVIDER_MODEL: "local-no-dispatch", TAKI_PROVIDER_API_KEY: "",
    TAKI_MAX_STEPS: "bad", TAKI_UTILITY_CONTEXT_TOKENS: "bad", TAKI_MEMORY_TIDY_MAX_STEPS: "bad",
    TAKI_HINDSIGHT_ENABLED: "false", TAKI_INITIATIVE_ENABLED: "false", NODE_ENV: "production", NODE_OPTIONS: "" }),
  stdio: ["ignore", "pipe", "pipe", "ipc"],
});
const exited = new Promise(resolve => child.once("close", resolve));
const core = { child, stdout: captureLines(child.stdout), stderr: captureLines(child.stderr), exited };
const checks = [];
let socket;
try {
  await core.stdout.waitFor(line => jsonLine(line)?.msg === "ws server listening", 30000);
  socket = await connect(port);
  const initial = await entries();
  for (const key of ["TAKI_MAX_STEPS", "TAKI_UTILITY_CONTEXT_TOKENS", "TAKI_MEMORY_TIDY_MAX_STEPS"]) {
    assert.equal(initial.find(row => row.key === key).application.state, "unavailable");
  }
  checks.push("basic-plane-starts-with-independent-invalid-policies");
  await set("TAKI_UTILITY_CONTEXT_TOKENS", 64000);
  assert.equal((await entries()).find(row => row.key === "TAKI_UTILITY_CONTEXT_TOKENS").application.state, "applied");
  checks.push("utility-context-applies-while-main-policy-invalid");
  await set("TAKI_MEMORY_STOPLIST", "off");
  await until(async () => (await entries()).find(row => row.key === "TAKI_MEMORY_STOPLIST").application.activeValue === "off");
  const operations = await socket.request("memory.operations.list", { includeTerminal: true, limit: 20 });
  assert.ok(!operations.error, JSON.stringify(operations.error));
  checks.push("stoplist-applies-through-real-config-rpc");
  await set("TAKI_WS_PORT", nextPort);
  socket.close(); socket = undefined;
  await until(async () => { try { socket = await connect(nextPort); return true; } catch { return false; } });
  await until(async () => (await entries()).find(row => row.key === "TAKI_WS_PORT").application.state === "applied");
  checks.push("listener-rebind-new-socket-control-plane-available");
  writeFileSync(join(output, "evidence.json"), JSON.stringify({ checks, port, nextPort, operations: operations.result }, null, 2));
  console.log(JSON.stringify({ output, checks }));
} finally {
  socket?.close();
  if (child.connected) child.send({ stop: true });
  const timer = setTimeout(() => killTree(core), 10000);
  await exited; clearTimeout(timer);
  assert.ok(child.exitCode !== null || child.signalCode !== null);
}
async function connect(port) {
  const client = await openRpcSocket(`ws://127.0.0.1:${port}`);
  const reply = await client.request("connect", { deviceId: randomUUID(), deviceName: "isolated-live-settings", role: "operator", capabilities: [] });
  if (reply.error) { client.close(); throw new Error("fixture connect failed"); }
  return client;
}
async function entries() {
  const response = await socket.request("config.list", {});
  assert.ok(!response.error, JSON.stringify(response.error));
  return response.result.entries;
}
async function set(key, value) {
  const response = await socket.request("config.set", { key, value });
  assert.ok(!response.error, JSON.stringify(response.error));
}
async function until(check) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 50)); }
  throw new Error("fixture observation deadline");
}
