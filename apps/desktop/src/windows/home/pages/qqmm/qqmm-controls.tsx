/**
 * INPUT: current shared session, finite action support, operation/QR and artifact state.
 * OUTPUT: supported controls, truthful discovery/summary facts and explicit impact confirmation.
 * POS: Home QQ controls; no direct native requests, polling or stored QR material.
 */
import { useCallback, useEffect, useState } from "react";
import type { ManagementController, ManagementState, QqSessionSnapshot } from "@qqmm/management-client";
import { Dialog } from "@/components/ui/dialog.js";
import { FeedbackLine } from "@/components/ui/feedback-line.js";
import { ActionButton } from "../../action-button.tsx";
import { PageCard } from "../../page-card.tsx";
import { QqmmSecrets } from "./qqmm-secrets.tsx";
import { actionLabel, actionReason, artifactLines, CONTROL_CONFIRMATION, discoveryLines, managementDate, operationLabel, sessionLabel } from "./qqmm-management-labels.ts";

type ControlsProps = { state: ManagementState; controller: ManagementController };
export function QqmmControls({ state, controller }: ControlsProps) {
  const session = state.connection === "connected" ? state.session : null;
  return <section aria-label="连接管理"><PageCard title="连接管理" action={
    <ActionButton disabled={state.connection !== "connected" || state.controlsLoading} busy={state.controlsLoading} onClick={() => void controller.refreshControls()}>刷新状态</ActionButton>
  }><div className="grid gap-3">
    {!session && <FeedbackLine tone="info">{state.connection === "connected" ? state.controlsError ? "连接状态暂不可用。" : "正在读取连接状态…" : "连接恢复后可管理采集。"}</FeedbackLine>}
    {session && <><SessionFacts session={session} /><ControlActions key={`${session.backend}:${controlAccount(state) ?? ""}`} state={state} controller={controller} session={session} />
      {state.monitor?.summary && <p className="text-xs text-text-secondary">摘要：等待 {state.monitor.summary.queued} 项，处理中 {state.monitor.summary.running} 项，失败 {state.monitor.summary.failed} 项。</p>}
      {session.backend === "direct" && <div className="grid gap-1 text-xs text-text-secondary">{artifactLines(state.artifact).map((line) => <p key={line}>{line}</p>)}</div>}
      <SessionQr session={session} /><QqmmSecrets state={state} controller={controller} /></>}
    {state.controlsError && <FeedbackLine tone="warn">{state.controlsError}</FeedbackLine>}
    {state.control.message && <FeedbackLine tone={state.control.status === "succeeded" ? "ok" : "warn"}>{state.control.message}</FeedbackLine>}
  </div></PageCard></section>;
}
function SessionFacts({ session }: { session: QqSessionSnapshot }) {
  const operation = session.currentOperation ?? session.lastOperation;
  return <div role="status" className="grid gap-1 text-xs text-text-secondary">
    <p className="font-medium text-text-body">{sessionLabel(session)}</p>
    {discoveryLines(session).map((line) => <p key={line}>{line}</p>)}
    {operation && <p>{`${session.currentOperation ? "当前操作" : "最近操作"} · ${operationLabel(operation)}`}</p>}
  </div>;
}
function SessionQr({ session }: { session: QqSessionSnapshot }) {
  const qr = session.qr;
  if (!qr) return null;
  if (qr.state === "unavailable") return <FeedbackLine tone="warn">当前登录二维码无法显示，请检查本机接入组件。</FeedbackLine>;
  return <figure className="grid justify-items-start gap-2 rounded-md border border-border bg-surface-muted p-3">
    <img src={qr.qrCode} width={200} height={200} alt="QQ 登录二维码" className="max-w-full bg-white p-2" />
    <figcaption className="text-xs text-text-secondary">请使用 QQ 扫码。有效至 {managementDate(qr.expiresAt)}；登录结束后自动清除。</figcaption>
  </figure>;
}
function ControlActions({ state, controller, session }: ControlsProps & { session: QqSessionSnapshot }) {
  const [confirmation, setConfirmation] = useState<"logout" | "restart" | null>(null);
  const closeConfirmation = useCallback(() => setConfirmation(null), []);
  const account = controlAccount(state);
  const busy = state.control.status === "pending" || state.control.status === "observing";
  useEffect(() => { if (busy || confirmation === "logout" && !session.actions.logout.enabled) setConfirmation(null); }, [busy, confirmation, session.actions.logout.enabled]);
  const run = (action: "start" | "stop" | "logout") => action === "logout" ? setConfirmation(action) : void controller.runControl(action);
  const confirm = () => {
    const current = controller.getState();
    if (confirmation && current.session?.backend === session.backend && controlAccount(current) === account) void controller.runControl(confirmation);
    closeConfirmation();
  };
  return <>
    <div className="flex flex-wrap gap-3">{(["start", "stop", "logout"] as const).filter((action) => session.actions[action].supported).map((action) => <div key={action} className="grid gap-1">
      <ActionButton tone={action === "logout" ? "danger-soft" : "secondary"} disabled={busy || !session.actions[action].enabled} onClick={() => run(action)}>{actionLabel(action, session.backend)}</ActionButton>
      {!session.actions[action].enabled && <span className="text-xs text-text-secondary">{actionReason(session.actions[action].reason)}</span>}
    </div>)}
      {session.authAcquisition && <ActionButton disabled={busy} onClick={() => void controller.runControl("acquire")}>获取 Direct 授权</ActionButton>}
      <ActionButton disabled={busy} onClick={() => setConfirmation("restart")}>重启本机监控</ActionButton>
    </div>
    <Dialog open={confirmation !== null && !busy} onClose={closeConfirmation} ariaLabel="确认连接操作">
      <h2 className="pr-7 text-sm font-semibold text-text-strong">{confirmation === "logout" ? "退出 QQ 登录" : "重启本机监控"}</h2>
      <p className="my-4 text-xs text-text-body">{confirmation && CONTROL_CONFIRMATION[confirmation]}</p>
      <div className="flex justify-end gap-2"><ActionButton onClick={closeConfirmation}>取消</ActionButton><ActionButton tone="danger-soft" onClick={confirm}>确认继续</ActionButton></div>
    </Dialog>
  </>;
}
function controlAccount(state: ManagementState): string | null { return state.settings?.config.account.targetSelfUin ?? state.monitor?.account ?? null; }
