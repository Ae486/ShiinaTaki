/**
 * INPUT: scoped Shell setup and explicit Core playback observation controls
 * OUTPUT: optional browser attachment card with truthful setup, pairing and last-read source feedback
 * POS: Home Perception — no polling, automatic acceptance, credential persistence or inferred connection health
 */
import { ActionButton } from "../../action-button.tsx";
import { PageCard } from "../../page-card.tsx";
import { useBrowserAttachment } from "./use-browser-attachment.ts";

export function BrowserAttachmentCard() {
  const state = useBrowserAttachment();
  return <PageCard title="浏览器播放连接">
    <p className="mb-3 text-xs text-text-body">通过 OpenBili 扩展连接一个选中的视频，仅接收播放状态。开启此连接不会开始共看或生成点评。</p>
    <div className="flex flex-wrap gap-2">
      <ActionButton disabled={state.pending} onClick={() => void state.run("setup")}>启用本机连接</ActionButton>
      <ActionButton disabled={state.pending} onClick={() => void state.run("pair")}>读取连接信息</ActionButton>
      <ActionButton disabled={state.pending || !state.connected} onClick={() => void state.run("allow")}>允许接收播放状态</ActionButton>
      <ActionButton disabled={state.pending || !state.connected} onClick={() => void state.run("deny")}>停止接收</ActionButton>
      <ActionButton disabled={state.pending || !state.connected} busy={state.pending} onClick={() => void state.run("read")}>检查来源</ActionButton>
    </div>
    <p role="status" className="mt-3 text-xs text-text-secondary">{state.message}</p>
    {state.pair && <div className="mt-3 space-y-2">
      <label className="block text-xs text-text-body">本机连接地址
        <input className="mt-1 w-full rounded border border-border bg-surface-sunken p-2" readOnly value={state.pair.endpoint} />
      </label>
      <details key={state.pair.token} className="text-xs text-text-body">
        <summary className="cursor-pointer">显示连接凭据（仅用于扩展配对）</summary>
        <label className="mt-2 block">连接凭据：点击输入框后全选并复制
          <input className="mt-1 w-full rounded border border-border bg-surface-sunken p-2" type="text" autoComplete="off" spellCheck={false} readOnly value={state.pair.token} />
        </label>
      </details>
    </div>}
    {state.playback && <div className="mt-3 text-xs text-text-body">
      <p>上次检查：{state.playback.enabled ? "允许接收" : "已停用或处于隐私暂停"}；有效来源 {state.playback.sources.length} 个。</p>
      {state.playback.sources.map((source) => <p key={source.sourceRef}>{source.source.media.bvid} · 分P {source.source.media.page} · 接收时间 {new Date(source.receivedAt).toLocaleTimeString()}</p>)}
    </div>}
  </PageCard>;
}
