/**
 * INPUT: actual committed invitation and accepted session projections from the Core
 * OUTPUT: contextual accept/defer/Stop controls and exact private-child navigation in Chat
 * POS: Desktop Chat adjunct — detection alone renders no invitation or persistent start button
 */
import type { CoWatchingSession } from "@taki/shared";
import { ActionButton } from "@/windows/home/action-button.js";
import { useCoWatchingInvitation } from "./use-co-watching-invitation.ts";

const STATUS: Record<CoWatchingSession["status"], string> = {
  starting: "正在开始共看", analyzing: "正在分析视频，可以继续聊天", reading: "正在读取分析", preparing: "正在准备回应",
  ready: "共看中，回应会随播放出现", revising: "正在调整后续回应", stopped: "共看已停止", failed: "本次共看未能继续",
  paused_child: "子代理已停止，等待你明确继续",
};
export function ChatCoWatchingInvitation() {
  const { state, controller, openChild, available, connected } = useCoWatchingInvitation();
  const { invitation, session } = state;
  const active = session && session.status !== "stopped" && session.status !== "failed";
  if (!invitation && !active && !state.error && !state.commandError) return null;
  return <section className="space-y-2 rounded-xl border border-border bg-surface p-3" aria-label="共看视频">
    {invitation && !active && <>
      <p className="text-sm text-text-strong">{invitation.title}</p>
      <div className="flex gap-2">
        <ActionButton tone="primary" disabled={!available} busy={state.pending}
          onClick={() => void controller.respond(invitation, "accept")}>一起看</ActionButton>
        <ActionButton disabled={!available} onClick={() => void controller.respond(invitation, "defer")}>暂时不看</ActionButton>
      </div>
    </>}
    {active && <div className="flex flex-wrap items-center justify-between gap-3">
      <p role="status" className="text-xs text-text-body">{session.title} · {STATUS[session.status]}</p>
      {session.subagentId && <ActionButton onClick={openChild}>查看子代理工作</ActionButton>}
      <ActionButton disabled={!connected || state.pending} onClick={() => void controller.stop(session.sessionId)}>停止共看</ActionButton>
    </div>}
    {state.stale && <p className="text-xs text-text-secondary">正在确认最新状态</p>}
    {(state.error || state.commandError) && <div role="alert" className="text-xs text-danger">
      <p>{[state.commandError, state.error].filter(Boolean).join(" ")}</p>
      <ActionButton tone="link" disabled={!connected || state.pending} onClick={() => void controller.refresh()}>刷新状态</ActionButton>
    </div>}
  </section>;
}
