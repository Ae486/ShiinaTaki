/**
 * INPUT: deterministic SDK model and optional test-owned executable tools
 * OUTPUT: real SQLite/Run/Effect/ChatAgent/SubagentService composition with isolated Memory and Timeline
 * POS: core/testing — synthetic captured authority; no external provider or real-user data
 */
import { randomUUID } from "node:crypto";
import type { LanguageModel, ToolSet } from "ai";
import { RunSnapshotSchema } from "@taki/shared";
import { createChatAgent, type ChatAgentDeps } from "../agents/chat-agent.ts";
import { createTurnQueue } from "../agents/turn-queue.ts";
import { createTurnRegistry } from "../agents/turn-registry.ts";
import { createRunEventRepo } from "../db/run-event-repo.ts";
import { createRunRepo } from "../db/run-repo.ts";
import { createEffectRepo } from "../db/effect-repo.ts";
import { createSubagentRepo } from "../db/subagent-repo.ts";
import { createSubagentInputRepo } from "../db/subagent-input-repo.ts";
import { createSubagentExecutionRepo } from "../db/subagent-execution-repo.ts";
import { createRunMessageRepo } from "../db/run-message-repo.ts";
import { createRunService, type RunSnapshotCapture } from "../harness/run-service.ts";
import { createEffectLifecycleService } from "../harness/effect-lifecycle-service.ts";
import { createSubagentService } from "../harness/subagent-service.ts";
import { childMemoryExclusions, projectChildMemory } from "../harness/delegation-tools.ts";
import { createCoreToolGovernanceAdapter } from "../governance/core-tool-governance-adapter.ts";
import { createGovernancePolicyService } from "../governance/governance-policy-service.ts";
import { createGovernancePolicyRepo } from "../governance/governance-policy-repo.ts";
import { createCompanionFixture } from "./companion-fixture.ts";
import { createRunServiceStub } from "./run-service-stub.ts";
import type { UtilitySlot } from "../memory/utility-slot.ts";
import type { ToolDisclosureSnapshot } from "../extensions/tool-disclosure-snapshot.ts";
import type { TurnInteractive } from "../mcp/mcp-turn-tools.ts";

export async function subagentFixture(model: LanguageModel, options: { tools?: ToolSet; memoryTools?: ToolSet;
  agent?: Partial<ChatAgentDeps>; utility?: UtilitySlot; historyBudget?: () => number;
  toolDisclosure?: ToolDisclosureSnapshot; snapshot?: RunSnapshotCapture<TurnInteractive> } = {}) {
  const base = createCompanionFixture(); const { db } = base;
  const events = createRunEventRepo(db); const executions = createSubagentExecutionRepo(db);
  const runRepo = createRunRepo(db, events, { linkedState: executions.linkedState });
  const effects = createEffectLifecycleService(createEffectRepo(db, events), runRepo.guardDispatch);
  const runs = createRunService({ repo: runRepo, provider: "test", modelId: "test", snapshot: options.snapshot ?? {
    async capture(request, _id, capture) {
      const stub = await createRunServiceStub().admit(request);
      const memoryTools = options.memoryTools ?? base.memory.createTools(request.characterId);
      return { snapshot: RunSnapshotSchema.omit({ snapshotId: true, runId: true, capturedAt: true, manifestDigest: true }).strip().parse(stub.snapshot),
        context: { authorityCurrent: () => true, memoryTools: capture?.workScope?.kind === "subagent" ? projectChildMemory(memoryTools) : memoryTools,
          memoryToolExclusions: capture?.workScope?.kind === "subagent" ? childMemoryExclusions(memoryTools) : undefined,
          tools: options.tools ?? {}, toolDisclosure: options.toolDisclosure } };
    },
  } });
  const governance = createGovernancePolicyService(createGovernancePolicyRepo(db));
  const queue = createTurnQueue(); const turns = createTurnRegistry();
  const agent = createChatAgent({ model, memory: base.memory, store: base.conversation, effectLifecycle: effects,
    coreToolGovernance: createCoreToolGovernanceAdapter(governance, randomUUID()), maxSteps: 6, ...options.agent });
  const children = createSubagentRepo(db); const inputs = createSubagentInputRepo(db); const messages = createRunMessageRepo(db);
  const errors: string[] = [];
  const service = createSubagentService({ db, runRepo, runs, effects, agent, children, inputs, executions, messages,
    turns, queue, store: base.conversation, historyBudget: options.historyBudget ?? (() => 8000), utility: options.utility, changed: () => undefined, reportError: (code) => { errors.push(code); } });
  const id = randomUUID();
  const parent = await runs.admit({ triggerRequestId: id, idempotencyKey: id, characterId: "taki", initiator: "primary",
    deliveryClass: "class_a", contextMode: "primary", provenance: { provider: "chat" } });
  runs.start(parent.run.runId, parent.attempt.attemptId);
  return { ...base, db, runRepo, runs, effects, agent, children, inputs, executions, messages, queue, turns, service, parent, errors,
    async close() { await service.close(); base.cleanup(); } };
}
