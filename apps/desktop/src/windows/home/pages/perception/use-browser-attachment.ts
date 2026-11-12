/**
 * INPUT: explicit operator actions, local Shell commands and the current Home Core connection
 * OUTPUT: generation-guarded setup/credential/snapshot state with serialized mutations
 * POS: Home Perception hook — pairing secrets stay in this component lifetime, never in persistent UI caches
 */
import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { BROWSER_PLAYBACK_ENABLED_KEY, BrowserAttachmentPairSchema, BrowserAttachmentSetupResultSchema,
  type BrowserAttachmentPair, type BrowserPlaybackReadResult } from "@taki/shared";
import { useHomeClient } from "../../home-client-context.ts";
import type { WsClient } from "@/lib/ws-client.js";

interface View { pair: BrowserAttachmentPair | null; playback: BrowserPlaybackReadResult | null; message: string; pending: boolean }
const INITIAL: View = { pair: null, playback: null, message: "尚未检查浏览器连接。", pending: false };
type Result = Partial<Omit<View, "pending">>;
type Action = "setup" | "pair" | "allow" | "deny" | "read";

async function perform(action: Action, client: WsClient | null): Promise<Result> {
  if (action === "setup") {
    const result = BrowserAttachmentSetupResultSchema.parse(await invoke("browser_attachment_setup", { enabled: true }));
    return { message: result.restartRequired ? "本机连接设置已保存。请重新启动桌面端，再读取连接信息。"
      : "本机连接设置已保存，无需重启。读取连接信息即可继续扩展配对。", pair: null };
  }
  if (action === "pair") {
    const pair = BrowserAttachmentPairSchema.nullable().parse(await invoke("browser_attachment_pair"));
    return { pair, message: pair ? "将连接地址和凭据填入 OpenBili 扩展选项。请勿向网页或聊天发送凭据。"
      : "本机连接尚未启用。" };
  }
  if (!client) throw new Error("Core connection unavailable");
  if (action !== "read") await client.configSet({ key: BROWSER_PLAYBACK_ENABLED_KEY, value: action === "allow" });
  return { playback: await client.browserPlaybackRead(), message: "已读取本次连接状态；播放来源还需保持新鲜，并单独接受共看。" };
}

export function useBrowserAttachment() {
  const { client, status } = useHomeClient();
  const [view, setView] = useState<View>(INITIAL);
  const epoch = useRef(0); const busy = useRef(false);
  useEffect(() => {
    epoch.current++; busy.current = false; setView(INITIAL);
    return () => { epoch.current++; busy.current = false; };
  }, [client, status.kind]);
  const run = async (action: Action) => {
    if (busy.current) return;
    busy.current = true; const owner = epoch.current;
    setView((previous) => ({ ...previous, pending: true }));
    try {
      const result = await perform(action, status.kind === "connected" ? client : null);
      if (owner === epoch.current) setView((previous) => ({ ...previous, ...result }));
    } catch {
      if (owner === epoch.current) setView((previous) => ({ ...previous, pair: null,
        message: action === "setup" || action === "pair" ? "本机浏览器连接暂不可用，请检查桌面端连接设置后重试。"
          : "操作未完成。请确认 Core 已连接后重试。" }));
    } finally {
      if (owner === epoch.current) { busy.current = false; setView((previous) => ({ ...previous, pending: false })); }
    }
  };
  return { ...view, run, connected: status.kind === "connected" };
}
