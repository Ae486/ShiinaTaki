import { afterEach, describe, expect, it, vi } from "vitest";
import { HindsightMemoryRecallEnvelopeV1Schema, type TakiMemoryPolicyProjection } from "@taki/shared";
import { APPLICATION_TEST_AT as at, applicationTestArtifact, applicationTestBody } from "../../testing/hindsight-application-fixtures.ts";
import { applicationTestBind, applicationTestBoundMemory } from "../../testing/hindsight-application-runtime-fixtures.ts";
import { hindsightRuntimeFixture } from "../../testing/hindsight-runtime-composition-fixtures.ts";
import { scriptedGenerateModel } from "../../testing/mock-language-model.ts";
import type { CapturedMemoryRun } from "../canonical-memory-run.ts";
import { curatorTestBank, curatorTestFixture, type CuratorTestBank } from "./hindsight-policy-curator-fixtures.ts";
import { captureHindsightRuntimeRows } from "./hindsight-runtime-view.ts";

// This suite covers the addressed observation's own policy and binding. Complete
// propagation from hidden or expired source inputs remains the separate D81 gap.
const OBSERVATION_TEXT = "Useful observation fact";
const HIDDEN_TEXT = "Hidden observation fact";
const sourceReferences = [{ name: "one source", sources: ["visible"] },
  { name: "multiple sources", sources: ["visible", "experience"] }, { name: "no declared sources", sources: [] }];
const restrictedObservations = [
  { name: "hidden", policy: { visibility: "hidden" } },
  { name: "expired", policy: { retention: { kind: "expiring", expiresAt: at } } },
  { name: "invalidated", invalidated: true },
] as const;
const cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); vi.restoreAllMocks(); });

function observationBank(input: {
  sources?: string[]; policy?: Partial<TakiMemoryPolicyProjection>; invalidated?: boolean; assessed?: boolean; character?: boolean;
} = {}) {
  const bank = curatorTestBank({ ...(input.character ? { bankId: "bank-taki", characterId: "taki" } : {}), memories: [
    { id: "visible", text: "Visible world fact" },
  ] });
  const hidden = applicationTestBoundMemory({ scope: bank.scope, bankScope: bank.bankScope,
    payload: { memory_id: "hidden", text: HIDDEN_TEXT, fact_type: "observation" }, policy: { visibility: "hidden" } });
  const experience = applicationTestBoundMemory({ scope: bank.scope, bankScope: bank.bankScope,
    payload: { memory_id: "experience", text: "Visible experience fact", fact_type: "experience" } });
  const observation = applicationTestBoundMemory({ scope: bank.scope, bankScope: bank.bankScope, policy: input.policy,
    payload: { memory_id: "observation", text: OBSERVATION_TEXT, fact_type: "observation",
      source_memory_ids: input.sources ?? ["visible"], state: input.invalidated ? "invalidated" : "valid",
      invalidated_at: input.invalidated ? at : null, invalidation_reason: input.invalidated ? "fixture" : null } });
  if (input.assessed) {
    const value = observation.value;
    observation.application = applicationTestArtifact({ scope: bank.scope, key: observation.application.artifact.key,
      binding: observation.application.artifact.binding, body: applicationTestBody("application-memory.v1", {
        ...value, policy_basis: "curated", assessment: { ...value.assessment, state: "assessed", attempts: 1,
          prompt_version: "policy-v1", prompt_hash: "e".repeat(64), completed_at: at },
      }, bank.scope) });
    applicationTestBind(observation.native, observation.application.artifact);
  }
  bank.native.push(hidden.native, experience.native, observation.native);
  bank.artifacts.push(hidden.application, experience.application, observation.application);
  return bank;
}

function runtimeFixture(bank: CuratorTestBank) {
  const other = bank.bankScope.kind === "global" ? curatorTestBank({ bankId: "bank-taki", characterId: "taki", memories: [] })
    : curatorTestBank({ memories: [] });
  const f = hindsightRuntimeFixture({ banks: [bank, other] }); cleanup.push(f.close); return f;
}

async function recall(run: CapturedMemoryRun) {
  return HindsightMemoryRecallEnvelopeV1Schema.parse(await run.tools.recall!.execute!(
    { query: "fact", scope: "both", limit: 8, maxTokens: 2048 }, { toolCallId: "observation-test", messages: [], context: {} }));
}

describe("ordinary observation eligibility at final Core consumers", () => {
  it.each(sourceReferences.flatMap((entry) => [false, true].map((offline) => ({ ...entry, offline }))))(
    "admits assessed observations with $name and offline=$offline to Recall and automatic recall", async ({ sources, offline }) => {
      const bank = observationBank({ sources, assessed: true }); const f = runtimeFixture(bank); const runtime = f.compose();
      await runtime.captureRun("taki");
      const retained = f.replica.record({ ...bank.scope, memoryId: "observation" });
      expect(retained?.unit.text).toBe(OBSERVATION_TEXT); expect(retained?.unit.sourceMemoryIds).toEqual(sources);
      f.remote.control.offline = offline;
      const run = await runtime.captureRun("taki");
      const result = await recall(run);
      expect(result).toMatchObject({ ok: true, providerId: "hindsight", data: { returned: 3, partial: offline,
        vectorState: offline ? "degraded" : "ready" } });
      if (!result.ok) throw new Error("fixture recall failed");
      expect(new Set(result.data.hits.map((hit) => hit.record.unit.factType))).toEqual(new Set(["world", "experience", "observation"]));
      expect(JSON.stringify(result)).toContain(OBSERVATION_TEXT); expect(JSON.stringify(result)).not.toContain(HIDDEN_TEXT);
      const automatic = await run.automaticRecall!({ query: "fact", visibleContext: "", now: Date.parse(at) });
      expect(automatic).toContain("Visible world fact"); expect(automatic).toContain("Visible experience fact");
      expect(automatic).toContain(OBSERVATION_TEXT); expect(automatic).not.toContain(HIDDEN_TEXT);
      expect(f.replica.record({ ...bank.scope, memoryId: "observation" })).toEqual(retained);
      expect(f.replica.nativeHead({ ...bank.scope, objectKind: "memory_unit", objectId: "observation" })?.binding_state).toBe("bound");
    },
  );

  it("stages a mood-gated observation only for intentions and renders it only for a matching query", async () => {
    const policy = { layerId: "intentions", visibility: "mood-gated" as const, disclosure: "specific topic" };
    const bank = observationBank({ character: true, policy, assessed: true });
    const f = runtimeFixture(bank); const subsystem = f.subsystem(); const run = await subsystem.captureRun("taki");
    for (const intentions of [false, true]) {
      const rows = captureHindsightRuntimeRows(subsystem.state, { characterId: "taki", intentions });
      expect(rows.some((row) => row.content === OBSERVATION_TEXT)).toBe(intentions);
      expect(JSON.stringify(rows)).not.toContain(HIDDEN_TEXT);
    }
    expect(run.assemble!("specific topic")).toContain(OBSERVATION_TEXT);
    expect(run.assemble!("unrelated question")).not.toContain(OBSERVATION_TEXT);
    expect(run.assemble!("")).not.toContain(OBSERVATION_TEXT);
  });

  it.each(sourceReferences)("admits observations with $name to actual curator model input without inventing an assessment", async ({ sources }) => {
    const bank = observationBank({ sources });
    const model = scriptedGenerateModel([{ kind: "tool", toolCallId: "finish", toolName: "policy_review_finish", input: {} }]);
    const f = curatorTestFixture({ banks: [bank], model }); cleanup.push(f.close);
    const before = f.replica.record({ ...bank.scope, memoryId: "observation" });
    await f.curator.runNow("taki");
    expect(model.doGenerateCalls).toHaveLength(1);
    const submitted = JSON.stringify(model.doGenerateCalls);
    expect(submitted).toContain("Visible world fact"); expect(submitted).toContain("Visible experience fact");
    expect(submitted).toContain(OBSERVATION_TEXT); expect(submitted).not.toContain(HIDDEN_TEXT);
    expect(f.replica.record({ ...bank.scope, memoryId: "observation" })).toEqual(before);
    const head = f.replica.nativeHead({ ...bank.scope, objectKind: "memory_unit", objectId: "observation" })!;
    const artifact = f.replica.artifact({ ...bank.scope, version: head.bound_artifact! })!;
    // Finishing without a policy proposal preserves neutral eligibility, while
    // the admitted but incomplete review keeps its existing failed/retry state.
    expect(f.replica.body({ ...bank.scope, bodyId: artifact.body_ref.body_id })?.content)
      .toMatchObject({ body_schema: "application-memory.v1", value: { policy_basis: "neutral", assessment: {
        state: "failed", attempts: 1, last_failure_code: "invalid_result", next_attempt_at: "2026-09-11T08:01:00.000Z",
      } } });
  });

  it.each(restrictedObservations.flatMap((entry) => [false, true].map((offline) => ({ ...entry, offline }))))(
    "excludes an observation whose own state is $name with offline=$offline from Recall and prompt rows", async ({ offline, ...input }) => {
      const bank = observationBank(input); const f = runtimeFixture(bank); const subsystem = f.subsystem();
      await subsystem.captureRun("taki"); f.remote.control.offline = offline;
      const run = await subsystem.captureRun("taki"); const result = await recall(run);
      expect(result).toMatchObject({ ok: true, data: { returned: 2, partial: offline } });
      expect(JSON.stringify(result)).not.toContain(OBSERVATION_TEXT);
      expect(await run.automaticRecall!({ query: "fact", visibleContext: "", now: Date.parse(at) })).not.toContain(OBSERVATION_TEXT);
      expect(JSON.stringify(captureHindsightRuntimeRows(subsystem.state, { characterId: "taki", intentions: true }))).not.toContain(OBSERVATION_TEXT);
    },
  );

  it.each(restrictedObservations)("excludes an observation whose own state is $name from curator model input", async (input) => {
    const bank = observationBank(input);
    const model = scriptedGenerateModel([{ kind: "tool", toolCallId: "finish", toolName: "policy_review_finish", input: {} }]);
    const f = curatorTestFixture({ banks: [bank], model }); cleanup.push(f.close);
    await f.curator.runNow("taki");
    expect(model.doGenerateCalls).toHaveLength(1);
    const submitted = JSON.stringify(model.doGenerateCalls);
    expect(submitted).toContain("Visible world fact"); expect(submitted).toContain("Visible experience fact");
    expect(submitted).not.toContain(OBSERVATION_TEXT); expect(submitted).not.toContain(HIDDEN_TEXT);
  });
});

describe("observation policy during Run capture", () => {
  it.each([
    { name: "explicit pin", policy: { layerId: "relationship", visibility: "pinned" as const, importance: 8 } },
    { name: "profile importance pin", policy: { layerId: "profile", visibility: "retrieved" as const, importance: 9 } },
  ])("renders the already-bound observation as $name", async ({ policy }) => {
    const bank = observationBank({ character: policy.layerId === "relationship", policy, assessed: true }); const f = runtimeFixture(bank);
    const before = f.replica.record({ ...bank.scope, memoryId: "observation" });
    expect(before?.unit.text).toBe(OBSERVATION_TEXT);
    const runtime = f.compose();
    expect((await runtime.captureRun("taki")).assemble!("")).toContain(OBSERVATION_TEXT);
    f.remote.control.offline = true;
    expect((await runtime.captureRun("taki")).assemble!("")).toContain(OBSERVATION_TEXT);
    expect(f.replica.record({ ...bank.scope, memoryId: "observation" })).toEqual(before);
  });

  it.each([
    { name: "invalidated", invalidated: true, policy: { layerId: "profile", visibility: "pinned" as const, importance: 9 } },
    { name: "expired", policy: { layerId: "profile", visibility: "pinned" as const, importance: 9,
      retention: { kind: "expiring" as const, expiresAt: at } } },
    { name: "not required", policy: { layerId: "profile", visibility: "retrieved" as const, importance: 8 } },
    { name: "hidden", policy: { layerId: "profile", visibility: "hidden" as const, importance: 9 } },
    { name: "mood gated", policy: { layerId: "intentions", visibility: "mood-gated" as const, importance: 9, disclosure: "specific topic" } },
  ])("keeps capture available and honors the observation's $name policy", async ({ policy, ...input }) => {
    const bank = observationBank({ ...input, character: policy.layerId === "intentions", policy, assessed: true }); const f = runtimeFixture(bank);
    const run = await f.compose().captureRun("taki");
    expect(run.snapshot.providerId).toBe("hindsight"); expect(run.assemble!("")).not.toContain(OBSERVATION_TEXT);
    expect(run.assemble!("specific topic").includes(OBSERVATION_TEXT)).toBe(policy.visibility === "mood-gated");
  });
});
