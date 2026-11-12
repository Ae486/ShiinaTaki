/**
 * INPUT:  local submission readiness, exact retracted drafts and explicit send/close actions
 * OUTPUT: controlled composer draft, initial focus and IME-safe submission handlers
 * POS:    ui/chat-bubble — draft-only hook; typing and focus never depend on transcript layout or animation
 */
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";

export interface BubbleFormInput {
  isPending: boolean;
  connectionReady: boolean;
  send(message: string): Promise<void>;
  close(): void;
  retractedDraft: string | null;
  consumeRetractedDraft(): void;
}

export function bubbleSubmission(draft: string, isPending: boolean, connectionReady: boolean): string | null {
  const message = draft.trim();
  return message.length > 0 && !isPending && connectionReady ? message : null;
}

export function enterSubmits(key: string, isComposing: boolean): boolean {
  return !isComposing && key === "Enter";
}

export function escapeCloses(key: string, isComposing: boolean): boolean {
  return key === "Escape" && !isComposing;
}

export function useBubbleForm(input: BubbleFormInput) {
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => inputRef.current?.focus(), []);
  useEffect(() => {
    if (input.retractedDraft === null) return;
    // A rejected draft never overwrites text the user has already started typing for a later attempt.
    setDraft((current) => current.length === 0 ? input.retractedDraft ?? "" : current);
    input.consumeRetractedDraft();
  }, [input.retractedDraft, input.consumeRetractedDraft]);
  const message = bubbleSubmission(draft, input.isPending, input.connectionReady);
  const submit = () => {
    if (message === null) return;
    setDraft("");
    void input.send(message);
  };
  const onSubmit = (event: FormEvent) => { event.preventDefault(); submit(); };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (enterSubmits(event.key, event.nativeEvent.isComposing)) {
      event.preventDefault(); submit();
    } else if (escapeCloses(event.key, event.nativeEvent.isComposing)) input.close();
  };
  return { draft, setDraft, inputRef, onSubmit, onKeyDown, submit, canSubmit: message !== null };
}
