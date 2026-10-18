// INPUT: an explicitly marked C1a fake-only root; no dotenv, production data, keys or external network.
// OUTPUT: actual Node main.ts boot, authenticated WS methods and a machine-readable shutdown result.
// POS: C1a validation fixture; adaptations of the existing B real-main probe use separate data/evidence paths.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { basename, resolve, join } from "node:path";
import { randomUUID } from "node:crypto";
import net from "node:net";
import { syncBuiltinESMExports } from "node:module";
import { pathToFileURL } from "node:url";

const fixtureRoot = resolve(process.argv[2]);
assert.ok(basename(fixtureRoot).startsWith("taki-c1a-fixture-"));
assert.equal(readFileSync(join(fixtureRoot, ".c1a-owned-fixture"), "utf8"), "C1A_FAKE_ONLY");
const repo = resolve(import.meta.dirname, "../../../..");
const dataDir = mkdtempSync(join(fixtureRoot, "core-boot-"));
const reservation = net.createServer();
await new Promise((resolve, reject) => reservation.once("error", reject).listen(0, "127.0.0.1", resolve));
const port = reservation.address().port;
await new Promise((resolve) => reservation.close(resolve));
assert.notEqual(port, 8974);
for (const key of Object.keys(process.env)) {
  if (!["SystemRoot", "WINDIR", "TEMP", "TMP"].includes(key)) delete process.env[key];
}
Object.assign(process.env, {
  TAKI_DATA_DIR: dataDir, TAKI_WS_HOST: "127.0.0.1", TAKI_WS_PORT: String(port),
  TAKI_PROVIDER_BASE_URL: "http://127.0.0.1:9/v1", TAKI_PROVIDER_API_KEY: "C1A_FAKE_UNUSED_KEY",
  TAKI_PROVIDER_MODEL: "C1A_FAKE_UNUSED_MODEL", TAKI_HINDSIGHT_ENABLED: "false",
  TAKI_TRUST_LOOPBACK_OPERATOR: "true", TAKI_LOG_LEVEL: "info", NODE_ENV: "production",
});
let prohibitedCalls = 0;
let verified = false;
const authenticatedMethods = [];
globalThis.fetch = async () => { prohibitedCalls++; throw new Error("C1a probe forbids external HTTP/model calls"); };
const originalConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  const candidate = Array.isArray(args[0]) ? args[0][0] : args[0];
  const options = typeof candidate === "object" ? candidate : { port: candidate, host: args[1] };
  if (Number(options.port) !== port || options.host !== "127.0.0.1") {
    prohibitedCalls++;
    throw new Error("C1a probe forbids non-owned sockets");
  }
  return Reflect.apply(originalConnect, this, args);
};
syncBuiltinESMExports();
process.once("exit", (exitCode) => writeFileSync(join(import.meta.dirname, "c1a-core-boot-result.json"), JSON.stringify({
  exitCode, verified, pid: process.pid, dataDir, port, isolated: true, dotenvLoaded: false,
  authenticatedMethods, prohibitedCalls, originalDeploymentTouched: false,
}, null, 2) + "\n"));
const deadline = setTimeout(() => process.exit(1), 30_000);
await import(pathToFileURL(join(repo, "packages/core/src/main.ts")));
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
    const timer = setTimeout(() => { finish(); reject(new Error("C1a owned RPC timeout")); }, 5000);
    const listener = (event) => {
      const response = JSON.parse(event.data);
      if (response.id !== id) return;
      finish(); resolve(response);
    };
    socket.addEventListener("message", listener);
    socket.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
  });
}
assert.ok((await request("connect", { deviceId: randomUUID(), deviceName: "C1a isolated boot", role: "operator" })).result);
const before = (await request("memory.hindsight.status", {})).result;
assert.ok(before);
authenticatedMethods.push("memory.hindsight.status");
assert.deepEqual((await request("memory.hindsight.custody.prepare", {})).result,
  { version: 1, state: "unavailable", reason: "unsupported-installation", deploymentReady: false });
authenticatedMethods.push("memory.hindsight.custody.prepare");
assert.ok((await request("memory.hindsight.custody.prepare", { receipt: { trusted: true } })).error);
assert.deepEqual((await request("memory.hindsight.status", {})).result, before);
assert.equal(prohibitedCalls, 0);
verified = true;
socket.close();
clearTimeout(deadline);
setTimeout(() => process.exit(1), 15_000).unref();
process.emit("SIGTERM");
