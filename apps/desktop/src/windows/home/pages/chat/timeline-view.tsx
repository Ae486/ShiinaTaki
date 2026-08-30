/**
 * INPUT:  a ChatTimeline view-model (date-grouped entries + in-flight row + paging) from the hook.
 * OUTPUT: <TimelineView> — the scrollable conversation: date dividers, role-styled rows, and the streaming in-flight
 *         bubble. Auto-sticks to bottom; loads older pages on top-reach; shows the P1b "加载更早消息" jump control
 *         while the mounted window has trimmed rows. Errors are toasts (D34), not in-stream rows.
 * POS:    ui/windows/home/pages/chat — the scroll container (one continuous timeline, NO session list). Presentational.
 */

import { Suspense, lazy } from "react";
import type { ChatTimeline } from "./use-chat-timeline.ts";
import { TimelineMessage } from "./timeline-message.tsx";
import { EmptyState } from "@/components/ui/empty-state.js";
import { ActionButton } from "../../action-button.tsx";
import { useTimelineScroll } from "./use-timeline-scroll.ts";

// P1f: same lazy markdown seam as the settled rows — one shared async chunk, typing dots while it loads.
const MarkdownView = lazy(() => import("./markdown-view.tsx").then((m) => ({ default: m.MarkdownView })));

function DateDivider({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-center py-1">
      <span className="rounded-full bg-surface-sunken px-2.5 py-0.5 text-xs text-text-secondary">{label}</span>
    </div>
  );
}

function TypingDots() {
  return (
    <span className="flex items-center gap-1 px-1 py-1.5">
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-text-faint" />
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-text-faint [animation-delay:200ms]" />
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-text-faint [animation-delay:400ms]" />
    </span>
  );
}

// The still-streaming assistant reply: same left-aligned bubble as a settled assistant row, so complete → persisted
// entry is a seamless swap (no visual jump). Empty text shows a typing indicator until the first delta (and while
// the lazy markdown chunk loads).
function InflightBubble({ text }: { text: string }) {
  return (
    <div className="flex flex-col items-start">
      <div className="max-w-[85%] rounded-2xl bg-surface px-3.5 py-2 text-text-strong shadow-card ring-1 ring-black/5">
        {text.length > 0 ? (
          <Suspense fallback={<TypingDots />}>
            <MarkdownView text={text} />
          </Suspense>
        ) : (
          <TypingDots />
        )}
      </div>
    </div>
  );
}

// P1b: the mounted window trimmed older rows — the explicit jump restores a larger window on demand
// (top-reach auto-load keeps working alongside it; the passive hint yields to the actionable control).
function RestoreOlderControl({ timeline }: { timeline: ChatTimeline }) {
  if (!timeline.truncated) return null;
  return (
    <div className="py-1 text-center">
      <ActionButton tone="ghost" busy={timeline.restoring} disabled={timeline.restoring} onClick={timeline.restoreOlder}>
        加载更早消息
      </ActionButton>
    </div>
  );
}

export function TimelineView({ timeline }: { timeline: ChatTimeline }) {
  const { groups, inflight, loaded, hasMore, loadOlder } = timeline;
  const entryCount = groups.reduce((total, group) => total + group.entries.length, 0);
  const oldest = groups[0]?.entries[0];
  const { scrollRef, onScroll } = useTimelineScroll({
    entryCount,
    firstSeq: oldest ? oldest.seq : null,
    inflightLen: inflight ? inflight.text.length : -1,
    hasMore,
    loadOlder,
  });

  return (
    // A8: tabIndex=0 keeps the timeline keyboard-scrollable; the global focus-visible rule shows the ring.
    <div ref={scrollRef} onScroll={onScroll} tabIndex={0} aria-label="聊天记录" className="flex-1 space-y-2 overflow-y-auto px-4 py-3">
      <RestoreOlderControl timeline={timeline} />
      {hasMore && !timeline.truncated && <div className="py-1 text-center text-xs text-text-secondary">滚动查看更早消息</div>}
      {loaded && entryCount === 0 && !inflight && (
        <EmptyState title="还没有对话" hint="说点什么开始吧。" />
      )}
      {groups.map((group) => (
        <div key={group.dateKey} className="space-y-2">
          <DateDivider label={group.dateKey} />
          {group.entries.map((entry) => (
            <TimelineMessage key={entry.seq} entry={entry} />
          ))}
        </div>
      ))}
      {inflight && <InflightBubble text={inflight.text} />}
    </div>
  );
}
