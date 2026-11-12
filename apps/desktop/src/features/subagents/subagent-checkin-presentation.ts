/**
 * INPUT: trusted Core event identity and retained, possibly incomplete checkpoint body
 * OUTPUT: readable system snapshot or explicit raw fallback without changing canonical evidence
 * POS: ui/subagents — presentation only; worker-authored body text never establishes system attribution
 */
import type { SubagentConversationEntry } from "@taki/shared";

type EventEntry = Extract<SubagentConversationEntry, { kind: "event" }>;
const MAX_SNAPSHOT_CHARS = 64_000;

export function subagentCheckInPresentation(entry: EventEntry) {
  const event = entry.event;
  if (event.kind !== "needs_input" || !/^checkin:(0|[1-9]\d*)$/.test(event.producerKey)) return undefined;
  const body = event.body;
  const text = entry.body ? undefined : readableSnapshot(body);
  const explanation = entry.body ? "系统进度检查快照尚未完整读取。请读取完整正文后核对。"
    : "系统进度检查快照无法完整解读，不能据此确认具体进度。";
  return { sender: "系统", detail: "进度检查 · 系统事实快照", text: text ?? [explanation,
    body === null ? "正文暂不可用。" : `保留的正文${entry.body ? "预览" : ""}：\n\n    ${body.replaceAll("\n", "\n    ")}`].join("\n\n") };
}

function readableSnapshot(body: string | null): string | undefined {
  if (body === null || body.length > MAX_SNAPSHOT_CHARS) return undefined;
  let value: unknown;
  try { value = JSON.parse(body); } catch { return undefined; }
  if (!record(value) || value.reportKind !== "Core progress snapshot" || !count(value.completedModelSteps)
    || !count(value.pendingInputs) || (value.requiredActor !== "user" && value.requiredActor !== "parent_or_user")
    || !Array.isArray(value.recentToolEvidence) || value.recentToolEvidence.length > 4
    || !value.recentToolEvidence.every(record)) return undefined;
  const latest = evidenceText(value.latestWorkerText, 3000);
  const summary = evidenceText(value.olderTaskSummary, 2000);
  if (latest === undefined || summary === undefined) return undefined;
  const actor = value.requiredActor === "user" ? "此检查点需要你明确决定，主助手无法代为放行。"
    : "主助手或你可以明确继续此检查点。";
  return ["这是系统根据已保存证据整理的进度检查快照，不代表工作完成。",
    `记录时已完成 ${value.completedModelSteps} 个模型步骤；${value.pendingInputs} 条输入尚未纳入模型请求。`,
    actor,
    latest ? `最近的子代理文字：\n\n${quote(latest)}` : "没有可用的近期子代理文字。",
    summary ? `较早的工作摘要（历史记录）：\n\n${quote(summary)}` : null,
    value.recentToolEvidence.length ? `已保留 ${value.recentToolEvidence.length} 项近期工具证据，可在对应工具记录中核对。` : null,
    "剩余工作尚未由此快照确认。继续权限和执行状态请以当前工作控制为准。",
  ].filter((part) => part !== null).join("\n\n");
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function count(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function evidenceText(value: unknown, limit: number): string | null | undefined {
  if (value === null) return null;
  return record(value) && typeof value.text === "string" && value.text.length <= limit ? value.text : undefined;
}

function quote(text: string): string {
  return text.split("\n").map((line) => `> ${line}`).join("\n");
}
