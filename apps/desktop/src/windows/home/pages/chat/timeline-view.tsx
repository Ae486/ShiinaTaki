/**
 * INPUT:  ordered date-grouped transcript items, guarded paging and legacy streaming fallback
 * OUTPUT: stable flat row keys, preserved reading/selection anchors and explicit tail-follow controls
 * POS:    ui/chat — one continuous conversation scroll container; commit handoff never remounts an item by row seq
 */

import { Suspense, lazy, type ReactNode } from "react";
import { TimelineMessage } from "./timeline-message.tsx";
import { EmptyState } from "@/components/ui/empty-state.js";
import { ActionButton } from "../../action-button.tsx";
import { useTimelineScroll, type TimelineScrollInput } from "./use-timeline-scroll.ts";
import type { DateGroup } from "./date-group.ts";
import type { ChatTranscriptItem } from "./chat-transcript.ts";

export interface ConversationTimeline {
  items: ChatTranscriptItem[];
  groups: DateGroup<ChatTranscriptItem>[];
  loaded: boolean;
  hasMore: boolean;
  loadOlder(): void;
  historyError: string | null;
  inflight?: { text: string } | null;
  truncated?: boolean;
  restoring?: boolean;
  restoreOlder?(): void;
  reading?: TimelineScrollInput["reading"];
}

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
function RestoreOlderControl({ timeline }: { timeline: ConversationTimeline }) {
  if (!timeline.truncated || !timeline.restoreOlder) return null;
  return (
    <div className="py-1 text-center">
      <ActionButton tone="ghost" busy={timeline.restoring} disabled={timeline.restoring} onClick={timeline.restoreOlder}>
        加载更早消息
      </ActionButton>
    </div>
  );
}

function transcriptRows(groups: DateGroup<ChatTranscriptItem>[]): ReactNode[] {
  const rows: ReactNode[] = [];
  for (const group of groups) {
    const first = group.entries[0];
    if (!first) continue;
    rows.push(<DateDivider key={`date:${first.key}`} label={group.dateKey} />);
    for (const item of group.entries) {
      rows.push(<div key={item.key} data-transcript-key={item.key}><TimelineMessage item={item} /></div>);
    }
  }
  return rows;
}

export function TimelineView({ timeline, adjunct }: { timeline: ConversationTimeline; adjunct?: ReactNode }) {
  const { groups, items, inflight, loaded, hasMore, loadOlder } = timeline;
  const entryCount = items.length;
  const oldest = groups[0]?.entries[0];
  const textLength = items.reduce((total, item) => total + (item.kind === "text" ? item.text.length : 0), 0);
  const { scrollRef, contentRef, onScroll, hasNewContent, followTail, requestOlder } = useTimelineScroll({
    entryCount,
    firstSeq: oldest ? oldest.seq : null,
    inflightLen: textLength + (inflight ? inflight.text.length : -1),
    tailKey: `${items.at(-1)?.key ?? "empty"}:${textLength}:${inflight?.text.length ?? 0}`,
    hasMore,
    loadOlder,
    reading: timeline.reading,
  });

  return (
    <div className="relative min-h-0 flex-1">
      <div ref={scrollRef} onScroll={onScroll} tabIndex={0} aria-label="聊天记录" className="h-full overflow-y-auto px-4 py-3">
        <div ref={contentRef} className="space-y-2">
          <RestoreOlderControl timeline={timeline} />
          {timeline.historyError && <div role="status" className="text-center text-xs text-text-secondary">
            {timeline.historyError}<ActionButton tone="ghost" onClick={requestOlder}>重试</ActionButton>
          </div>}
          {hasMore && !timeline.truncated && <div className="py-1 text-center text-xs text-text-secondary">
            <ActionButton tone="ghost" busy={timeline.restoring} disabled={timeline.restoring} onClick={requestOlder}>加载更早消息</ActionButton></div>}
          {loaded && entryCount === 0 && !inflight && <EmptyState title="还没有对话" hint="说点什么开始吧。" />}
          {transcriptRows(groups)}
          {inflight && <InflightBubble text={inflight.text} />}
          {adjunct}
        </div>
      </div>
      {hasNewContent && <div className="absolute right-4 bottom-3">
        <ActionButton tone="secondary" onClick={followTail}>查看新回复</ActionButton>
      </div>}
    </div>
  );
}
