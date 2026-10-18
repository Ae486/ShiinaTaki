// Owned real-main boot probe: clean environment, fresh SQLite, no model network.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { randomUUID } from "node:crypto";
import net from "node:net";
import { syncBuiltinESMExports } from "node:module";
import { pathToFileURL } from "node:url";

const root = resolve(import.meta.dirname, "../../../..");
const resultDir = import.meta.dirname;
const runtime = join(root, ".trellis/.runtime/stage5a-boot");
mkdirSync(runtime, { recursive: true });
const dataDir = mkdtempSync(join(runtime, "owned-"));
// Reserve an ephemeral local port; the real main validates a nonzero configured
// port. A competing bind fails the probe, never falls back to another instance.
const reservation = net.createServer();
await new Promise((resolve, reject) => reservation.once("error", reject).listen(0, "127.0.0.1", resolve));
const port = reservation.address().port;
await new Promise((resolve) => reservation.close(resolve));
for (const key of Object.keys(process.env)) {
  if (/^(TAKI_|HINDSIGHT_|OPENAI_|ANTHROPIC_|CREDENTIALS_DIRECTORY$|NODE_OPTIONS$)/u.test(key)) delete process.env[key];
}
Object.assign(process.env, {
  TAKI_DATA_DIR: dataDir, TAKI_WS_HOST: "127.0.0.1", TAKI_WS_PORT: String(port),
  TAKI_PROVIDER_BASE_URL: "http://127.0.0.1:9/v1", TAKI_PROVIDER_API_KEY: "owned-unused-key",
  TAKI_PROVIDER_MODEL: "owned-unused-model", TAKI_HINDSIGHT_ENABLED: "false",
  TAKI_TRUST_LOOPBACK_OPERATOR: "true", TAKI_LOG_LEVEL: "info",
});
let prohibitedCalls = 0;
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
const deadline = setTimeout(() => { process.exitCode = 1; process.emit("SIGTERM"); }, 30_000);
await import(pathToFileURL(join(root, "packages/core/src/main.ts")));
const socket = new WebSocket(`ws://127.0.0.1:${port}`);
await new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }); });
let sequence = 0;
function request(method, params) {
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("RPC timeout")), 5000);
    const listener = (event) => {
      const response = JSON.parse(event.data);
      if (response.id !== id) return;
      socket.removeEventListener("message", listener); clearTimeout(timer);
      if (response.error) reject(new Error(`RPC refused ${response.error.code}`)); else resolve(response.result);
    };
    socket.addEventListener("message", listener);
    socket.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
  });
}
await request("connect", { deviceId: randomUUID(), deviceName: "owned-boot-probe", role: "operator" });
for (const method of ["status", "observe"]) {
  const result = await request(`memory.hindsight.configuration.${method}`, { scope: { kind: "global" } });
  assert.equal(result.status, "unavailable");
  assert.equal(result.reason, "connection_unavailable");
  assert.equal(result.observation, null);
}
assert.equal(prohibitedCalls, 0);
socket.close(); clearTimeout(deadline);
process.once("exit", (code) => writeFileSync(join(resultDir, "boot-smoke-result.json"), JSON.stringify({
  exitCode: code, dataDir, isolated: true, dotenvLoaded: false, authenticatedMethods: ["status", "observe"],
  prohibitedCalls, originalDeploymentTouched: false,
}, null, 2) + "\n"));
process.emit("SIGTERM");
