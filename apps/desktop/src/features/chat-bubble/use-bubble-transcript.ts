/**
 * INPUT:  narrow Pet reply/source/presentation store selectors
 * OUTPUT: the ordered visible bubble transcript and a lifecycle token for finite motion cleanup
 * POS:    ui/chat-bubble — selector hook; raw tool facts and gated language remain separate from execution state
 */
import { useMemo } from "react";
import { useChatBubbleStore } from "./chat-bubble-store.ts";
import { projectBubbleTranscript } from "./bubble-transcript.ts";

export function useBubbleTranscript() {
  const activitySource = useChatBubbleStore((state) => state.activitySource);
  const activity = useChatBubbleStore((state) => state.activity);
  const reply = useChatBubbleStore((state) => state.reply);
  const replyMessageId = useChatBubbleStore((state) => state.replyMessageId);
  const legacyEpoch = useChatBubbleStore((state) => state.legacyEpoch);
  const presentationVersion = useChatBubbleStore((state) => state.presentationVersion);
  const committed = useChatBubbleStore((state) => state.committed);
  const transcript = useMemo(() => projectBubbleTranscript({ activitySource, activity, reply, replyMessageId, legacyEpoch, committed }),
    [activitySource, activity, reply, replyMessageId, legacyEpoch, committed]);
  return { transcript, presentationVersion };
}
