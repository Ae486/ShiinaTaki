/**
 * INPUT:  one committed TimelineEntry with optional captured tool names, or a legacy content-only row.
 * OUTPUT: <TimelineMessage> — one role-styled row; dispatches each part (text→markdown, tool→card, image→thumbnail).
 * POS:    ui/windows/home/pages/chat — the row renderer, wrapped in React.memo so only the in-flight row re-parses markdown per
 *         delta (research r2); settled rows keep a stable entry reference from the store and skip re-render.
 *         MarkdownView is lazy-loaded (P1f): react-markdown + remark-gfm ride an async chunk, keeping them out of
 *         the home entry chunk; the row shows the shared Skeleton until the chunk lands.
 */

import { Suspense, lazy, memo } from "react";
import type { TimelineEntry, TimelinePart } from "@taki/shared";
import { ImageAttachment } from "./image-attachment.tsx";
import { ToolCard, outputState } from "./tool-card.tsx";
import { Skeleton } from "@/components/ui/skeleton.js";

// P1f: the markdown stack is the only heavy chat dependency — dynamic-import it from the render seam.
const MarkdownView = lazy(() => import("./markdown-view.tsx").then((m) => ({ default: m.MarkdownView })));

function PartView({ part }: { part: TimelinePart }) {
  switch (part.type) {
    case "text":
      return part.text.length > 0 ? (
        <Suspense fallback={<Skeleton lines={2} />}>
          <MarkdownView text={part.text} />
        </Suspense>
      ) : null;
    case "image":
      return <ImageAttachment imageRef={part.ref} />;
    case "tool-call":
      return <ToolCard name={part.toolName} displayName={part.displayName} state="call" />;
    case "tool-result":
      return <ToolCard name={part.toolName} displayName={part.displayName} state={outputState(part.output)} />;
  }
}

function Row({ entry }: { entry: TimelineEntry }) {
  // Legacy text-only rows carry no parts; render their `content` as a single text part (parts is the display source).
  const parts: TimelinePart[] = entry.parts ?? [{ type: "text" as const, text: entry.content }];
  const rendered = parts.map((part, index) => <PartView key={index} part={part} />);

  // Tool-result rows render bare (the card is its own subtle surface); user/assistant rows sit in a chat bubble.
  if (entry.role === "tool") return <div className="px-1">{rendered}</div>;
  const align = entry.role === "user" ? "items-end" : "items-start";
  const tone = entry.role === "user" ? "bg-accent-muted" : "bg-surface ring-1 ring-black/5";
  return (
    <div className={`flex flex-col ${align}`}>
      <div className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-text-strong shadow-card ${tone}`}>{rendered}</div>
    </div>
  );
}

export const TimelineMessage = memo(Row);
