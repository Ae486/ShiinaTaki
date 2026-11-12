/**
 * INPUT: genuine main Run/Attempt, eligible accepted events and the existing addressed-input owner
 * OUTPUT: one bounded private consumer context for foreground or idle shared-Agent execution
 * POS: core/harness — inbox adapter; Run/Effect/SQLite owners remain authoritative
 */
import type { ForegroundInboxContext, ForegroundInboxInput } from "../agents/foreground-inbox.ts";
import { createSubagentInboxTools } from "../agents/subagent-inbox-tools.ts";
import { createSubagentInboxRepo, type InboxClaim } from "../db/subagent-inbox-repo.ts";
import type { SubagentState } from "./subagent-state.ts";
import type { SubagentAddressedInput } from "./subagent-service.ts";
import { toEntryInput } from "../agents/turn-mapping.ts";
import type { SubagentControlResult, SubagentSender } from "@taki/shared";
import { recordSubagentPrimarySpeech } from "../db/subagent-speech-repo.ts";
import { createSubagentEventRepo } from "../db/subagent-event-repo.ts";
import { subagentSummary } from "./subagent-queries.ts";
import { subagentActionEvidence } from "../db/subagent-action-evidence.ts";

export function prepareSubagentInbox(state: SubagentState, input: ForegroundInboxInput & { mode?: "foreground" | "idle" },
  send: (input: SubagentAddressedInput, sender: SubagentSender, continuation: boolean) => SubagentControlResult): (ForegroundInboxContext & { consumerId: string; prepareStep(): void }) | undefined {
  const { deps } = state;
  const inbox = createSubagentInboxRepo(deps.db);
  let claim = inbox.claim({ ...input, mode: input.mode ?? "foreground" });
  if (!claim && input.mode === "idle") return undefined;
  const requireClaim = () => {
    if (!claim) throw new Error("SUBAGENT_INBOX_NOT_CLAIMED");
    return claim;
  };
  const tools = inboxBindings(state, input, { inbox, requireClaim, send });
  return {
    get consumerId() { return requireClaim().consumerId; }, tools,
    get instructions() { return inboxInstructions(claim, input.mode); },
    prepareStep() { claim ??= inbox.claim({ ...input, mode: input.mode ?? "foreground" }); },
    get sourceContext() { return { materials: (claim?.events ?? []).map((event) => ({ label: `Worker ${event.kind}`,
      reference: `agent-event:${event.eventId}#${event.bodyDigest}`, speaker: `worker:${event.subagentId}` })) }; },
    commitModelIntent(effect, stepNumber) { if (claim) inbox.commitIntent({ consumerId: claim.consumerId, effect, stepNumber }); },
    hasIntent: () => Boolean(claim && inbox.hasIntent(claim.consumerId)),
    onPublicCommitted(entries) {
      if (claim && inbox.hasIntent(claim.consumerId)) recordSubagentPrimarySpeech(deps.db, { consumerId: claim.consumerId, entries });
    },
    recordCompletedStep(step) {
      if (!claim) return;
      const messages = step.messages.map(toEntryInput).filter((entry) => entry !== null);
      if (messages.length) deps.messages.recordStep({ runId: input.runId, attemptId: step.attemptId,
        batch: { stepNumber: step.stepNumber, entryKind: "output", messages } });
    },
    dispose() { if (claim) inbox.release(claim.consumerId); },
  };
}

function inboxInstructions(claim: InboxClaim | undefined, mode?: "foreground" | "idle"): string {
  if (!claim) return "";
  const protocol = "Current inbox actions use handle_agent_event({eventId,intent,text,target}). "
    + "Choose record, ask_user or reply with target=null; use answer_child for private replies to delivered child messages/questions and continue_child for a permitted check-in with its exact current target. "
    + "Core supplies reply addressing and retry identity. Handle delivered-event answers here; send_subagent_message remains for ordinary guidance, interrupted work and inspected or silent work.\n";
  if (mode === "idle") return protocol + claim.instructions;
  return "Foreground inbox: review the relevant delivered report or question now; read exact detail when its preview is incomplete. "
    + "Use its exact event and target for supported actions. If the requested results are ready, give the integrated answer in this conversation. "
    + "If other notified workers are still needed, handle the available events, finish useful foreground work, then end the current reply with the task still pending. Later inbox events let you finish without another user message; do not poll to gather all results in this reply. "
    + "An event disposition does not publish your answer.\n" + protocol + claim.instructions;
}

function inboxBindings(state: SubagentState, input: ForegroundInboxInput & { mode?: "foreground" | "idle" },
  ports: { inbox: ReturnType<typeof createSubagentInboxRepo>; requireClaim(): InboxClaim;
    send(input: SubagentAddressedInput, sender: SubagentSender, continuation: boolean): SubagentControlResult }) {
  const { deps } = state; const { inbox, requireClaim, send } = ports;
  return createSubagentInboxTools({ actualInvocation: input.actualInvocation,
    read(eventId) {
      if (!inbox.hasIntent(requireClaim().consumerId)) throw new Error("SUBAGENT_EVENT_NOT_DELIVERED");
      const event = inbox.get(requireClaim().consumerId).events.find((event) => event.eventId === eventId);
      if (!event) throw new Error("SUBAGENT_EVENT_NOT_DELIVERED");
      const child = deps.children.get(event.subagentId);
      const action = deps.db.prepare("SELECT action_json,result_json FROM subagent_event_actions WHERE event_id=:id").get({ id: eventId });
      return { event, current: subagentSummary(state, child.subagentId), pendingRequest: createSubagentEventRepo(deps.db).wait(event.workInputId),
        target: { subagentId: child.subagentId, workInputId: event.workInputId,
        expectedRunId: child.activeRunId, expectedControlVersion: child.controlVersion },
        action: action ? JSON.stringify({ action: JSON.parse(String(action.action_json)), result: subagentActionEvidence(JSON.parse(String(action.result_json))) }) : undefined };
    },
    handle(value) {
      const receipt = inbox.action({ ...value, consumerId: requireClaim().consumerId, apply(event, operationKey) {
        if (value.action.kind !== "answered_child" && value.action.kind !== "continue_child") return { ok: true, eventId: event.eventId,
          disposition: value.action.kind, ...(value.action.kind === "speech_proposed" ? { publication: "not_published" } : {}) };
        if (value.action.target.subagentId !== event.subagentId || value.action.target.workInputId !== event.workInputId
          || (event.kind === "needs_input" && value.action.replyToEventId !== event.eventId)) throw new Error("SUBAGENT_INPUT_REQUEST_CONFLICT");
        const accepted = send({ characterId: input.characterId, target: value.action.target,
          operationKey: `inbox:${event.eventId}:${operationKey}`, direction: value.action.direction, materials: [],
          replyToEventId: value.action.replyToEventId ?? undefined }, { kind: "parent", runId: input.runId }, value.action.kind === "continue_child");
        return { ok: true, eventId: event.eventId, disposition: value.action.kind, inputId: accepted.input?.inputId };
      } });
      stageSpeech(state, input, { ...value, ...receipt });
      const event = inbox.get(requireClaim().consumerId).events.find((entry) => entry.eventId === value.eventId);
      if (event) deps.db.afterCommit(() => deps.changed(input.characterId, event.subagentId));
      return receipt.result;
    },
  });
}

function stageSpeech(state: SubagentState, input: ForegroundInboxInput & { mode?: "foreground" | "idle" },
  value: { eventId: string; operationKey: string; consumerRunId: string; action: import("@taki/shared").SubagentInboxAction }): void {
  const { deps } = state;
  if (input.mode === "idle" && value.action.kind === "speech_proposed" && deps.reports?.stageEventReply) deps.db.afterCommit(() => {
    const work = Promise.resolve().then(() => deps.reports?.stageEventReply?.({ eventId: value.eventId,
      consumerRunId: value.consumerRunId, actionId: value.operationKey })).then(() => undefined)
      .catch(() => deps.reportError("SUBAGENT_SPEECH_PUBLICATION_UNAVAILABLE")).finally(() => state.work.delete(work));
    state.work.add(work);
  });
}
