/**
 * INPUT:  accepted MCP action starts, retained diagnostics and current-client settled outcomes.
 * OUTPUT: once-only floating mutation feedback and lasting error/test details for the page.
 * POS:    Home MCP feedback adapter; no list echo, render, or draft updater can enqueue a notice.
 */
import { useCallback, useRef, useState } from "react";
import { dismissToastGroup, pushToast, type ToastTone } from "@/components/toast/toast-store.js";
import type { McpFeedback } from "./mcp-state.ts";

export function useMcpFeedback() {
  const [feedback, setFeedback] = useState<McpFeedback | null>(null);
  const attempt = useRef<{ eventKey: object; replaceKey: string; serverId: string } | null>(null);
  const started = useCallback((key: string) => {
    const serverId = key.slice(key.indexOf(":") + 1);
    const replaceKey = `mcp:${serverId}`;
    dismissToastGroup(replaceKey);
    attempt.current = { eventKey: {}, replaceKey, serverId };
    setFeedback(null);
  }, []);
  const report = useCallback((next: McpFeedback) => {
    setFeedback(next.kind === "saved" ? null : next);
    const event = attempt.current;
    if (!event) return;
    attempt.current = null;
    const notice = mcpNotice(next, event.serverId);
    pushToast(notice.message, notice.tone, event);
  }, []);
  const reset = useCallback(() => { attempt.current = null; setFeedback(null); }, []);
  return { feedback, started, report, reset, retain: setFeedback };
}

function mcpNotice(feedback: McpFeedback, serverId: string): { message: string; tone: ToastTone } {
  if (feedback.kind === "saved") return { message: feedback.message, tone: "success" };
  if (feedback.kind === "tested") return { message: `${serverId} 测试通过，诊断结果已更新。`, tone: "success" };
  if (feedback.kind === "test-failed") return { message: `${serverId} 测试失败，请查看诊断结果。`, tone: "error" };
  if (feedback.kind === "conflict" || feedback.kind === "refused") return { message: `${serverId} 操作未完成，请查看服务器设置中的说明。`, tone: "warn" };
  return { message: `${serverId} 操作失败，请查看错误详情。`, tone: "error" };
}
