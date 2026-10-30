/**
 * INPUT: exact displayed work targets and explicit editor/submission revisions
 * OUTPUT: in-memory per-work drafts that survive navigation and refuse silent retargeting
 * POS: ui/subagents — editor ownership only; never persisted and never an offline command queue
 */
import type { SubagentTarget, SubagentInput } from "@taki/shared";
import { sameTarget } from "./subagent-state.ts";

export interface SubagentDraft {
  text: string;
  revision: number;
  target: SubagentTarget | null;
  uncertain: boolean;
  submitted?: { operationKey: string; revision: number };
}

export class SubagentDrafts {
  private readonly entries = new Map<string, SubagentDraft>();
  private key(characterId: string, target: SubagentTarget): string {
    return JSON.stringify([characterId, target.subagentId, target.workInputId]);
  }
  get(characterId: string, target: SubagentTarget): SubagentDraft {
    return this.entries.get(this.key(characterId, target)) ?? { text: "", revision: 0, target: null, uncertain: false };
  }
  edit(characterId: string, target: SubagentTarget, text: string): void {
    const previous = this.get(characterId, target);
    this.entries.set(this.key(characterId, target), { ...previous, text, revision: previous.revision + 1,
      target: previous.target ?? target });
  }
  confirm(characterId: string, target: SubagentTarget): void {
    const previous = this.get(characterId, target);
    this.entries.set(this.key(characterId, target), { ...previous, target, uncertain: false, revision: previous.revision + 1 });
  }
  accepted(characterId: string, submitted: { target: SubagentTarget; revision: number }): void {
    const previous = this.get(characterId, submitted.target);
    if (previous.revision !== submitted.revision) return;
    this.entries.set(this.key(characterId, submitted.target), { text: "", target: null, uncertain: false, revision: previous.revision + 1 });
  }
  uncertain(characterId: string, target: SubagentTarget): void {
    const previous = this.get(characterId, target);
    this.entries.set(this.key(characterId, target), { ...previous, uncertain: true });
  }
  ready(characterId: string, target: SubagentTarget): boolean {
    const draft = this.get(characterId, target);
    return !draft.uncertain && (!draft.target || sameTarget(draft.target, target));
  }
  submitted(characterId: string, target: SubagentTarget, operationKey: string): void {
    const previous = this.get(characterId, target);
    this.entries.set(this.key(characterId, target), { ...previous, submitted: { operationKey, revision: previous.revision } });
  }
  reconcile(characterId: string, input: SubagentInput): boolean {
    const key = JSON.stringify([characterId, input.subagentId, input.workInputId]);
    const draft = this.entries.get(key);
    if (!draft?.submitted || draft.submitted.operationKey !== input.operationKey) return false;
    const unchanged = draft.revision === draft.submitted.revision;
    this.entries.set(key, { ...draft, submitted: undefined, uncertain: false,
      ...(unchanged ? { text: "", target: null, revision: draft.revision + 1 } : {}) });
    return true;
  }
}
