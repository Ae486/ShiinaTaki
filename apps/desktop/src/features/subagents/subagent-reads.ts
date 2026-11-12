/**
 * INPUT: a live query scope and user-requested bounded page depth
 * OUTPUT: retained list/history pages with independent message/input/execution cursors
 * POS: ui/subagents — read projection assembly; cursor exhaustion never fabricates an empty success
 */
import type { SubagentHistory, SubagentList } from "@/lib/ws-client-subagents.js";
import type { SubagentClient } from "./subagent-state.ts";

interface ReadScope { client: SubagentClient; characterId: string; pages: number; current(): boolean }
export async function readSubagentList(scope: ReadScope): Promise<SubagentList> {
  const entries: SubagentList["entries"] = [];
  let afterId: string | undefined;
  let nextCursor: string | null = null;
  for (let page = 0; page < scope.pages && scope.current(); page += 1) {
    const result = await scope.client.subagentList({ characterId: scope.characterId, afterId, limit: 50 });
    entries.push(...result.entries);
    nextCursor = result.nextCursor;
    if (!nextCursor) break;
    afterId = nextCursor;
  }
  return { entries, nextCursor };
}

export async function readSubagentHistory(scope: ReadScope, subagentId: string): Promise<SubagentHistory> {
  let result: SubagentHistory | null = null;
  let afterSeq = 0;
  let inputAfterSeq = 0;
  let afterCompletionId: string | undefined;
  for (let page = 0; page < scope.pages && scope.current(); page += 1) {
    const next = await scope.client.subagentHistory({ characterId: scope.characterId, subagentId,
      afterSeq, inputAfterSeq, afterCompletionId, limit: 50 });
    result = result ? { ...next, inputs: [...result.inputs, ...next.inputs], messages: [...result.messages, ...next.messages],
      executions: [...result.executions, ...next.executions], results: [...result.results, ...next.results] } : next;
    if (!next.nextMessageSeq && !next.nextInputSeq && !next.nextCompletionId) break;
    afterSeq = next.nextMessageSeq ?? next.messages.at(-1)?.seq ?? afterSeq;
    inputAfterSeq = next.nextInputSeq ?? next.inputs.at(-1)?.inputSeq ?? inputAfterSeq;
    afterCompletionId = next.nextCompletionId ?? next.executions.at(-1)?.runId ?? afterCompletionId;
  }
  if (!result) throw new Error("Retired child read");
  return result;
}
