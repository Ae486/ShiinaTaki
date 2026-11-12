/** Offline OpenBili interoperability through the existing Taki MCP connection. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, URL } from "node:url";

import { defaultConnect } from "../../../packages/core/src/mcp/mcp-connect.ts";
import { checkOpenbiliDisclosure } from "./openbili-disclosure-check.mjs";

const packageRoot = fileURLToPath(new URL("../", import.meta.url));
const [python, evidenceArgument] = process.argv.slice(2);
assert.ok(python && evidenceArgument, "Expected isolated Python and evidence directory");
const evidence = path.resolve(evidenceArgument);
const nonce = randomUUID();
const fixture = path.join(evidence, `openbili-fixture-${nonce}`);
await mkdir(fixture, { recursive: true });
await writeFile(path.join(fixture, "fixture.json"), JSON.stringify({ nonce }));
const report = { nonce, node: process.version, checks: [], failures: [] };
let client;
let actual;

function data(result) {
  assert.notEqual(result.isError, true);
  return result.structuredContent ?? JSON.parse(result.content.find(item => item.type === "text").text);
}
function alive(pid) {
  try { process.kill(pid, 0); return true; } catch (error) {
    if (error.code === "ESRCH") return false;
    throw error;
  }
}
async function call(name, args = {}) {
  return client.callTool({ name, arguments: args, options: { signal: globalThis.AbortSignal.timeout(10000) } });
}

try {
  client = await defaultConnect({ key: "media-openbili-fixture", config: {
    command: python, args: ["-B", path.join(packageRoot, "tests/mcp_stdio_fixture.py"),
      "--evidence", fixture, "--nonce", nonce, "--with-openbili"], cwd: path.join(packageRoot, "src"),
  } });
  actual = JSON.parse(await readFile(path.join(fixture, "interpreter-ready.json"), "utf8"));
  assert.equal(actual.nonce, nonce);
  const { tools } = await client.listTools();
  assert.equal(tools.length, 10);
  const openbili = tools.filter(tool => tool.name.startsWith("openbili_"));
  assert.equal(openbili.length, 4);
  for (const tool of openbili) {
    assert.equal(tool.inputSchema.type, "object");
    assert.equal(tool.inputSchema.additionalProperties, false);
    assert.deepEqual([...(tool.inputSchema.required ?? [])].sort(), Object.keys(tool.inputSchema.properties).sort());
  }
  const definitions = Object.fromEntries(openbili.map(tool => [tool.name, tool]));
  assert.equal(definitions.openbili_read_recommendations.annotations.readOnlyHint, false);
  assert.equal(definitions.openbili_read_recommendations.annotations.idempotentHint, false);
  assert.equal(definitions.openbili_peek_recommendations.annotations.readOnlyHint, true);
  assert.deepEqual(definitions.openbili_submit_feedback.inputSchema.properties.feedback_type.enum,
    ["like", "dislike", "comment", "dismiss"]);
  report.checks.push("existing-sdk-ten-tool-discovery-strict-schemas-native-risk-annotations");

  const peek = data(await call("openbili_peek_recommendations", { limit: 3 }));
  assert.equal(peek.source, "existing_recommendations");
  assert.equal(peek.native_side_effects, "none");
  assert.equal(peek.items[0].id, 17);
  const browse = data(await call("openbili_read_recommendations", { limit: 3 }));
  assert.equal(browse.native_side_effects, "may_top_up_and_serve_recommendations");
  const profile = data(await call("openbili_read_profile"));
  assert.equal(profile.evidence_kind, "native_inferred_profile");
  assert.ok(profile.read_at_utc);
  assert.equal(profile.profile.recent_cognition_updates[0].source, "content_feedback");
  report.checks.push("source-attributed-peek-browse-profile-over-actual-stdio");

  const request = { request_id: nonce, recommendation_id: 17, feedback_type: "like", note: "" };
  const first = data(await call("openbili_submit_feedback", request));
  assert.equal(first.duplicate, false);
  assert.equal(first.processing, "queued");
  assert.equal(first.profile_application, "not_confirmed");
  const retry = data(await call("openbili_submit_feedback", request));
  assert.equal(retry.duplicate, true);
  assert.equal(retry.event_id, first.event_id);
  const conflict = await call("openbili_submit_feedback", { ...request, feedback_type: "dislike" });
  assert.equal(conflict.isError, true);
  assert.equal(conflict.structuredContent.error.code, "openbili_feedback_conflict");
  assert.equal(conflict.structuredContent.request_id, nonce);
  const invalid = await call("openbili_submit_feedback", { ...request, feedback_type: "co_watching" });
  assert.equal(invalid.isError, true);
  report.checks.push("queued-native-feedback-exact-duplicate-conflict-and-enum-refusal");

  report.disclosure = await checkOpenbiliDisclosure(client, openbili);
  report.checks.push("actual-provider-request-bodies-hide-all-openbili-tools-until-exact-describe-next-step");
  assert.ok(data(await call("bilinote_get_instance")).service_instance_id);
  const progress = JSON.parse(await readFile(path.join(fixture, "interpreter-progress.json"), "utf8"));
  assert.equal(progress.nonce, nonce);
  assert.equal(progress.native_posts, 0);
  assert.equal(progress.openbili_posts, 3);
  assert.equal(progress.openbili_http_calls, 7);
  assert.deepEqual(progress.forbidden_boundary_attempts, []);
  report.checks.push("independent-bilinote-read-no-analysis-no-native-network-or-initialization");
  report.protocol = client.initializeResult.protocolVersion;
  report.fixture = progress;
} catch (error) {
  report.failures.push({ name: error.name, message: error.message });
} finally {
  if (client) await client.close().catch(() => report.failures.push({ message: "MCP close failed" }));
  try {
    if (!actual) actual = JSON.parse(await readFile(path.join(fixture, "interpreter-ready.json"), "utf8"));
    assert.equal(actual.nonce, nonce);
    for (let attempt = 0; attempt < 100 && alive(actual.pid); attempt += 1) await delay(50);
    report.orphan_observed = alive(actual.pid);
    if (report.orphan_observed) {
      report.failures.push({ message: "Nonce-owned fixture interpreter survived close" });
      process.kill(actual.pid, "SIGTERM");
      for (let attempt = 0; attempt < 100 && alive(actual.pid); attempt += 1) await delay(50);
    }
    report.interpreter_still_alive = alive(actual.pid);
  } catch {
    report.failures.push({ message: "Fixture interpreter cleanup could not be verified" });
  }
  report.passed = report.failures.length === 0 && report.interpreter_still_alive === false;
  await writeFile(path.join(evidence, "openbili-mcp-results.json"), JSON.stringify(report, null, 2));
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  process.exitCode = report.passed ? 0 : 1;
}
