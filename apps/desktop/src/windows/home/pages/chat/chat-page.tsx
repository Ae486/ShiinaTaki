/**
 * INPUT:  none (self-contained page root); drives its own connection + timeline hooks.
 * OUTPUT: <ChatPage> — the chat page body: character header + status banner + scrollable timeline + composer;
 *         provides the WsClient to deep image parts via context.
 * POS:    ui/windows/home/pages/chat — the depth-view page of the home window (the bubble is the glance, #16). A
 *         disposable client (invariant 4): closing home drops its WS; the Agent Core is unaffected.
 */

import { ACTIVE_CHARACTER_ID } from "@/lib/active-character.js";
import type { ConnectionStatus } from "@/stores/connection-store.js";
import { ChatClientContext } from "./chat-client-context.ts";
import { useChatConnection } from "./use-chat-connection.ts";
import { useChatTimeline } from "./use-chat-timeline.ts";
import { TimelineView } from "./timeline-view.tsx";
import { Composer } from "./composer.tsx";

function statusText(status: ConnectionStatus): string | null {
  switch (status.kind) {
    case "connected":
      return null;
    case "connecting":
      return "连接中…";
    case "pairing-required":
      return "尚未配对：请先在宠物窗口完成配对";
    case "disconnected":
      return "连接已断开";
    case "error":
      return status.message;
  }
}

function StatusBanner({ status }: { status: ConnectionStatus }) {
  const text = statusText(status);
  if (!text) return null;
  return <div className="bg-amber-50 px-4 py-1.5 text-center text-xs text-amber-700">{text}</div>;
}

export function ChatPage() {
  const { client, status } = useChatConnection();
  const timeline = useChatTimeline(client, status.kind === "connected");

  return (
    <ChatClientContext.Provider value={client}>
      <div className="flex h-full min-h-0 flex-col">
        <header className="border-b border-slate-200 bg-white px-4 py-2.5">
          <h1 className="text-sm font-semibold text-slate-700">{ACTIVE_CHARACTER_ID}</h1>
        </header>
        <StatusBanner status={status} />
        <TimelineView timeline={timeline} />
        <Composer
          onSend={timeline.send}
          onCancel={timeline.cancel}
          isSending={timeline.isSending}
          retractedDraft={timeline.retractedDraft}
          consumeRetractedDraft={timeline.consumeRetractedDraft}
        />
      </div>
    </ChatClientContext.Provider>
  );
}
