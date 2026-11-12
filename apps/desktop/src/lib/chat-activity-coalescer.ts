/**
 * INPUT:  immutable activity views from one physical client generation and the event that changed them
 * OUTPUT: immediate semantic boundaries and 40-ms text-only publications with explicit flush/disposal
 * POS:    ui/lib — shared Chat/Pet text ingestion cadence; unrelated to CSS animation or execution timing
 */
import type { ChatActivity } from "@taki/shared";
import type { ChatActivityView } from "./chat-activity-state.ts";

const FLUSH_MS = 40; // Existing P1a text cadence; never delays a tool boundary or a committed batch.

export interface ChatActivityCoalescer {
  record(view: ChatActivityView, event?: ChatActivity): void;
  replace(view: ChatActivityView): void;
  flush(): void;
  dispose(): void;
}

export function createChatActivityCoalescer(publish: (view: ChatActivityView) => void): ChatActivityCoalescer {
  let key: string | null = null;
  let pending: ChatActivityView | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;
  const clear = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    pending = null;
  };
  const flush = () => {
    const view = pending;
    clear();
    if (view && !disposed) publish(view);
  };
  return {
    record(view, event) {
      if (disposed) return;
      const nextKey = event?.kind === "text.delta" ? JSON.stringify([event.messageId, event.attemptId, event.itemId]) : null;
      if (nextKey === null || nextKey !== key) {
        flush(); key = nextKey; publish(view);
      } else {
        pending = view;
        timer ??= setTimeout(flush, FLUSH_MS);
      }
    },
    replace(view) { if (!disposed) { clear(); key = null; publish(view); } },
    flush,
    dispose() { disposed = true; clear(); key = null; },
  };
}
