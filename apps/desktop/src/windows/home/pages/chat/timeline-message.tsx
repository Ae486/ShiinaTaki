/**
 * INPUT:  one item from the shared canonical/live Chat transcript projection
 * OUTPUT: stable language bubbles, grouped user attachments and compact invocation cards
 * POS:    ui/chat — default-safe lazy Markdown; unchanged text props skip reparsing across stream/commit updates
 */
import { Suspense, lazy, memo, useMemo } from "react";
import type { TimelineEntry } from "@taki/shared";
import { ImageAttachment } from "./image-attachment.tsx";
import { ToolCard } from "./tool-card.tsx";
import { Skeleton } from "@/components/ui/skeleton.js";
import type { ChatTranscriptItem } from "./chat-transcript.ts";
import { toolOutputDetails } from "./tool-result-display.ts";

const MarkdownView = lazy(() => import("./markdown-view.tsx").then((m) => ({ default: m.MarkdownView })));

const TextContent = memo(function TextContent({ text }: { text: string }) {
  return <Suspense fallback={<Skeleton lines={2} />}><MarkdownView text={text} /></Suspense>;
});

function UserMessage({ entry }: { entry: TimelineEntry }) {
  const parts = entry.parts?.length ? entry.parts : [{ type: "text" as const, text: entry.content }];
  return (
    <div className="flex flex-col items-end">
      <div className="max-w-[85%] rounded-2xl bg-accent-muted px-3.5 py-2 text-text-strong shadow-card">
        {parts.map((part, index) => part.type === "text" ? <TextContent key={index} text={part.text} />
          : part.type === "image" ? <ImageAttachment key={index} imageRef={part.ref} /> : null)}
      </div>
    </div>
  );
}

function ToolMessage({ item }: { item: Extract<ChatTranscriptItem, { kind: "tool" }> }) {
  const details = useMemo(() => toolOutputDetails(item.output), [item.output]);
  return <ToolCard name={item.toolName} displayName={item.displayName} status={item.status} stale={item.stale} details={details} />;
}

export function TimelineMessage({ item }: { item: ChatTranscriptItem }) {
  if (item.kind === "user") return <UserMessage entry={item.entry} />;
  if (item.kind === "notice") return <div role="status" className="px-1 text-xs leading-relaxed text-text-secondary">{item.text}</div>;
  if (item.kind === "tool") return <ToolMessage item={item} />;
  return (
    <div className={`flex flex-col ${item.role === "user" ? "items-end" : "items-start"}`}>
      <div className="max-w-[85%] rounded-2xl bg-surface px-3.5 py-2 text-text-strong shadow-card ring-1 ring-black/5">
        {item.kind === "text" ? <TextContent text={item.text} /> : <ImageAttachment imageRef={item.imageRef} />}
      </div>
    </div>
  );
}
