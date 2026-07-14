/**
 * INPUT:  the useChatBubble hook (open state, streamed reply, send/close) + local input draft.
 * OUTPUT: <ChatBubble> — the small on-pet input + streaming reply bubble; opens on a body click (see use-pet-drag).
 * POS:    ui/features/chat-bubble — presentational; reaches ws-client/stores ONLY through useChatBubble. Sits over the
 *         transparent overlay (the window stays interactive while open via the interaction store's bubbleOpen flag).
 *         Bubble/typing/input styling echoes BANDORI-PET-REV's look (clean-room, look only; the user restyles later).
 */

import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { useChatBubble } from "./use-chat-bubble.ts";
import type { BubbleReply } from "./chat-bubble-store.ts";

// Streaming feedback while the reply has no text yet (echoes BANDORI's animated typing indicator).
function TypingDots() {
  return (
    <span className="flex items-center gap-1 px-1 py-1.5">
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-slate-400" />
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-slate-400 [animation-delay:200ms]" />
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-slate-400 [animation-delay:400ms]" />
    </span>
  );
}

function BubbleReplyView({ reply }: { reply: BubbleReply }) {
  if (reply.kind === "empty") return null;
  const isError = reply.kind === "error";
  const text = isError ? reply.message : reply.text;
  // Assistant-bubble palette echoing BANDORI: near-white fill, dark text, a soft 1px ring; error rides a rose tone.
  const tone = isError ? "bg-rose-50 text-rose-700 ring-rose-200" : "bg-white/95 text-slate-800 ring-black/5";
  return (
    <div className={`max-h-40 overflow-y-auto rounded-2xl rounded-bl-md px-4 py-2 text-sm shadow-lg ring-1 ${tone}`}>
      {reply.kind === "streaming" && text.length === 0 ? <TypingDots /> : text}
    </div>
  );
}

export function ChatBubble() {
  const { isOpen, reply, isPending, send, close } = useChatBubble();
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) inputRef.current?.focus();
  }, [isOpen]);

  if (!isOpen) return null;

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    const message = draft.trim();
    if (message.length === 0 || isPending) return;
    setDraft("");
    void send(message);
  };

  return (
    <div
      className="pointer-events-auto absolute left-1/2 top-6 flex w-72 -translate-x-1/2 flex-col gap-2"
      // Keep bubble pointer events out of the pet drag/click seam (the host div behind it owns those handlers).
      onPointerDown={(event) => event.stopPropagation()}
      onPointerUp={(event) => event.stopPropagation()}
      onPointerMove={(event) => event.stopPropagation()}
    >
      <BubbleReplyView reply={reply} />
      <form
        onSubmit={onSubmit}
        className="flex items-center gap-1 rounded-full bg-white/95 px-2 py-1 shadow-lg ring-1 ring-black/5"
      >
        <input
          ref={inputRef}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => event.key === "Escape" && close()}
          placeholder="跟 taki 说点什么…"
          className="min-w-0 flex-1 bg-transparent px-2 py-1 text-sm text-slate-800 outline-none"
        />
        <button
          type="submit"
          disabled={draft.trim().length === 0 || isPending}
          className="rounded-full bg-rose-400 px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-rose-500 disabled:opacity-40"
        >
          {isPending ? "…" : "发送"}
        </button>
        <button type="button" onClick={close} className="px-2 text-slate-400 hover:text-slate-600" aria-label="Close">
          ×
        </button>
      </form>
    </div>
  );
}
