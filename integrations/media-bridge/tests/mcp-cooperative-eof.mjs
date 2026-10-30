/** Standard MCP JSON-RPC framing followed by cooperative stdin EOF, never a model. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { clearTimeout, setTimeout } from "node:timers";
import { fileURLToPath, URL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const packageRoot = fileURLToPath(new URL("../", import.meta.url));
const [python, evidenceArgument, openbiliArgument] = process.argv.slice(2);
const withOpenbili = openbiliArgument === "--with-openbili";
assert.ok(python && evidenceArgument, "Expected isolated Python and evidence directory");
const evidence = path.resolve(evidenceArgument);
const nonce = randomUUID();
const fixture = path.join(evidence, `eof-fixture-${nonce}`);
await mkdir(fixture, { recursive: true });
await writeFile(path.join(fixture, "fixture.json"), JSON.stringify({ nonce }));
const report = { nonce, checks: [], failures: [] };
const pending = new Map();
let actual;
let buffer = "";
let nextId = 1;
let exitCode;
const child = spawn(python, ["-B", path.join(packageRoot, "tests/mcp_stdio_fixture.py"), "--evidence", fixture, "--nonce", nonce,
  ...(withOpenbili ? ["--with-openbili"] : [])],
  { cwd: path.join(packageRoot, "src"), stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
const exited = new Promise(resolve => child.once("exit", code => { exitCode = code; resolve(); }));
let stderr = "";
child.stderr.on("data", chunk => { stderr += chunk.toString("utf8"); });
child.stdout.setEncoding("utf8");
child.stdout.on("data", chunk => {
  buffer += chunk;
  while (buffer.includes("\n")) {
    const position = buffer.indexOf("\n");
    const line = buffer.slice(0, position);
    buffer = buffer.slice(position + 1);
    try {
      const message = JSON.parse(line);
      if (message.id !== undefined && pending.has(message.id)) {
        const entry = pending.get(message.id);
        pending.delete(message.id);
        clearTimeout(entry.timer);
        if (message.error) entry.reject(new Error("MCP returned a protocol error"));
        else entry.resolve(message.result);
      }
    } catch (error) {
      report.failures.push({ name: error.name, message: "Invalid MCP stdout framing" });
    }
  }
});
function request(method, params = {}) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error("MCP response deadline exceeded")); }, 10000);
    pending.set(id, { resolve, reject, timer });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
}
function alive(pid) {
  try { process.kill(pid, 0); return true; } catch (error) { if (error.code === "ESRCH") return false; throw error; }
}
try {
  const initialized = await request("initialize", { protocolVersion: "2025-11-25", capabilities: {},
    clientInfo: { name: "independent-cooperative-eof-test", version: "1" } });
  report.protocol = initialized.protocolVersion;
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
  actual = JSON.parse(await readFile(path.join(fixture, "interpreter-ready.json"), "utf8"));
  assert.equal(actual.nonce, nonce);
  report.actual_interpreter_pid = actual.pid;
  const listed = await request("tools/list");
  assert.equal(listed.tools.length, withOpenbili ? 10 : 6);
  const result = await request("tools/call", { name: "bilinote_get_instance", arguments: {} });
  assert.notEqual(result.isError, true);
  if (withOpenbili) {
    const profile = await request("tools/call", { name: "openbili_read_profile", arguments: {} });
    assert.notEqual(profile.isError, true);
  }
  report.checks.push("standard-initialize-list-and-read-tool");
  // Keep stdout open to drain server output. Closing only stdin is the standard
  // cooperative EOF stimulus, distinct from Taki's process-abort close.
  child.stdin.end();
  await Promise.race([exited, delay(10000, undefined, { ref: false }).then(() => { throw new Error("Cooperative EOF exit deadline exceeded"); })]);
  assert.equal(exitCode, 0);
  assert.equal(alive(actual.pid), false);
  const finished = JSON.parse(await readFile(path.join(fixture, "interpreter-finished.json"), "utf8"));
  assert.equal(finished.nonce, nonce);
  assert.equal(finished.pid, actual.pid);
  assert.equal(finished.client_sealed, true);
  assert.equal(finished.transport_cleanup_completed, true);
  assert.equal(finished.cleanup_task_completed, true);
  assert.equal(finished.native_posts, 0);
  assert.deepEqual(finished.forbidden_boundary_attempts, []);
  if (withOpenbili) {
    assert.equal(finished.openbili_client_sealed, true);
    assert.equal(finished.openbili_transport_cleanup_completed, true);
    assert.equal(finished.openbili_posts, 0);
    assert.equal(finished.openbili_http_calls, 1);
  }
  report.fixture = finished;
  report.checks.push("cooperative-eof-lifespan-transport-cleanup-and-actual-interpreter-exit");
} catch (error) {
  report.failures.push({ name: error.name, message: error.message });
} finally {
  child.stdin.end();
  try {
    if (!actual) actual = JSON.parse(await readFile(path.join(fixture, "interpreter-ready.json"), "utf8"));
    assert.equal(actual.nonce, nonce);
    if (alive(actual.pid)) {
      report.orphan_before_fixture_cleanup = true;
      process.kill(actual.pid, "SIGTERM");
      for (let attempt = 0; attempt < 100 && alive(actual.pid); attempt += 1) await delay(50);
    }
    report.interpreter_still_alive = alive(actual.pid);
  } catch (error) {
    report.failures.push({ name: error.name, message: "Actual interpreter cleanup could not be verified" });
  }
  for (const entry of pending.values()) clearTimeout(entry.timer);
  report.passed = report.failures.length === 0 && report.interpreter_still_alive === false;
  await writeFile(path.join(evidence, "cooperative-eof-stderr.txt"), stderr);
  await writeFile(path.join(evidence, "cooperative-eof-results.json"), JSON.stringify(report, null, 2));
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  process.exitCode = report.passed ? 0 : 1;
}
