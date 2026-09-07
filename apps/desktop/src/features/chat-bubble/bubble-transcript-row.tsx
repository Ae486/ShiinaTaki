/**
 * INPUT:  one text/tool/error/waiting item and its finite visual-presence token
 * OUTPUT: a distinct safe bubble surface with truthful status and no interactive exiting placeholder
 * POS:    ui/chat-bubble — row renderer; transient tool state never becomes language or a retry control
 */
import { activityToolLabel, activityToolStatus } from "@/lib/tool-activity-display.js";
import type { BubblePresenceRow } from "./bubble-presence.ts";
import type { BubbleTranscriptItem } from "./bubble-transcript.ts";
import { useBubbleRowPresence } from "./use-bubble-row-presence.ts";

function ToolBubble({ item, exiting }: { item: Extract<BubbleTranscriptItem, { kind: "tool" }>; exiting: boolean }) {
  const status = activityToolStatus(item.status, item.stale);
  return <span className="flex items-center gap-2">
    <span className="min-w-0 flex-1">{activityToolLabel(item.toolName, item.displayName)}</span>
    <span className={`flex shrink-0 items-center gap-1 text-xs ${status.tone}`}>
      {status.busy && !exiting && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" aria-hidden="true" />}
      {status.label}
    </span>
  </span>;
}

function BubbleContent({ item, exiting }: { item: BubbleTranscriptItem; exiting: boolean }) {
  if (item.kind === "tool") return <ToolBubble item={item} exiting={exiting} />;
  if (item.kind === "waiting") return <span className="text-text-secondary">正在准备回复…</span>;
  return item.text;
}

interface BubbleRowProps {
  row: BubblePresenceRow;
  settled(itemKey: string, token: number): void;
}

export function BubbleTranscriptRow({ row, settled }: BubbleRowProps) {
  const presence = useBubbleRowPresence({ row, settled });
  const exiting = row.phase === "exiting";
  const tone = row.item.kind === "error" ? "bg-danger-soft text-danger-strong ring-danger-border"
    : row.item.kind === "notice" ? "bg-surface/95 text-text-secondary ring-black/5" : "bg-surface/95 text-text-strong ring-black/5";
  return (
    <div ref={presence.ref} className="pet-bubble-row" data-bubble-key={row.item.key}
      data-bubble-kind={row.item.kind} data-presence={row.phase}
      style={exiting ? { top: presence.exitTop } : undefined} aria-hidden={exiting || undefined} inert={exiting || undefined}>
      <div className={`pet-bubble-surface rounded-2xl rounded-bl-md px-4 py-2 text-sm shadow-overlay ring-1 ${tone}`}
        data-keep-interactive={row.phase === "present" ? "" : undefined}
        role={row.item.kind === "error" ? "status" : undefined}>
        <BubbleContent item={row.item} exiting={exiting} />
      </div>
    </div>
  );
}
