/**
 * INPUT: scoped Core conversation pages, explicit older demand and retained forward watermarks
 * OUTPUT: per-child continuous history with deduplicated gap recovery and stable older coverage
 * POS: ui/subagents — disposable query cache; source sequence remains Core-owned
 */
import { SubagentConversationEntrySchema, type SubagentConversationResult, type SubagentConversationEntry } from "@taki/shared";
import type { SubagentClient } from "./subagent-state.ts";

type ReadScope = { client: SubagentClient; characterId: string; current(): boolean };
type Conversation = SubagentConversationResult;

export class SubagentConversationPages {
  private readonly pages = new Map<string, Conversation>();
  private readonly older = new Set<string>();
  private key(characterId: string, child: string): string { return JSON.stringify([characterId, child]); }
  requestOlder(characterId: string, child: string): void { this.older.add(this.key(characterId, child)); }

  async expand(scope: ReadScope, entry: SubagentConversationEntry): Promise<Conversation> {
    if (!entry.body) throw new Error("No retained body");
    let offset = 0;
    let body = "";
    while (scope.current()) {
      const page = await scope.client.subagentConversationBody({ characterId: scope.characterId, subagentId: entry.subagentId,
        seq: entry.seq, offset, digest: entry.body.digest });
      this.assertCurrent(scope);
      if (page.seq !== entry.seq || page.digest !== entry.body.digest || page.offset !== offset) throw new Error("Conversation body mismatch");
      body += page.body;
      if (page.complete) break;
      if (page.nextOffset === null || page.nextOffset <= offset || page.nextOffset !== body.length) throw new Error("Conversation body cursor did not advance");
      offset = page.nextOffset;
    }
    this.assertCurrent(scope);
    const expanded = SubagentConversationEntrySchema.parse(JSON.parse(body));
    if (expanded.seq !== entry.seq || expanded.subagentId !== entry.subagentId || expanded.body) throw new Error("Invalid complete conversation body");
    const key = this.key(scope.characterId, entry.subagentId);
    const current = this.pages.get(key);
    if (!current) throw new Error("Conversation not loaded");
    const result = { ...current, entries: current.entries.map((row) => row.seq === entry.seq ? expanded : row) };
    this.pages.set(key, result);
    return result;
  }

  async read(scope: ReadScope, child: string): Promise<Conversation> {
    const key = this.key(scope.characterId, child);
    const retained = this.pages.get(key);
    const loadOlder = retained && this.older.delete(key);
    if (loadOlder) return this.readOlder(scope, retained);
    const newest = await scope.client.subagentConversation({ characterId: scope.characterId, subagentId: child });
    this.assertCurrent(scope);
    if (!retained) { this.pages.set(key, newest); return newest; }
    // Newest also refreshes mutable input inclusion/event dispositions without discarding earlier pages.
    let result = this.merge(this.pages.get(key) ?? retained, newest);
    let cursor = retained.entries.at(-1)?.seq;
    if (cursor !== undefined && newest.entries.some((entry) => entry.seq > cursor!)) {
      while (scope.current()) {
        const next = await scope.client.subagentConversation({ characterId: scope.characterId, subagentId: child,
          direction: "newer", cursor: { subagentId: child, seq: cursor } });
        this.assertCurrent(scope);
        result = this.merge(result, next);
        if (!next.hasMore) break;
        const nextSeq = next.nextCursor?.seq;
        if (nextSeq === undefined || nextSeq <= cursor) throw new Error("Conversation cursor did not advance");
        cursor = nextSeq;
      }
    }
    result = this.merge(this.pages.get(key) ?? result, result);
    this.pages.set(key, result);
    return result;
  }

  private async readOlder(scope: ReadScope, retained: Conversation): Promise<Conversation> {
    if (!retained.hasMore || !retained.nextCursor) return retained;
    const next = await scope.client.subagentConversation({ characterId: scope.characterId,
      subagentId: retained.conversation.subagentId, direction: "older", cursor: retained.nextCursor });
    this.assertCurrent(scope);
    if (next.hasMore && (!next.nextCursor || next.nextCursor.seq >= retained.nextCursor.seq)) throw new Error("Older cursor did not advance");
    const current = this.pages.get(this.key(scope.characterId, retained.conversation.subagentId)) ?? retained;
    const result = { ...this.merge(current, next), nextCursor: next.nextCursor, hasMore: next.hasMore };
    this.pages.set(this.key(scope.characterId, retained.conversation.subagentId), result);
    return result;
  }

  private merge(previous: Conversation, next: Conversation): Conversation {
    if (previous.conversation.subagentId !== next.conversation.subagentId) throw new Error("Conversation scope mismatch");
    const entries = new Map(previous.entries.map((entry) => [entry.seq, entry]));
    for (const entry of next.entries) {
      const previousEntry = entries.get(entry.seq);
      // Full bodies remain useful across unrelated invalidations; mutable status is refreshed separately.
      if (entry.body && previousEntry && !previousEntry.body) {
        if (entry.kind === "input" && previousEntry.kind === "input") entries.set(entry.seq,
          { ...previousEntry, input: { ...previousEntry.input, consumed: entry.input.consumed } });
        else if (entry.kind === "event" && previousEntry.kind === "event") entries.set(entry.seq,
          { ...previousEntry, event: { ...previousEntry.event, state: entry.event.state, reconciliationNeeded: entry.event.reconciliationNeeded } });
      } else entries.set(entry.seq, entry);
    }
    return { ...previous, conversation: next.conversation, entries: [...entries.values()].sort((a, b) => a.seq - b.seq) };
  }

  private assertCurrent(scope: ReadScope): void { if (!scope.current()) throw new Error("Retired conversation read"); }
}
