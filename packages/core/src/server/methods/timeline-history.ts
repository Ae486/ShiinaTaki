/**
 * INPUT:  TimelineHistoryParams from a dispatched timeline.history request + a TimelineRepo
 * OUTPUT: timelineHistoryMethod(repo) -> MethodDefinition (operator-only); returns a newest-first page + cursor
 * POS:    core/server/methods — one file per WS method; thin read-only delegation to the timeline repo
 */
import {
  TIMELINE_METHODS,
  TimelineHistoryParamsSchema,
  type TimelineHistoryParams,
  type TimelineHistoryResult,
} from "@taki/shared";
import type { TimelineRepo } from "../../db/timeline-repo.ts";
import type { MethodDefinition } from "../method-registry.ts";

export function timelineHistoryMethod(repo: TimelineRepo): MethodDefinition<TimelineHistoryParams> {
  return {
    method: TIMELINE_METHODS.history,
    roles: ["operator"], // browsing the conversation is an operator concern (prd §5)
    paramsSchema: TimelineHistoryParamsSchema,
    handler: (params): TimelineHistoryResult => repo.pageBefore(params),
  };
}
