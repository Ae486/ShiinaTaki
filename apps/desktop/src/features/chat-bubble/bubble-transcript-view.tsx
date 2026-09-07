/**
 * INPUT:  ordered semantic Pet bubbles and the explicit presentation-generation token
 * OUTPUT: top-anchored, internally scrolling text/tool bubbles with finite CSS presence and released tail space
 * POS:    ui/chat-bubble — disposable visual projection; the transparent viewport itself never blocks the desktop
 */
import type { BubbleTranscript } from "./bubble-transcript.ts";
import { useBubbleMotion } from "./use-bubble-motion.ts";
import { useBubblePresence } from "./use-bubble-presence.ts";
import { useBubbleScroll } from "./use-bubble-scroll.ts";
import { BubblePresenceGroup } from "./bubble-presence-group.tsx";

interface TranscriptProps { transcript: BubbleTranscript; presentationVersion: number }

export function BubbleTranscriptView({ transcript, presentationVersion }: TranscriptProps) {
  const motion = useBubbleMotion();
  const presence = useBubblePresence({ transcript, presentationVersion, motion });
  const scroll = useBubbleScroll(transcript.key);
  return (
    <div ref={scroll.scrollRef} className="pet-bubble-transcript" data-pet-bubble-transcript onScroll={scroll.onScroll}>
      {presence.groups.map((group) => <BubblePresenceGroup key={group.key} group={group} onMeasured={scroll.onMeasured}
        settleRow={presence.settleRow} settleGroup={presence.settleGroup} />)}
      <div className="pet-bubble-scroll-anchor" data-following={scroll.following || undefined} aria-hidden="true" />
    </div>
  );
}
