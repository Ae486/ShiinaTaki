/**
 * INPUT: one controller-owned text chunk and bounded navigation actions.
 * OUTPUT: literal scrollable text with Unicode character positions.
 * POS: Home QQ detail presentation; never accumulates previous chunks.
 */

import { useEffect, useRef } from "react";
import { ActionButton } from "../../action-button.tsx";

type ChunkProps = {
  chunk: { text: string; offset: number; totalCharacters: number; nextOffset?: number };
  busy: boolean;
  next(): Promise<void>;
};

export function QqmmDetailText({ chunk, busy, next }: ChunkProps) {
  const content = useRef<HTMLDivElement>(null);
  useEffect(() => { if (content.current) content.current.scrollTop = 0; }, [chunk.text, chunk.offset]);
  const end = chunk.offset + Array.from(chunk.text).length;
  return <>
    <div ref={content} tabIndex={0} className="min-h-0 overflow-y-auto rounded-lg border border-border bg-surface-muted p-3">
      <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-text-body [overflow-wrap:anywhere]">{chunk.text}</p>
    </div>
    <div className="flex items-center justify-between gap-3 text-xs text-text-secondary">
      <span>{chunk.totalCharacters === 0 ? "内容为空" : `第 ${chunk.offset + 1}–${end} 字 / 共 ${chunk.totalCharacters} 字`}</span>
      {chunk.nextOffset !== undefined && <ActionButton disabled={busy} busy={busy} onClick={() => void next()}>下一段</ActionButton>}
    </div>
  </>;
}
