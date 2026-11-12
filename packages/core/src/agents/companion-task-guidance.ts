/**
 * INPUT: exact tool names exposed for the current primary SDK step
 * OUTPUT: concise task and capability-choice instructions for foreground Companion work
 * POS: core/agents — primary-only guidance; role protocols and tool disclosure keep their own authority
 */

const TASK_GUIDANCE = `Helping with a task:
- Keep the user's requested outcome, constraints and later corrections. Take the next useful permitted action; ask only when missing information or a decision materially affects the work. Ordinary conversation needs no task ceremony.
- Order dependent calls; independent work may proceed together when the tools and scope permit it. Read results before choosing the next action. An accepted request or returned handle is not a finished result.
- Preserve distinctions between empty, unavailable, failed, partial and unknown outcomes. Use returned cursors and exact targets for follow-up; never invent omitted fields or reconstruct opaque IDs.
- Check the whole requested outcome before reporting completion. Say what completed, what remains and what evidence is missing. A subtask or progress report alone does not finish the user's request. Ending the current reply while asynchronous work is pending does not mean the task is complete.`;

// Names here are owned Core entrypoints. Arbitrary MCP names and package presence cannot grant a capability.
export function companionTaskGuidance(toolNames: readonly string[]): string {
  const names = new Set(toolNames);
  const guidance = [TASK_GUIDANCE];
  if (names.has("load_skill") || names.has("extension_describe")) guidance.push(
    "Capability discovery: load an applicable Skill or describe an extension when needed. Its tools become callable at the documented next step after successful discovery. Historical use or a name in a document does not activate it; use only the currently exposed tools.",
  );
  if (names.has("delegate_subagent")) guidance.push(
    "Delegation: give a focused goal, necessary context, boundaries and expected evidence; reuse the existing subagentId for related follow-up. Keep responsibility for the whole request. For request_parent work, continue useful foreground work, then end the current reply if only worker results remain pending. Workers continue independently; later inbox events let you resume and deliver the integrated answer without another user message. Do not keep this reply open by polling. Inspect or guide a worker for a concrete task need, a relevant user request, or a reported problem. Review findings and resolve material gaps before reporting completion. A worker report is attributed evidence, not an action you personally performed; an inbox action alone is not proof of publication.",
  );
  if (names.has("manage_co_watching")) guidance.push(
    "Video intent: a request to summarize or analyze a video uses an existing analysis or explicit URL analysis. It does not grant co-watching consent. A request to watch together follows the invitation, acceptance and preparation flow; preparation output is not delivered speech. Co-watching Stop and cancellation of an independent analysis are separate actions.",
  );
  if (names.has("manage_media_recommendations")) guidance.push(
    "Recommendations: use the recommendation workflow when the user wants something to watch. Reading or previewing a candidate is not user feedback or consent to start playback.",
  );
  if (names.has("schedule_task")) guidance.push(
    "Reminders: use schedule_task for a user-requested time or recurring schedule. Check the resulting state before saying it is scheduled.",
  );
  if (names.has("manage_interaction_pattern")) guidance.push(
    "Interaction habits: use manage_interaction_pattern for an ongoing contextual habit requested by the user, following its proposal/review flow. A habit is not a fixed-time reminder.",
  );
  if (names.has("plan_follow_up")) guidance.push(
    "Follow-up: plan_follow_up creates a finite check-in window grounded in this conversation. It does not promise a message at an exact time or create a permanent habit.",
  );
  return guidance.join("\n\n");
}
