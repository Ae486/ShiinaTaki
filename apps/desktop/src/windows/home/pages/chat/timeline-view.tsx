/**
 * INPUT:  a ChatTimeline view-model (date-grouped entries + in-flight row + paging) from the hook.
 * OUTPUT: <TimelineView> — the scrollable conversation: date dividers, role-styled rows, and the streaming in-flight
 *         bubble. Auto-sticks to bottom; loads older pages on top-reach. Errors are toasts (D34), not in-stream rows.
 * POS:    ui/windows/home/pages/chat — the scroll container (one continuous timeline, NO session list). Presentational.
 */

import type { ChatTimeline } from "./use-chat-timeline.ts";
import { TimelineMessage } from "./timeline-message.tsx";
import { MarkdownView } from "./markdown-view.tsx";
import { useTimelineScroll } from "./use-timeline-scroll.ts";

function DateDivider({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-center py-1">
      <span className="rounded-full bg-slate-200 px-2.5 py-0.5 text-[11px] text-slate-500">{label}</span>
    </div>
  );
}

function TypingDots() {
  return (
    <span className="flex items-center gap-1 px-1 py-1.5">
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-slate-400" />
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-slate-400 [animation-delay:200ms]" />
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-slate-400 [animation-delay:400ms]" />
    </span>
  );
}

// The still-streaming assistant reply: same left-aligned bubble as a settled assistant row, so complete → persisted
// entry is a seamless swap (no visual jump). Empty text shows a typing indicator until the first delta.
function InflightBubble({ text }: { text: string }) {
  return (
    <div className="flex flex-col items-start">
      <div className="max-w-[85%] rounded-2xl bg-white px-3.5 py-2 text-slate-800 shadow-sm ring-1 ring-black/5">
        {text.length > 0 ? <MarkdownView text={text} /> : <TypingDots />}
      </div>
    </div>
  );
}

export function TimelineView({ timeline }: { timeline: ChatTimeline }) {
  const { groups, inflight, loaded, hasMore, loadOlder } = timeline;
  const entryCount = groups.reduce((total, group) => total + group.entries.length, 0);
  const { scrollRef, onScroll } = useTimelineScroll({
    entryCount,
    inflightLen: inflight ? inflight.text.length : -1,
    hasMore,
    loadOlder,
  });

  return (
    <div ref={scrollRef} onScroll={onScroll} className="flex-1 space-y-2 overflow-y-auto px-4 py-3">
      {hasMore && <div className="py-1 text-center text-[11px] text-slate-400">上滑查看更早的消息</div>}
      {loaded && entryCount === 0 && !inflight && (
        <div className="py-10 text-center text-sm text-slate-400">还没有对话，说点什么开始吧</div>
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
