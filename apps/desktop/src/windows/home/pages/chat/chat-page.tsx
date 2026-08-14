/**
 * INPUT:  none (self-contained page root); drives its own connection + timeline hooks.
 * OUTPUT: <ChatPage> — the chat page body: shared page header (naming the active character) + status banner +
 *         scrollable timeline + composer; provides the WsClient to deep image parts via context.
 * POS:    ui/windows/home/pages/chat — owns the independent Chat socket and its single Approval modal. Closing Home
 *         drops this disposable client without affecting the Agent Core (invariant 4).
 */

import { ACTIVE_CHARACTER_ID } from "@/lib/active-character.js";
import { ConnectionStatusBanner } from "@/components/connection-status/connection-status.js";
import { PageHeader } from "../../page-chrome.tsx";
import { ChatClientContext } from "./chat-client-context.ts";
import { useChatConnection } from "./use-chat-connection.ts";
import { useChatTimeline } from "./use-chat-timeline.ts";
import { TimelineView } from "./timeline-view.tsx";
import { Composer } from "./composer.tsx";
import { useApprovalDialog } from "@/components/approval/use-approval-dialog.js";

export function ChatPage() {
  const { client, status } = useChatConnection();
  const timeline = useChatTimeline(client);
  const approvalDialog = useApprovalDialog(client);
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
      {approvalDialog}
    </ChatClientContext.Provider>
  );
}
