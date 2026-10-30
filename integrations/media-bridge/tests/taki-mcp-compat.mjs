/** Test-only standard client compatibility; no Taki production code is modified. */
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, URL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

import { defaultConnect } from "../../../packages/core/src/mcp/mcp-connect.ts";

const packageRoot = fileURLToPath(new URL("../", import.meta.url));
const [python, evidenceArgument] = process.argv.slice(2);
assert.ok(python && evidenceArgument, "Expected isolated Python and evidence directory arguments");
const evidence = path.resolve(evidenceArgument);
const nonce = randomUUID();
const fixture = path.join(evidence, `mcp-fixture-${nonce}`);
await mkdir(fixture, { recursive: true });
await writeFile(path.join(fixture, "fixture.json"), JSON.stringify({ nonce }));
const golden = JSON.parse(await readFile(path.join(packageRoot, "tests/bilinote-golden.json"), "utf8"));
const request = golden.identity.request_id;
const job = golden.identity.job_id;
const report = { nonce, node: process.version, client: "existing Taki defaultConnect / @ai-sdk/mcp", checks: [], failures: [] };
let client;
let actual;

function alive(pid) {
  try { process.kill(pid, 0); return true; } catch (error) {
    if (error.code === "ESRCH") return false;
    throw error;
  }
}
function data(response) {
  assert.notEqual(response.isError, true, "MCP operation returned an error");
  return response.structuredContent ?? JSON.parse(response.content.find(item => item.type === "text").text);
}
async function call(name, args = {}) {
  return client.callTool({ name, arguments: args, options: { signal: globalThis.AbortSignal.timeout(10000) } });
}

try {
  client = await defaultConnect({ key: "media-bridge-fixture", config: {
    command: python, args: ["-B", path.join(packageRoot, "tests/mcp_stdio_fixture.py"), "--evidence", fixture, "--nonce", nonce],
    cwd: path.join(packageRoot, "src"),
  } });
  actual = JSON.parse(await readFile(path.join(fixture, "interpreter-ready.json"), "utf8"));
  assert.equal(actual.nonce, nonce);
  assert.ok(Number.isSafeInteger(actual.pid));
  report.actual_interpreter_pid = actual.pid;
  report.negotiated_protocol = client.initializeResult.protocolVersion;
  const listed = await client.listTools();
  assert.deepEqual(listed.tools.map(tool => tool.name).sort(), ["bilinote_get_instance", "bilinote_submit_analysis",
    "bilinote_lookup_request", "bilinote_get_status", "bilinote_read_result", "bilinote_probe_media"].sort());
  for (const tool of listed.tools) {
    assert.equal(tool.inputSchema.type, "object");
    assert.equal(tool.annotations.readOnlyHint, tool.name !== "bilinote_submit_analysis");
  }
  report.checks.push("initialize-and-six-tools-with-annotations");
  assert.equal(data(await call("bilinote_get_instance")).service_instance_id, golden.identity.service_instance_id);
  const access = data(await call("bilinote_probe_media", { video_url: "https://www.bilibili.com/video/BVfixture" }));
  assert.equal(access.service_instance_id, golden.identity.service_instance_id);
  assert.equal(access.source.cid, "222");
  assert.equal(access.access.byte_length, 1024);
  report.checks.push("exact-native-range-probe-without-submission");
  const submitted = data(await call("bilinote_submit_analysis", { client_request_id: request,
    video_url: "https://www.bilibili.com/video/BVfixture" }));
  assert.equal(submitted.request_digest, golden.generation_digest);
  assert.equal(data(await call("bilinote_lookup_request", { client_request_id: request })).task_id, job);
  assert.equal(data(await call("bilinote_get_status", { client_request_id: request, job_id: job })).state, "succeeded");
  report.checks.push("submit-lookup-status-exact-native-binding");
  const preview = data(await call("bilinote_read_result", { client_request_id: request, job_id: job }));
  assert.equal(preview.complete, false);
  const resources = await client.listResourceTemplates();
  assert.equal(resources.resourceTemplates.length, 1);
  const resource = await client.readResource({ uri: preview.artifact.resource_uri });
  const text = resource.contents[0].text;
  assert.equal(createHash("sha256").update(text, "utf8").digest("hex"), preview.artifact.sha256);
  assert.equal(Buffer.byteLength(text, "utf8"), preview.artifact.byte_length);
  assert.deepEqual(JSON.parse(text), golden.result);
  const complete = data(await call("bilinote_read_result", { client_request_id: request, job_id: job, include_complete: true }));
  assert.equal(complete.complete, true);
  assert.deepEqual(complete.result, golden.result);
  report.checks.push("complete-resource-original-byte-hash-and-full-tool-view");
  const refused = await call("bilinote_get_status", { client_request_id: "bad", job_id: job });
  assert.equal(refused.isError, true);
  assert.ok(JSON.stringify(refused).includes("invalid_bridge_input"));
  report.checks.push("bounded-tool-error");
} catch (error) {
  report.failures.push({ name: error.name, message: error.message });
} finally {
  try {
    const progress = JSON.parse(await readFile(path.join(fixture, "interpreter-progress.json"), "utf8"));
    assert.equal(progress.nonce, nonce);
    assert.equal(progress.pid, actual.pid);
    assert.deepEqual(progress.forbidden_boundary_attempts, []);
    assert.equal(progress.native_posts, 1);
    report.preclose_fixture = progress;
  } catch (error) {
    report.failures.push({ name: error.name, message: "Pre-close fixture evidence unavailable or mismatched" });
  }
  if (client) await client.close().catch(error => report.failures.push({ name: error.name, message: "MCP close failed" }));
  try {
    if (!actual) actual = JSON.parse(await readFile(path.join(fixture, "interpreter-ready.json"), "utf8"));
    assert.equal(actual.nonce, nonce);
    // Popen/launcher PID is deliberately never used as interpreter authority.
    for (let attempt = 0; attempt < 100 && alive(actual.pid); attempt += 1) await delay(50);
    report.orphan_interpreter_observed = alive(actual.pid);
    if (report.orphan_interpreter_observed) {
      report.failures.push({ name: "LifecycleError", message: "Nonce-matched interpreter survived protocol close" });
      // This PID was reported by this nonce-owned fixture interpreter itself,
      // not inferred from the Windows venv launcher process.
      process.kill(actual.pid, "SIGTERM");
      for (let attempt = 0; attempt < 100 && alive(actual.pid); attempt += 1) await delay(50);
    }
    report.interpreter_still_alive = alive(actual.pid);
    report.client_close_behavior = "existing @ai-sdk/mcp transport aborts its child process";
    report.cooperative_eof_lifespan_cleanup = "not established by this termination-oriented client";
    try {
      const finished = JSON.parse(await readFile(path.join(fixture, "interpreter-finished.json"), "utf8"));
      assert.equal(finished.nonce, nonce);
      assert.equal(finished.pid, actual.pid);
      report.optional_finally_evidence = finished;
    } catch (error) {
      if (error.code === "ENOENT") report.finally_evidence_present = false;
      else report.failures.push({ name: error.name, message: "Fixture finalization evidence is invalid" });
    }
    if (!report.orphan_interpreter_observed) report.checks.push("existing-client-termination-and-actual-interpreter-exit-no-orphan");
  } catch (error) {
    report.failures.push({ name: error.name, message: "Fixture close evidence unavailable or mismatched" });
  }
  report.passed = report.failures.length === 0 && report.interpreter_still_alive === false;
  await writeFile(path.join(evidence, "mcp-compat-results.json"), JSON.stringify(report, null, 2));
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  process.exitCode = report.passed ? 0 : 1;
}
