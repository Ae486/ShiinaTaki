/**
 * INPUT:  one committed TimelineEntry (role + parts, or a legacy text-only row via `content`).
 * OUTPUT: <TimelineMessage> — one role-styled row; dispatches each part (text→markdown, tool→card, image→thumbnail).
 * POS:    ui/windows/chat — the row renderer, wrapped in React.memo so only the in-flight row re-parses markdown per
 *         delta (research r2); settled rows keep a stable entry reference from the store and skip re-render.
 */

import { memo } from "react";
import type { TimelineEntry, TimelinePart } from "@taki/shared";
import { MarkdownView } from "./markdown-view.tsx";
import { ImageAttachment } from "./image-attachment.tsx";
import { ToolCard, outputState } from "./tool-card.tsx";

function PartView({ part }: { part: TimelinePart }) {
  switch (part.type) {
    case "text":
      return part.text.length > 0 ? <MarkdownView text={part.text} /> : null;
    case "image":
      return <ImageAttachment imageRef={part.ref} />;
    case "tool-call":
      return <ToolCard name={part.toolName} state="call" />;
    case "tool-result":
      return <ToolCard name={part.toolName} state={outputState(part.output)} />;
  }
}

function Row({ entry }: { entry: TimelineEntry }) {
  // Legacy text-only rows carry no parts; render their `content` as a single text part (parts is the display source).
  const parts: TimelinePart[] = entry.parts ?? [{ type: "text" as const, text: entry.content }];
  const rendered = parts.map((part, index) => <PartView key={index} part={part} />);

  // Tool-result rows render bare (the card is its own subtle surface); user/assistant rows sit in a chat bubble.
  if (entry.role === "tool") return <div className="px-1">{rendered}</div>;
  const align = entry.role === "user" ? "items-end" : "items-start";
  const tone = entry.role === "user" ? "bg-rose-100" : "bg-white ring-1 ring-black/5";
  return (
    <div className={`flex flex-col ${align}`}>
      <div className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-slate-800 shadow-sm ${tone}`}>{rendered}</div>
    </div>
  );
}

export const TimelineMessage = memo(Row);
