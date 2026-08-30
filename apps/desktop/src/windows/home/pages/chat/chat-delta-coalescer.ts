/**
 * INPUT:  chat.delta arrivals (messageId, delta) from the chat send handlers.
 * OUTPUT: recordDelta() — deltas coalesced into one ~40ms trailing-edge store update so MarkdownView re-parses at
 *         most ~25x/s instead of per-delta (P1a). flush()/resetForTests() are the teardown seams.
 * POS:    ui/windows/home/pages/chat — the ONLY path streaming deltas take into the timeline store. A setTimeout
 *         trailing edge, deliberately NOT rAF (a hidden window pauses rAF while the chat page must stay live for
 *         the backlog-on-return contract) and NOT setInterval (no polling loop when no deltas are in flight). The
 *         FIRST delta of a turn is applied immediately (the row appears without waiting a window); later deltas
 *         batch into one ~40ms flush that APPENDS the batched deltas (the row always holds the full accumulated text).
 */

import { useChatTimelineStore } from "./chat-timeline-store.ts";

// 40ms ≈ 25 flushes/s — above the perceptual threshold for streaming text, far below per-delta markdown re-parse.
const FLUSH_MS = 40;

let bufferedId: string | null = null; // the turn the buffer belongs to
let buffered = ""; // deltas accumulated since the last flush (flushed as ONE full-text update)
let timer: ReturnType<typeof setTimeout> | null = null;

function flush(): void {
  timer = null;
  if (bufferedId === null || buffered.length === 0) return;
  // Strict append: if the persisted swap / chat.complete / reset dropped the row in the meantime, the pending
  // flush is a no-op — the persisted entry is the text authority and stale deltas must not resurrect the row.
  useChatTimelineStore.getState().growInflightIfCurrent(bufferedId, buffered);
  buffered = "";
}

export function recordDelta(messageId: string, delta: string): void {
  if (bufferedId !== messageId) {
    // Turn boundary: apply the first delta immediately (growInflight replaces a stale row), then buffer this turn.
    useChatTimelineStore.getState().growInflight(messageId, delta);
    bufferedId = messageId;
    buffered = "";
    return;
  }
  buffered += delta;
  if (timer === null) timer = setTimeout(flush, FLUSH_MS);
}

/** Test seam: drop any pending buffer + timer (module state must not leak between tests). */
export function resetDeltaCoalescerForTests(): void {
  if (timer !== null) clearTimeout(timer);
  timer = null;
  buffered = "";
  bufferedId = null;
}
