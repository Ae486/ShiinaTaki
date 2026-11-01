/**
 * INPUT: scenario-owned transparent observer endpoint and the configured production model identity
 * OUTPUT: actual Co-Watching shared-child plan counts, usage, isolated artifact and failure evidence
 * POS: e2e/fixture — real Skill/model/files/SQLite; synthetic native analysis, paused playback and acceptance ports
 */
import { strict as assert } from "node:assert";
import { URL } from "node:url";
import { expect } from "vitest";
import { createModels } from "../../../packages/core/src/config/provider-factory.ts";
import { coWatchingFixture } from "../../../packages/core/src/testing/co-watching-fixture.ts";

export async function observeRealCoWatchingPlan(input) {
  const endpoint = new URL(input.baseUrl);
  assert.equal(endpoint.hostname, "127.0.0.1");
  const { model } = createModels({ provider: { baseUrl: input.baseUrl,
    apiKey: "synthetic-observer-client", model: input.modelId }, vision: null, includeUsage: true });
  let fixture;
  let passed = false;
  try {
    fixture = await coWatchingFixture({ preparation: { model, modelId: model.modelId, provider: model.provider,
      contextTokens: input.contextTokens, historyRatio: input.historyRatio, useProviderUsage: input.useProviderUsage } });
    await fixture.start();
    await expect.poll(() => ["ready", "failed", "paused_child"].includes(fixture.session()?.status),
      { timeout: 300_000, interval: 300 }).toBe(true);
    const session = fixture.session();
    const summary = fixture.subagents.summary(session.subagentId);
    input.checkpoint("simple-cowatching-real-plan-observation", capture(fixture, summary));
    assert.equal(session.status, "ready");
    assert.equal(summary.progress.intervalSteps, 50);
    assert.equal(summary.progress.parentApprovalLimit, 3);
    assert.equal(summary.progress.workInputId, session.workInputId);
    assert.ok(summary.progress.completedSteps > 0 && summary.progress.completedSteps < 50);
    assert.equal(fixture.db.prepare("SELECT count(*) AS steps FROM subagent_task_steps WHERE work_input_id=:work AND completed_ordinal IS NOT NULL")
      .get({ work: session.workInputId }).steps, summary.progress.completedSteps);
    assert.equal(fixture.db.prepare("SELECT count(*) AS n FROM subagent_checkins WHERE work_input_id=:work").get({ work: session.workInputId }).n, 0);
    const result = fixture.subagents.result({ characterId: "taki", completionId: summary.latestCompletionId }).result;
    assert.equal(result.child.outcome, "completed");
    assert.equal(result.child.outputKind, "validated");
    assert.equal(result.completionState, "not_requested");
    assert.equal(fixture.generate.mock.calls.length, 0);
    assert.equal(fixture.timeline.latestAscending("taki", 10).length, 0);
    assert.equal(fixture.submitNative.mock.calls.length, 0);
    assert.equal(fixture.playback.sample.state, "paused");
    assert.ok(fixture.db.prepare("SELECT DISTINCT model_id FROM run_attempts").all().some((row) => row.model_id === input.modelId));
    input.checkpoint("simple-cowatching-real-plan-passed", { ...capture(fixture, summary), result,
      privateMessages: fixture.db.prepare("SELECT * FROM run_messages").all() });
    passed = true;
  } finally {
    await finish({ fixture, passed, checkpoint: input.checkpoint });
  }
}

function capture(fixture, summary) {
  return { status: fixture.session()?.status, progress: summary?.progress ?? null, tokenUsage: summary?.tokenUsage ?? null,
    contextPolicy: fixture.contextPolicy,
    attempts: fixture.db.prepare("SELECT run_id,attempt_id,provider,model_id,state,outcome FROM run_attempts").all(),
    actualTaskSteps: fixture.db.prepare("SELECT work_input_id,completed_ordinal,model_effect_id FROM subagent_task_steps").all(),
    usage: fixture.db.prepare("SELECT * FROM run_usage").all(), errors: fixture.errors,
    effects: fixture.db.prepare("SELECT kind,state,outcome,error_code FROM run_effects").all(),
    scope: "Actual Co-Watching plan shared child, shipped taki-co-watching Skill, governed files and SQLite, configured real main model. Context policy comes from the booted scenario; fixture Utility uses the shipped main-model fallback. Already-analyzed synthetic 300-second video/two moments; mock paused playback, acceptance/source/delivery ports. No external video analysis, native browser integration or human acceptance." };
}

async function finish({ fixture, passed, checkpoint }) {
  let evidenceFailed = false;
  try { if (fixture) checkpoint("simple-cowatching-final-evidence", capture(fixture,
    fixture.session()?.subagentId ? fixture.subagents.summary(fixture.session().subagentId) : undefined)); }
  catch { evidenceFailed = true; }
  let cleanupFailed = false;
  try { await fixture?.cleanup(); } catch { cleanupFailed = true; }
  if (passed && (evidenceFailed || cleanupFailed)) throw new Error("real Co-Watching plan evidence/cleanup failed");
}
