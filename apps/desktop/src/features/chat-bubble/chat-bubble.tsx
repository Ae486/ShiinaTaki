/**
 * INPUT:  explicit bubble opening, initiating-request controls and the shared segmented transcript
 * OUTPUT: a fixed top composer and an internally scrolling, top-anchored Pet conversation
 * POS:    ui/chat-bubble — transparent overlay frame; only its visible children participate in hit testing
 */
import { useChatBubble } from "./use-chat-bubble.ts";
import { BubbleForm } from "./bubble-form.tsx";
import { BubbleTranscriptView } from "./bubble-transcript-view.tsx";

export function ChatBubble() {
  const bubble = useChatBubble();
  if (!bubble.isOpen) return null;
  return (
    <div className="pointer-events-none absolute bottom-6 left-1/2 top-6 z-(--z-wheel) flex w-72 -translate-x-1/2 flex-col"
      data-pet-bubble-frame
      onPointerDown={(event) => event.stopPropagation()}
      onPointerUp={(event) => event.stopPropagation()}
      onPointerMove={(event) => event.stopPropagation()}>
      <BubbleForm isPending={bubble.isPending} connectionReady={bubble.connectionReady} send={bubble.send}
        close={bubble.close} retractedDraft={bubble.retractedDraft} consumeRetractedDraft={bubble.consumeRetractedDraft} />
      <BubbleTranscriptView transcript={bubble.transcript} presentationVersion={bubble.presentationVersion} />
    </div>
  );
}
