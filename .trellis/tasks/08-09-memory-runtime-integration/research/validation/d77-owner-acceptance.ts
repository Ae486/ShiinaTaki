/**
 * INPUT:  owned supervisor admission and one requested real-data acceptance stage
 * OUTPUT: exact stage evidence plus a receipt only after actual assertions and settled shutdown
 * POS:    D77 task consumer; a stage receipt does not claim the complete owner acceptance has passed
 */
import assert from "node:assert/strict";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { admittedArguments, controller, event, openRuntime, privateJson, ROOT, traffic, type AcceptanceRuntime } from "./d77-owner-acceptance-context.ts";
import { admit } from "./d77-owner-acceptance-admission.ts";
import { bootstrapAndReconstruct } from "./d77-owner-acceptance-storage.ts";
import { verifyActualColdResume } from "./d77-owner-acceptance-cold.ts";
import { runModelAndRecovery } from "./d77-owner-acceptance-models.ts";
import { completedBaseline } from "./d77-owner-acceptance-resume.ts";
import { finishSavedRetirement } from "./d77-owner-acceptance-retirement.ts";
import type { RuntimeOwner } from "./d77-owner-acceptance-policy.ts";

const identity = process.env.TAKI_D78_CONSUMER_ID ?? "";
const stopped = () => controller.abort();
process.on("SIGINT", stopped); process.on("SIGTERM", stopped);
process.stdin.setEncoding("utf8"); process.stdin.on("data", stopped); process.stdin.on("end", stopped);
let runtime: AcceptanceRuntime | undefined;
let owner: RuntimeOwner | undefined;
let heartbeat: ReturnType<typeof setInterval> | undefined;
let result: unknown;
try {
  const { path, endpoint } = admittedArguments();
  assert.match(identity, /^(bootstrap|models|recovery)-[a-z0-9-]+$/);
  assert.equal(existsSync(join(ROOT, `consumer-${identity}-complete.json`)), false);
  const stage = identity.startsWith("bootstrap-") ? "bootstrap" : identity.startsWith("recovery-") ? "recovery" : "models";
  event("ACCEPTANCE_STAGE_STARTED", { identity, stage });
  await admit(path, endpoint);
  runtime = await openRuntime(path, endpoint);
  heartbeat = setInterval(() => event("ACCEPTANCE_PROGRESS", { identity, ...traffic }), 30000);
  heartbeat.unref();
  if (stage === "bootstrap") result = await bootstrapAndReconstruct(runtime);
  else if (stage === "recovery") result = await finishSavedRetirement(runtime);
  else {
    const resume = identity.startsWith("models-continue-");
    const cold = resume ? completedBaseline() : await verifyActualColdResume(runtime, identity);
    owner = { current: runtime, retiredUsage: [] };
    result = { cold, models: await runModelAndRecovery(owner, resume) };
    runtime = owner.current; owner = undefined;
  }
  await runtime.close(); runtime = undefined;
  privateJson(`${stage}-result.json`, { passed: true, identity, traffic, result });
  writeFileSync(join(ROOT, `consumer-${identity}-complete.json`), `${JSON.stringify({ schemaVersion: 1,
    runDirectoryId: "9e41c8d27fa0", consumerId: identity, state: "complete" })}\n`, { flag: "wx" });
  event("ACCEPTANCE_STAGE_COMPLETE", { identity, stage, ...traffic });
} catch (error) {
  // The full private diagnostic is kept for the owner. The terminal event
  // exposes only a closed error class; model/source text never reaches stdout.
  privateJson(`failure-${identity || "admission"}.json`, { name: error instanceof Error ? error.name : "unknown",
    message: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : undefined });
  event("ACCEPTANCE_STAGE_FAILED", { identity, errorType: error instanceof Error ? error.name : "unknown" });
  process.exitCode = 1;
} finally {
  if (heartbeat) clearInterval(heartbeat);
  const current = owner?.current ?? runtime;
  if (current) { try { await current.close(); } catch { process.exitCode = 1; } }
  process.stdin.pause();
  process.off("SIGINT", stopped); process.off("SIGTERM", stopped);
}
