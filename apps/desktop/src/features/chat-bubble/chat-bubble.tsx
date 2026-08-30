/**
 * INPUT:  the useChatBubble hook (open/readiness state, streamed reply, send/close) + local input draft.
 * OUTPUT: <ChatBubble> — the small on-pet input + streaming reply bubble; opens on a body click (see use-pet-drag).
 *         Enter submits (IME-safe: a composition's Enter never submits), Escape closes.
 * POS:    ui/features/chat-bubble — presentational; reaches ws-client/stores ONLY through useChatBubble. Sits over the
 *         transparent overlay (the window stays interactive while open via the interaction store's bubbleOpen flag) at
 *         the wheel z-tier. Bubble/typing/input styling echoes BANDORI-PET-REV's look (clean-room, look only; the user
 *         restyles later). Buttons ride the shared primitives (A7: 28px minimum where the overlay constrains).
 */

import { useEffect, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";
import { openHome } from "@/lib/open-home-window.js";
import { pushToast } from "@/components/toast/toast-store.js";
import { ActionButton } from "@/windows/home/action-button.js";
import { IconButton } from "@/components/ui/icon-button.js";
import { ExternalLinkIcon } from "@/lib/icons/external-link-icon.js";
import { XIcon } from "@/lib/icons/x-icon.js";
import { useChatBubble } from "./use-chat-bubble.ts";
import type { BubbleReply } from "./chat-bubble-store.ts";

// Streaming feedback while the reply has no text yet (echoes BANDORI's animated typing indicator).
function TypingDots() {
  return (
    <span className="flex items-center gap-1 px-1 py-1.5">
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-text-faint" />
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-text-faint [animation-delay:200ms]" />
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-text-faint [animation-delay:400ms]" />
    </span>
  );
}

function BubbleReplyView({ reply }: { reply: BubbleReply }) {
  if (reply.kind === "empty") return null;
  const isError = reply.kind === "error";
  const text = isError ? reply.message : reply.text;
  // Assistant-bubble palette echoing BANDORI: near-white fill, dark text, a soft 1px ring; an error reply rides danger.
  const tone = isError ? "bg-danger-soft text-danger-strong ring-danger-border" : "bg-surface/95 text-text-strong ring-black/5";
  return (
    <div className={`max-h-40 overflow-y-auto rounded-2xl rounded-bl-md px-4 py-2 text-sm shadow-overlay ring-1 ${tone}`}>
      {reply.kind === "streaming" && text.length === 0 ? <TypingDots /> : text}
    </div>
  );
}

// Owns the expand-to-home-chat action. A glyph, not a text character: WebView2 rendered the previous ⤢ invisibly,
// hiding the ONLY entry to the full chat page (B8). Failures toast (D34) — WebView2 has no native JS dialogs.
function OpenChatButton() {
  const open = () =>
    openHome("chat").catch((cause: unknown) => {
      console.error("home window failed to open", cause);
      pushToast(`无法打开聊天页: ${cause instanceof Error ? cause.message : String(cause)}`);
    });
  return (
    <IconButton label="打开聊天页" size="sm" onClick={() => void open()}>
      <ExternalLinkIcon className="h-4 w-4" />
    </IconButton>
  );
}

export function bubbleSubmission(
  draft: string,
  isPending: boolean,
  connectionReady: boolean,
): string | null {
  const message = draft.trim();
  return message.length > 0 && !isPending && connectionReady ? message : null;
}

// A2 IME safety: an IME composition's Enter (candidate confirmation) must never submit the bubble.
// Exported so the regression test rides the real decision.
export function enterSubmits(key: string, isComposing: boolean): boolean {
  return !isComposing && key === "Enter";
}

// Escape closes the bubble — but not while an IME composition is active (the IME may consume it).
export function escapeCloses(key: string, isComposing: boolean): boolean {
  return key === "Escape" && !isComposing;
}

interface BubbleFormProps {
  isPending: boolean;
  connectionReady: boolean;
  send: (message: string) => Promise<void>;
  close: () => void;
}

// The input + action row (its own draft state); split out so ChatBubble stays a thin open-gate + layout shell.
function BubbleForm({ isPending, connectionReady, send, close }: BubbleFormProps) {
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => inputRef.current?.focus(), []);

  const submitDraft = () => {
    const message = bubbleSubmission(draft, isPending, connectionReady);
    if (message === null) return;
    setDraft("");
    void send(message);
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    submitDraft();
  };

  // Keydown owns the Enter path (A2 IME guard); preventDefault also suppresses the form's implicit
  // submission so a physical Enter submits exactly once. Escape closes only outside a composition.
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (enterSubmits(event.key, event.nativeEvent.isComposing)) {
      event.preventDefault();
      submitDraft();
      return;
    }
    if (escapeCloses(event.key, event.nativeEvent.isComposing)) close();
  };

  return (
    <form
      onSubmit={onSubmit}
      className="flex items-center gap-1 rounded-full bg-surface/95 px-2 py-1 shadow-overlay ring-1 ring-black/5"
    >
      <input
        ref={inputRef}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder="跟 taki 说点什么…"
        className="min-w-0 flex-1 bg-transparent px-2 py-1 text-sm text-text-strong outline-none"
      />
      {/* ActionButton is type=button: the pill submits via onClick, the input's Enter path stays in onKeyDown. */}
      <ActionButton tone="accent" shape="pill" disabled={bubbleSubmission(draft, isPending, connectionReady) === null} onClick={submitDraft}>
        {isPending ? "…" : "发送"}
      </ActionButton>
      <OpenChatButton />
      <IconButton label="关闭" size="sm" className="-mr-0.5" onClick={close}>
        <XIcon className="h-4 w-4" />
      </IconButton>
    </form>
  );
}

export function ChatBubble() {
  const { isOpen, reply, isPending, connectionReady, send, close } = useChatBubble();
  if (!isOpen) return null;

  return (
    <div
      className="pointer-events-auto absolute left-1/2 top-6 z-(--z-wheel) flex w-72 -translate-x-1/2 flex-col gap-2"
      // Marks the bubble's rect as the ONLY interactive area while open — the click-through poll keeps the window
      // interactive over it and passes everything around it through (element-level, [data-keep-interactive]).
      data-keep-interactive
      // Keep bubble pointer events out of the pet drag/click seam (the host div behind it owns those handlers).
      onPointerDown={(event) => event.stopPropagation()}
      onPointerUp={(event) => event.stopPropagation()}
      onPointerMove={(event) => event.stopPropagation()}
    >
      <BubbleReplyView reply={reply} />
      <BubbleForm isPending={isPending} connectionReady={connectionReady} send={send} close={close} />
    </div>
  );
}
