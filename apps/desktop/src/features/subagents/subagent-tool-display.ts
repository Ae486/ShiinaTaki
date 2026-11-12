/**
 * INPUT: canonical delegation output or its compact model-facing projection
 * OUTPUT: readable acknowledgement and exact navigation target without internal receipt dumps
 * POS: ui/subagents — semantic tool presentation only; navigation never submits work
 */
import { SubagentControlResultSchema, SubagentSummarySchema, SubagentTargetSchema, type TimelineToolOutput } from "@taki/shared";
import { ACTIVE_CHARACTER_ID } from "@/lib/active-character.js";
import { CHILD_STATE } from "./subagent-labels.ts";
import type { SubagentNavigationTarget } from "./subagent-navigation.ts";

const TOOLS = new Set(["delegate_subagent", "send_subagent_message", "stop_subagent", "inspect_subagent", "complete_subagent", "interact_parent"]);
export function isSubagentTool(name: string): boolean { return TOOLS.has(name); }
export interface SubagentToolDisplay { details: string; target?: SubagentNavigationTarget }

export function subagentToolDisplay(input: unknown): SubagentToolDisplay {
  let value = input;
  if (typeof value === "string") { try { value = JSON.parse(value); } catch { return { details: "工作操作已返回，详情可在子代理会话中查看。" }; } }
  const parsed = SubagentControlResultSchema.safeParse(value);
  if (parsed.success) {
    const { conversation, input: accepted, cancellationRequested } = parsed.data;
    return { details: `${conversation.label} · ${CHILD_STATE[conversation.state]}\n${cancellationRequested ? "已请求停止，等待执行结束。" : accepted ? "输入已接收，执行状态以会话为准。" : "当前工作状态已返回。"}`,
      target: { characterId: conversation.characterId, subagentId: conversation.subagentId,
        workInputId: accepted?.workInputId ?? conversation.activeWorkInputId ?? conversation.latestWorkInputId ?? undefined } };
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return { details: "工作操作的结果暂不可确认，请查看子代理会话。" };
  const record: Record<string, unknown> = Object.fromEntries(Object.entries(value));
  if (record.proposed === true && record.accepted === false) return { details: "报告已提出，等待本轮结果保存后确认接收。" };
  const target = SubagentTargetSchema.safeParse(record.target);
  const state = SubagentSummarySchema.shape.state.safeParse(record.state);
  if (typeof record.worker === "string" && state.success) return {
    details: `${record.worker} · ${CHILD_STATE[state.data]}`,
    ...(target.success ? { target: { characterId: ACTIVE_CHARACTER_ID, subagentId: target.data.subagentId, workInputId: target.data.workInputId } } : {}),
  };
  return { details: typeof record.message === "string" ? record.message : "工作记录已返回；完整内容可在子代理会话中查看。" };
}

export function subagentOutputNavigation(output?: TimelineToolOutput): SubagentNavigationTarget | undefined {
  if (!output || output.type === "execution-denied") return undefined;
  return subagentToolDisplay(output.value).target;
}
