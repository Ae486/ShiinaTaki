/**
 * INPUT:  one stable invocation's captured name, truthful status and useful canonical result text
 * OUTPUT: compact tool entry with a stable heading DOM and an initially collapsed native detail disclosure
 * POS:    ui/chat — presentational invocation card; no raw arguments, routing keys or transport metadata
 */
import type { ChatActivityToolStatus } from "@taki/shared";
import { ToolIcon } from "@/lib/icons/tool-icon.js";
import { ChevronDownIcon } from "@/lib/icons/chevron-down-icon.js";
import { activityToolLabel, activityToolStatus } from "@/lib/tool-activity-display.js";

interface ToolCardProps {
  name: string;
  displayName?: string;
  status: ChatActivityToolStatus;
  stale?: boolean;
  details?: string | null;
}

function ToolHeading({ name, displayName, status, stale }: ToolCardProps) {
  const state = activityToolStatus(status, stale);
  const duration = status.phase === "settled" && status.durationMs !== undefined
    ? `${(status.durationMs / 1_000).toFixed(1)} 秒` : null;
  return (
    <span className="flex min-w-0 items-center gap-2 py-1.5 pl-2.5 pr-9" aria-busy={state.busy}>
      <ToolIcon className={`h-3.5 w-3.5 shrink-0 text-text-faint ${state.busy ? "animate-pulse" : ""}`} />
      <span className="min-w-0 flex-1 break-words text-text-body">{activityToolLabel(name, displayName)}</span>
      {duration && <span className="shrink-0 text-text-faint">{duration}</span>}
      <span className={`shrink-0 ${state.tone}`}>{state.label}</span>
    </span>
  );
}

export function ToolCard(props: ToolCardProps) {
  const explanation = props.details ?? (props.status.phase === "settled" ? props.status.message : undefined);
  return (
    <div className="relative max-w-[90%] rounded-lg bg-surface-sunken text-xs ring-1 ring-black/5">
      {/* The heading never moves into a new disclosure parent when the first result arrives: selection stays on
          the same text node. Its control slot is reserved, but no empty actionable disclosure is rendered. */}
      <ToolHeading {...props} />
      {explanation?.trim() && <details className="group">
        <summary className="absolute right-0.5 top-0.5 flex h-7 w-7 cursor-pointer list-none items-center justify-center rounded-md [&::-webkit-details-marker]:hidden">
          <ChevronDownIcon className="h-3.5 w-3.5 text-text-faint transition-transform group-open:rotate-180" />
          <span className="sr-only">展开或收起详情</span>
        </summary>
        <div className="max-h-56 overflow-auto border-t border-black/5 px-3 py-2">
          <pre className="whitespace-pre-wrap break-words font-sans text-xs leading-relaxed text-text-body">{explanation}</pre>
        </div>
      </details>}
    </div>
  );
}
