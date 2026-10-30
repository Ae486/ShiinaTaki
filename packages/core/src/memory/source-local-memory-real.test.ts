import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { LanguageModel } from "ai";
import { expect, it, vi } from "vitest";
import { createChatAgent, CANONICAL_MEMORY_SYSTEM_PROMPT } from "../agents/chat-agent.ts";
import { createCanonicalIngestionRepo } from "../db/canonical-ingestion-repo.ts";
import { createCanonicalMemoryAuthorityRepo } from "../db/canonical-memory-authority-repo.ts";
import { createCanonicalMemoryMaintenanceRepo } from "../db/canonical-memory-maintenance-repo.ts";
import { createCanonicalMemoryRepo } from "../db/canonical-memory-repo.ts";
import { createCanonicalMemorySparseRepo } from "../db/canonical-memory-sparse-repo.ts";
import { createMemoryAutoRepo } from "../db/memory-auto-repo.ts";
import { createMemoryEventsRepo } from "../db/memory-events-repo.ts";
import { createGovernancePolicyRepo } from "../governance/governance-policy-repo.ts";
import { createGovernancePolicyService } from "../governance/governance-policy-service.ts";
import { createCoreToolGovernanceAdapter } from "../governance/core-tool-governance-adapter.ts";
import { createReadFileTool } from "../workspace/read-file-tool.ts";
import { createWorkspacePaths } from "../workspace/workspace-paths.ts";
import { coWatchingFixture } from "../testing/co-watching-fixture.ts";
import { createCaptureLogger } from "../testing/capture-logger.ts";
import { scriptedGenerateModel, scriptedModel } from "../testing/mock-language-model.ts";
import { openSourceLiveEvidence } from "../testing/source-live-evidence.ts";
import { createCanonicalLocalIngestion } from "./canonical-local-ingestion.ts";
import { createLocalMemoryProvider } from "./local-memory-provider.ts";
import { createIntlSegmenterTokenizer } from "./search-tokenizer.ts";
import { createUtilitySlot } from "./utility-slot.ts";
import { SanitizedCommittedSpanSchema, type PrimaryConversationCommit } from "./canonical-ingestion-source.ts";

const USER = "请记住：视频里的林述说‘我被裁员了，我的项目也停了’，那是他的经历。我本人没有被裁员，但是我的‘星河’项目停了。以后聊到我的工作，请保留这个区别。";
const REPLY = "我分清楚了：林述在视频里讲的是他被裁员、项目停止；你本人没有被裁员，但你的‘星河’项目停了。";
const PATHS = ["packages/core/src/memory/source-local-memory-real.test.ts", "packages/core/src/memory/canonical-local-ingestion.ts",
  "packages/core/src/memory/canonical-ingestion-model.ts", "packages/core/src/memory/canonical-ingestion-source.ts",
  "packages/core/src/memory/canonical-local-ingestion-batch.ts", "packages/core/src/memory/local-memory-provider.ts",
  "packages/core/src/memory/write-convention.ts", "packages/core/src/memory/memory-flush-port.ts",
  "packages/core/src/db/canonical-ingestion-source-repo.ts", "packages/core/src/agents/source-interpretation.ts",
  "packages/core/src/agents/chat-agent.ts", "packages/core/src/testing/co-watching-fixture.ts",
  "packages/core/src/workspace/read-file-tool.ts"];
type Fixture = Awaited<ReturnType<typeof coWatchingFixture>>;

function localMemory(f: Fixture, model: LanguageModel) {
  const authority = createCanonicalMemoryAuthorityRepo(f.db);
  const epoch = authority.initializeLocalAuthority(new Date().toISOString());
  for (const [bankId, characterId] of [["global", null], ["character:taki", "taki"]] as const) {
    authority.createBank({ authorityEpochId: epoch.epochId, bankId,
      scope: characterId === null ? { kind: "global", characterId: null } : { kind: "character", characterId },
      name: bankId, disposition: { skepticism: 3, literalism: 3, empathy: 3 }, mission: "Isolated synthetic source acceptance", config: {} });
  }
  const tokenizer = createIntlSegmenterTokenizer({ stoplist: true });
  const maintenance = createCanonicalMemoryMaintenanceRepo(f.db, tokenizer);
  const provider = createLocalMemoryProvider({ authority, maintenance, tokenizer,
    records: createCanonicalMemoryRepo(f.db), sparse: createCanonicalMemorySparseRepo(f.db) });
  const logger = createCaptureLogger().logger;
  const slot = createUtilitySlot({ mainModel: model, logger });
  const journal = createCanonicalIngestionRepo({ db: f.db, maintenance });
  const ingestion = createCanonicalLocalIngestion({ provider, authority, maintenance, journal, timeline: f.timeline,
    autoState: createMemoryAutoRepo(f.db), events: createMemoryEventsRepo(f.db), slot });
  ingestion.initializeBaseline("taki");
  return { authority, epoch, maintenance, provider, slot, journal, ingestion, logger };
}

async function primaryTurn(f: Fixture, local: ReturnType<typeof localMemory>) {
  const commits: PrimaryConversationCommit[] = [];
  const model = scriptedModel([
    { kind: "tool", toolCallId: "read-source", toolName: "read_file", input: { path: "tool-only.txt" } },
    { kind: "text", deltas: [REPLY] },
  ]);
  writeFileSync(join(f.workspaceRoot, "tool-only.txt"), "EXCLUDED_TOOL_MARKER: external file content is not user biography.", "utf8");
  const governance = createGovernancePolicyService(createGovernancePolicyRepo(f.db));
  const agent = createChatAgent({ model, store: f.store, memory: f.memory, effectLifecycle: f.effects,
    coreTools: createReadFileTool({ paths: createWorkspacePaths({ root: f.workspaceRoot }), logger: local.logger }),
    coreToolGovernance: createCoreToolGovernanceAdapter(governance, randomUUID()),
    onPrimaryCommitted(input) { local.ingestion.recordPrimaryCommitted(input); commits.push(input); } });
  const id = randomUUID();
  const admitted = await f.runs.admit({ triggerRequestId: id, idempotencyKey: id, characterId: "taki", initiator: "primary",
    provenance: { provider: "chat" }, deliveryClass: "class_a", contextMode: "primary" });
  f.runs.start(admitted.run.runId, admitted.attempt.attemptId);
  let text = "";
  for await (const delta of agent.stream({ characterId: "taki", message: USER }, {
    runId: admitted.run.runId, attemptId: admitted.attempt.attemptId,
    runContext: { ...f.runs.context(admitted.run.runId), tools: {}, memoryTools: {}, memoryPrompt: CANONICAL_MEMORY_SYSTEM_PROMPT,
      assembleMemory: () => "Isolated synthetic source acceptance. No prior user memories." },
  })) text += delta;
  f.runs.settle(admitted.run.runId, admitted.attempt.attemptId, "completed", { retryable: false });
  expect(text).toBe(REPLY); expect(commits).toHaveLength(1);
  expect(commits[0]!.entries.map((entry) => entry.role)).toEqual(["user", "assistant", "tool", "assistant"]);
  expect(model.doStreamCalls).toHaveLength(2);
  return { commits, text, modelCalls: model.doStreamCalls.length, answerProducer: "scripted; not a real primary semantic trial" };
}

async function runLocalMemory(model: LanguageModel, save?: (name: string, value: unknown) => void) {
  const f = await coWatchingFixture();
  const local = localMemory(f, model);
  let stage = "seed-private-and-publication";
  const evidence = () => ({ stage, utilityUsage: local.slot.usage(),
    primaryWitnesses: f.db.prepare("SELECT timeline_seq,entry_id,entry_digest,run_id,committed_through_seq FROM canonical_memory_primary_commits").all(),
    timeline: f.timeline.latestAscending("taki", 20),
    privateMessages: f.db.prepare("SELECT role,content FROM run_messages ORDER BY seq").all(),
    spans: f.db.prepare("SELECT source_json,gate_json,extraction_json,state FROM canonical_memory_ingestion_spans").all(),
    sources: f.db.prepare("SELECT bank_id,retained_text,metadata_json FROM canonical_memory_sources").all(),
    memories: local.maintenance.list({ epochId: local.epoch.epochId, characterId: "taki" }) });
  try {
    f.plans[0]!.text = "EXCLUDED_PUBLICATION_MARKER";
    f.start(); await vi.waitFor(() => expect(f.session().status).toBe("ready"));
    f.playback.sample.state = "playing"; f.playback.sample.positionSeconds = 12; f.runtime.playbackChanged();
    await vi.waitFor(() => expect(f.session().sentCount).toBe(1));
    f.runtime.stop("taki", f.session().sessionId);
    expect(f.db.prepare("SELECT count(*) AS n FROM canonical_memory_primary_commits").get()?.n).toBe(0);
    expect(f.db.prepare("SELECT count(*) AS n FROM run_messages").get()?.n).toBeGreaterThan(0);
    const primary = await primaryTurn(f, local);
    stage = "primary-committed"; save?.(`${stage}.json`, { ...evidence(), primary });
    const throughSeq = f.timeline.latestSeq("taki");
    expect(evidence().primaryWitnesses.map((row) => row.timeline_seq)).not.toContain(1);
    const flush = await local.ingestion.flushPort.prepareRetirement({ characterId: "taki", fromSeq: 1, throughSeq, operationId: randomUUID() });
    stage = "flush-settled"; save?.(`${stage}.json`, { ...evidence(), flush });
    expect(flush.status).toBe("success"); expect(local.slot.usage().calls).toBe(2);
    const state = evidence(); expect(state.spans).toHaveLength(1);
    const source = SanitizedCommittedSpanSchema.parse(JSON.parse(String(state.spans[0]!.source_json)));
    expect(source.messages.map((message) => message.text)).toEqual([USER, REPLY]);
    expect(source.excludedRows).toBe(2);
    expect(JSON.stringify(state.spans)).not.toContain("EXCLUDED_");
    expect(JSON.stringify(state.sources)).not.toContain("EXCLUDED_");
    expect(state.sources.length).toBeGreaterThan(0);
    expect(state.sources.every((row) => row.retained_text === `${USER}\n${REPLY}`)).toBe(true);
    const recall = [];
    for (const bank of local.authority.listBanks(local.epoch.epochId)) {
      recall.push(await local.provider.recall({ authorityEpochId: local.epoch.epochId, requestId: randomUUID(), actor: "foreground-agent" },
        { bankId: bank.bankId, query: "星河 项目", queryTimestamp: null, budget: "low", limit: 10, maxTokens: 1000,
          factTypes: ["experience", "world"], layerIds: [], includeInvalidated: false }));
    }
    expect(recall.every((result) => result.ok)).toBe(true);
    expect(recall.some((result) => result.ok && result.data.returned > 0)).toBe(true);
    expect(state.memories.some((record) => record.unit.text.includes("星河"))).toBe(true);
    expect(state.memories.every((record) => record.policy.visibility !== "hidden")).toBe(true);
    stage = "completed";
    return { ...evidence(), primary, flush, recall, scriptedPrivatePreparationCalls: f.generate.mock.calls.length,
      nativeHindsight: "external unverified dependency; not invoked" };
  } catch (error) { save?.("failure.json", evidence()); throw error; }
  finally { await local.slot.stop(); await f.cleanup(); }
}

it("uses real primary commit witnesses and flush/recall while excluding private, tool and publication material", async () => {
  const model = scriptedGenerateModel([
    { kind: "text", deltas: [JSON.stringify({ decision: "keep", route: "character", fromSeq: 2, throughSeq: 5 })] },
    { kind: "text", deltas: [JSON.stringify([{ layer: "episodes", content: "我记得用户说自己的星河项目停了，但本人没有被裁员；被裁员的是视频中的林述。", importance: 5, disclosure: "星河项目停了" }])] },
  ]);
  const result = await runLocalMemory(model);
  expect(model.doGenerateCalls).toHaveLength(2);
  expect(JSON.stringify(model.doGenerateCalls)).not.toContain("EXCLUDED_");
  expect(result.utilityUsage.usageUnknown).toBe(0);
});

it.skipIf(process.env.TAKI_E2E_REAL_SOURCE_MEMORY !== "1")("observes one real Local gate and extraction followed by actual recall", async () => {
  const live = await openSourceLiveEvidence({ maxRequests: 4, paths: PATHS, deadlineMs: 300_000 });
  let completed = false;
  try { live.save("result.json", await runLocalMemory(live.model, live.save)); completed = true; }
  finally { await live.close({ completed, logicalGenerationsLimit: 2, primaryAnswer: "scripted",
    privatePublicationToolSources: "isolated synthetic fixtures", semanticReview: "Review retained facts and recall against source subjects." }); }
}, 360_000);
