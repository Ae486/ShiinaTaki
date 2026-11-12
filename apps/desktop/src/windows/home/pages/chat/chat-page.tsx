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
import { useSurfacePresence } from "@/features/presence/use-surface-presence.js";
import { CommittedExposureContext } from "@/features/presence/committed-exposure-context.js";
import { usePageActive } from "../../page-visibility-store.ts";
import { ChatPatternCandidates } from "@/features/initiative-patterns/chat-pattern-candidates.js";
import { ChatCoWatchingInvitation } from "@/features/co-watching/chat-co-watching-invitation.js";
import { useModelProfiles } from "../../use-model-profiles.ts";
import { ChatModelAvailability } from "./chat-model-availability.tsx";

export function ChatPage() {
  const { client, status } = useChatConnection();
  const timeline = useChatTimeline(client);
  const approvalDialog = useApprovalDialog(client);
  const connected = status.kind === "connected";
  const active = usePageActive("chat");
  const models = useModelProfiles(connected ? client : null, active);
  const modelReady = models.fresh && models.data?.profiles.some((profile) => profile.slot === "main" && profile.state === "ready") === true;
  const presence = useSurfacePresence(client, "chat", active);

  return (
    <ChatClientContext.Provider value={client}>
      <CommittedExposureContext.Provider value={presence}>
      <PageHeader title="聊天" hint={`当前角色：${ACTIVE_CHARACTER_ID}`} />
      <ConnectionStatusBanner status={status} />
      {connected && <ChatModelAvailability view={models} refresh={models.refresh} />}
      <TimelineView timeline={timeline} adjunct={<><ChatPatternCandidates /><ChatCoWatchingInvitation /></>} />
      <Composer
        onSend={timeline.send}
        onCancel={timeline.cancel}
        isSending={timeline.isSending}
        retractedDraft={timeline.retractedDraft}
        consumeRetractedDraft={timeline.consumeRetractedDraft}
        connectionReady={connected && modelReady}
      />
      {approvalDialog}
      </CommittedExposureContext.Provider>
    </ChatClientContext.Provider>
  );
}
