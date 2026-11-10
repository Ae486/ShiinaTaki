import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, it } from "vitest";
import { SUBAGENT_METHODS, SubagentControlResultSchema, type SubagentSummary } from "@taki/shared";
import { withScriptedAgentContextScenario } from "./fixture/agent-context-scenario.ts";
import { scriptedInboxReply } from "./fixture/agent-context-inbox.ts";
import { startScriptedProvider } from "./fixture/scripted-provider.ts";

const STOP_WORK = "UPGRADE_STOP_WORK_317";
const CONTINUED = "UPGRADE_CONTINUED_419";
const NEW_WORK = "UPGRADE_NEW_WORK_523";
const PUBLIC_RESULT = "UPGRADE_PARENT_RECEIVED_631";
const missingTables = ["subagent_context_summary_intents", "subagent_context_summary_failures",
  "subagent_context_summaries", "subagent_tool_results", "subagent_speech_publications", "subagent_event_frontiers"];

it("upgrades the early applied inbox schema before new delegation, Stop, Continue and parent delivery", async () => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  let stopRequests = 0;
  let delegatedStop = false;
  let delegatedNew = false;
  const provider = await startScriptedProvider(async (request, index) => {
    if (index >= 24) throw new Error("upgrade scenario request budget exceeded");
    if (request.stream !== true) return { text: "{}" };
    const content = JSON.stringify(request.messages);
    if (toolNames(request).includes("complete_subagent")) {
      if (content.includes(STOP_WORK)) {
        stopRequests++;
        if (stopRequests === 1) { await held; return { text: "This original request was cancelled by the user." }; }
        expect(stopRequests).toBe(2);
        expect(content).toContain(CONTINUED);
        return { calls: [{ name: "complete_subagent", arguments: { text: CONTINUED, materials: [] } }] };
      }
      expect(content).toContain(NEW_WORK);
      return { calls: [{ name: "complete_subagent", arguments: { text: PUBLIC_RESULT, materials: [] } }] };
    }
    const inbox = scriptedInboxReply(request, (text) => {
      expect(text).toContain(PUBLIC_RESULT);
      return { kind: "speech_proposed", note: PUBLIC_RESULT };
    });
    if (inbox) return inbox;
    const delegate = (direction: string, completionPolicy: "record_only" | "request_parent") => ({
      calls: [{ name: "delegate_subagent", arguments: { label: direction, subagentId: null, direction,
        context: { kind: "fresh" }, completionPolicy,
        toolSelection: { mode: "allow", names: ["complete_subagent"] }, materials: [] } }],
    });
    if (content.includes(NEW_WORK) && !delegatedNew) { delegatedNew = true; return delegate(NEW_WORK, "request_parent"); }
    if (content.includes(STOP_WORK) && !delegatedStop) { delegatedStop = true; return delegate(STOP_WORK, "record_only"); }
    return { text: "The requested independent work has been accepted." };
  });
  try {
    await withScriptedAgentContextScenario({ name: "legacy-delegation-upgrade", providerBaseUrl: provider.baseUrl,
      evidenceRoot: process.env.TAKI_E2E_EVIDENCE_DIR ?? join(tmpdir(), "taki-delegation-upgrade"),
      maxUpstreamRequests: 24, sessionDeadlineMs: 120_000, mainMaxSteps: null,
      seedThroughMigration: 68, seed: seedEarlySchema }, async (scenario) => {
      expect(provider.requests).toHaveLength(0);
      expect(scenario.rows("SELECT version FROM migrations WHERE version=69")).toHaveLength(1);
      const tables = new Set(scenario.rows("SELECT name FROM sqlite_schema WHERE type='table'").map((row) => row.name));
      for (const table of missingTables) expect(tables.has(table)).toBe(true);
      expect(scenario.rows("PRAGMA foreign_key_check")).toEqual([]);

      await scenario.ask(`Create one independent private worker for ${STOP_WORK}.`);
      await expect.poll(() => stopRequests, { timeout: 15_000 }).toBe(1);
      const first = (await scenario.list()).entries.find((child) => child.label === STOP_WORK)!;
      expect(first.activeRunId).toEqual(expect.any(String));
      const originalRun = first.activeRunId;
      const originalWork = first.activeWorkInputId;
      SubagentControlResultSchema.parse(await scenario.rpc(SUBAGENT_METHODS.stop, { characterId: "taki", target: target(first) }));
      await expect.poll(async () => (await scenario.history(first.subagentId)).conversation.activeRunId,
        { timeout: 15_000 }).toBeNull();
      release();
      const stopped = (await scenario.history(first.subagentId)).conversation;
      expect(stopped.stopOrigin).toBe("user");
      SubagentControlResultSchema.parse(await scenario.rpc(SUBAGENT_METHODS.continue, { characterId: "taki",
        target: target(stopped), operationKey: randomUUID(), direction: CONTINUED, materials: [] }));
      await expect.poll(async () => (await scenario.history(first.subagentId)).results.some((result) =>
        result.result.child.outputKind === "validated" && result.result.child.body === CONTINUED), { timeout: 20_000 }).toBe(true);
      const continued = await scenario.history(first.subagentId);
      expect(continued.conversation).toMatchObject({ activeRunId: null, stopOrigin: null });
      expect(continued.results.some((result) => result.result.child.runId === originalRun
        && result.result.child.outcome === "cancelled")).toBe(true);
      expect(new Set(continued.executions.map((execution) => execution.workInputId))).toEqual(new Set([originalWork]));
      expect(new Set(continued.executions.map((execution) => execution.runId)).size).toBe(2);
      scenario.checkpoint("upgraded-private-stop-and-continue", { stopRequests, continued });

      await scenario.ask(`Create a new independent worker for ${NEW_WORK} and report its final result to me.`);
      await expect.poll(() => scenario.rows("SELECT content FROM timeline_messages WHERE role='assistant'")
        .some((row) => row.content === PUBLIC_RESULT), { timeout: 30_000 }).toBe(true);
      const finals = scenario.rows("SELECT e.event_id,a.action_json,p.result_json FROM subagent_events e "
        + "JOIN subagent_event_actions a USING(event_id) JOIN subagent_speech_publications p USING(event_id) WHERE e.kind='final'");
      expect(finals).toHaveLength(1);
      expect(JSON.parse(String(finals[0]!.action_json))).toMatchObject({ kind: "speech_proposed", note: PUBLIC_RESULT });
      expect(JSON.parse(String(finals[0]!.result_json))).toMatchObject({ state: "sent" });
      expect((await scenario.list()).entries).toHaveLength(2);
      expect(scenario.rows("PRAGMA foreign_key_check")).toEqual([]);
      scenario.checkpoint("upgraded-new-child-and-public-delivery", { finals });
    });
    expect(provider.errors).toEqual([]);
  } finally {
    release();
    await provider.close();
  }
}, 150_000);

function seedEarlySchema(dataDir: string): void {
  const db = new DatabaseSync(join(dataDir, "taki.db"));
  try {
    db.exec("PRAGMA foreign_keys=ON; BEGIN");
    // Reproduce already-applied 058/060 with the missing CREATE-only groups, not a fresh version-zero database.
    for (const table of missingTables) db.exec(`DROP TABLE ${table}`);
    db.exec("COMMIT");
    expect(db.prepare("SELECT max(version) AS version FROM migrations").get()?.version).toBe(68);
    expect(db.prepare("SELECT version FROM migrations WHERE version IN (58,60)").all()).toHaveLength(2);
    expect(db.prepare("SELECT name FROM sqlite_schema WHERE name='model_profiles'").get()).toBeUndefined();
  } finally { db.close(); }
}

function target(child: SubagentSummary) {
  return { subagentId: child.subagentId, workInputId: child.activeWorkInputId ?? child.latestWorkInputId!,
    expectedControlVersion: child.controlVersion, expectedRunId: child.activeRunId };
}

function toolNames(request: Record<string, unknown>): string[] {
  return (request.tools as Array<{ function: { name: string } }> | undefined)?.map((tool) => tool.function.name) ?? [];
}
