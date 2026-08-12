/**
 * INPUT:  none (self-contained page root); drives its own connection + timeline hooks.
 * OUTPUT: <ChatPage> — the chat page body: shared page header (naming the active character) + status banner +
 *         scrollable timeline + composer; provides the WsClient to deep image parts via context.
 * POS:    ui/windows/home/pages/chat — the depth-view page of the home window (the bubble is the glance, #16). A
 *         disposable client (invariant 4): closing home drops its WS; the Agent Core is unaffected.
 */

import { ACTIVE_CHARACTER_ID } from "@/lib/active-character.js";
import { ConnectionStatusBanner } from "@/components/connection-status/connection-status.js";
import { PageHeader } from "../../page-chrome.tsx";
import { ChatClientContext } from "./chat-client-context.ts";
import { useChatConnection } from "./use-chat-connection.ts";
import { useChatTimeline } from "./use-chat-timeline.ts";
import { TimelineView } from "./timeline-view.tsx";
import { Composer } from "./composer.tsx";

export function ChatPage() {
  const { client, status } = useChatConnection();
  const timeline = useChatTimeline(client);
  const connected = status.kind === "connected";

  return (
    <ChatClientContext.Provider value={client}>
      <PageHeader title="聊天" hint={`当前角色：${ACTIVE_CHARACTER_ID}`} />
      <ConnectionStatusBanner status={status} />
      <TimelineView timeline={timeline} />
      <Composer
        onSend={timeline.send}
        onCancel={timeline.cancel}
        isSending={timeline.isSending}
        retractedDraft={timeline.retractedDraft}
        consumeRetractedDraft={timeline.consumeRetractedDraft}
        connectionReady={connected}
      />
    </ChatClientContext.Provider>
  );
}
