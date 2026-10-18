// Real main/WS composition on an owned empty data directory; no dotenv or provider network.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { randomUUID } from "node:crypto";
import net from "node:net";
import { syncBuiltinESMExports } from "node:module";
import { pathToFileURL } from "node:url";

const label = process.argv[2] ?? "b2-core-boot-01";
assert.match(label, /^b2-core-boot-\d+$/u);
const root = resolve(import.meta.dirname, "../../../..");
const runtime = join(root, ".trellis/.runtime/stage5b-core-boot");
mkdirSync(runtime, { recursive: true });
const dataDir = mkdtempSync(join(runtime, "owned-"));
const reservation = net.createServer();
await new Promise((resolve, reject) => reservation.once("error", reject).listen(0, "127.0.0.1", resolve));
const port = reservation.address().port;
await new Promise((resolve) => reservation.close(resolve));
assert.notEqual(port, 8974);

for (const key of Object.keys(process.env)) {
  if (/^(TAKI_|HINDSIGHT_|OPENAI_|ANTHROPIC_|DOTENV_CONFIG_|CREDENTIALS_DIRECTORY$|NODE_OPTIONS$)/u.test(key)) delete process.env[key];
}
Object.assign(process.env, {
  TAKI_DATA_DIR: dataDir, TAKI_WS_HOST: "127.0.0.1", TAKI_WS_PORT: String(port),
  TAKI_PROVIDER_BASE_URL: "http://127.0.0.1:9/v1", TAKI_PROVIDER_API_KEY: "owned-unused-key",
  TAKI_PROVIDER_MODEL: "owned-unused-model", TAKI_HINDSIGHT_ENABLED: "false",
  TAKI_TRUST_LOOPBACK_OPERATOR: "true", TAKI_LOG_LEVEL: "info",
});

let prohibitedCalls = 0;
let verified = false;
const authenticatedMethods = [];
globalThis.fetch = async () => { prohibitedCalls++; throw new Error("Probe forbids model or external HTTP"); };
const originalConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  const candidate = Array.isArray(args[0]) ? args[0][0] : args[0];
  const options = typeof candidate === "object" ? candidate : { port: candidate, host: args[1] };
  if (Number(options.port) !== port || options.host !== "127.0.0.1") {
    prohibitedCalls++;
    throw new Error("Probe forbids non-owned socket");
  }
  return Reflect.apply(originalConnect, this, args);
};
syncBuiltinESMExports();
process.once("exit", (exitCode) => writeFileSync(join(import.meta.dirname, `${label}-result.json`), JSON.stringify({
  exitCode, verified, pid: process.pid, dataDir, port, isolated: true, dotenvLoaded: false,
  authenticatedMethods, prohibitedCalls, originalDeploymentTouched: false,
}, null, 2) + "\n"));

// A failed or incomplete probe must not be mistaken for main's normal SIGTERM exit.
const deadline = setTimeout(() => process.exit(1), 30_000);
await import(pathToFileURL(join(root, "packages/core/src/main.ts")));
const socket = new WebSocket(`ws://127.0.0.1:${port}`);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});
let sequence = 0;
function request(method, params) {
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    const finish = () => { socket.removeEventListener("message", listener); clearTimeout(timer); };
    const timer = setTimeout(() => { finish(); reject(new Error("Owned RPC timeout")); }, 5000);
    const listener = (event) => {
      const response = JSON.parse(event.data);
      if (response.id !== id) return;
      finish(); resolve(response);
    };
    socket.addEventListener("message", listener);
    socket.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
  });
}

assert.ok((await request("connect", { deviceId: randomUUID(), deviceName: "owned-b2-core-boot", role: "operator" })).result);
const status = await request("memory.templates.status", {});
assert.equal(status.result.supported, false);
assert.equal(status.result.previewAvailable, false);
assert.equal(status.result.holdPlanId, null);
assert.equal(status.result.plan, null);
authenticatedMethods.push("memory.templates.status");
const preview = await request("memory.templates.preview", { target: { kind: "defaults",
  globalTemplateRevision: "taki-bank-v2", characterTemplateRevision: "taki-bank-v2" } });
assert.equal(preview.result.state, "refused");
assert.equal(preview.result.reason, "MEMORY_TEMPLATE_UNSUPPORTED");
authenticatedMethods.push("memory.templates.preview");
const derived = await request("memory.templates.derived", { planId: randomUUID(), bankId: "owned-missing-bank", childId: randomUUID() });
assert.equal(derived.error.data.code, "MEMORY_OPERATION_REFUSED");
assert.equal(derived.error.data.reason, "MEMORY_TEMPLATE_PLAN_NOT_FOUND");
authenticatedMethods.push("memory.templates.derived");
assert.equal(prohibitedCalls, 0);
verified = true;
socket.close(); clearTimeout(deadline);
setTimeout(() => process.exit(1), 15_000).unref();
process.emit("SIGTERM");
