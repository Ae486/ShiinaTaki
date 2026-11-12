/**
 * INPUT:  semantic Pet bubble items and explicit presentation/motion lifecycle boundaries
 * OUTPUT: finite occupied-space groups with distinct entering/present/exiting item identities
 * POS:    ui/chat-bubble — pure visual bookkeeping; it never delays ingestion or changes tool/turn state
 */
import type { BubbleTranscript, BubbleTranscriptItem } from "./bubble-transcript.ts";

export type BubblePresencePhase = "entering" | "present" | "exiting";
export interface BubblePresenceRow {
  item: BubbleTranscriptItem;
  phase: BubblePresencePhase;
  token: number;
}
export interface BubblePresenceGroup {
  key: string;
  order: number;
  rows: BubblePresenceRow[];
  revision: number;
  instant: boolean;
}
export interface BubblePresenceInput {
  transcript: BubbleTranscript;
  presentationVersion: number;
  motion: boolean;
}
export interface BubblePresenceState extends BubblePresenceInput {
  groups: BubblePresenceGroup[];
  nextToken: number;
}
interface GroupDraft {
  key: string;
  order: number;
  previous?: BubblePresenceGroup;
  active: BubblePresenceRow[];
}
interface PresenceBuild {
  groups: BubblePresenceGroup[];
  byItem: Map<string, { group: BubblePresenceGroup; row: BubblePresenceRow }>;
  desired: Set<string>;
  drafts: Map<string, GroupDraft>;
  nextToken: number;
  instant: boolean;
}

export function initialBubblePresence(input: BubblePresenceInput): BubblePresenceState {
  const previous = { ...input, groups: [], nextToken: 1 };
  const initial = reconcileBubblePresence(previous, { ...input, motion: false });
  return { ...initial, motion: input.motion };
}

export function reconcileBubblePresence(previous: BubblePresenceState, input: BubblePresenceInput): BubblePresenceState {
  const replaced = previous.transcript.key !== input.transcript.key;
  const groups = replaced ? [] : previous.groups;
  const build: PresenceBuild = { groups, byItem: new Map(groups.flatMap((group) => group.rows.map((row) => [row.item.key, { group, row }]))),
    desired: new Set(input.transcript.items.map((item) => item.key)), drafts: new Map(), nextToken: previous.nextToken,
    instant: replaced || previous.presentationVersion !== input.presentationVersion || !input.motion };
  for (const item of input.transcript.items) placeItem(build, item);
  const next = [...build.drafts.values()].map((draft) => finishDraft(build, draft));
  if (!build.instant) {
    for (const group of groups) if (!build.drafts.has(group.key)) next.push(exitGroup(build, group));
  }
  next.sort((left, right) => left.order - right.order);
  return { ...input, groups: next, nextToken: build.nextToken };
}

function placeItem(build: PresenceBuild, item: BubbleTranscriptItem): void {
  const previous = build.byItem.get(item.key);
  const draft = chooseGroup(build, item, previous?.group);
  const phase: BubblePresencePhase = build.instant ? "present"
    : previous?.row.phase === "exiting" ? "entering" : previous?.row.phase ?? "entering";
  const token = previous?.row.phase === phase ? previous.row.token : build.nextToken++;
  draft.active.push({ item, phase, token });
  draft.order = Math.min(draft.order, item.order);
}

function chooseGroup(build: PresenceBuild, item: BubbleTranscriptItem, existing?: BubblePresenceGroup): GroupDraft {
  const tail = [...build.drafts.values()].at(-1);
  // Consecutive tools share one occupancy envelope while retaining their separate row identities and outcomes.
  if (!existing && item.kind === "tool" && tail?.active.every((row) => row.item.kind === "tool")) return tail;
  const replacement = existing ?? build.groups.find((group) => !build.drafts.has(group.key)
    && group.order >= (tail?.order ?? Number.NEGATIVE_INFINITY)
    && group.rows.every((row) => !build.desired.has(row.item.key)
      && (row.phase === "exiting" || row.item.kind === "tool" || row.item.kind === "waiting")));
  const key = replacement?.key ?? `group:${item.key}`;
  const draft = build.drafts.get(key) ?? { key, order: item.order, previous: replacement, active: [] };
  build.drafts.set(key, draft);
  return draft;
}

function exitingRow(build: PresenceBuild, row: BubblePresenceRow): BubblePresenceRow {
  return row.phase === "exiting" ? row : { ...row, phase: "exiting", token: build.nextToken++ };
}

function finishDraft(build: PresenceBuild, draft: GroupDraft): BubblePresenceGroup {
  const previous = draft.previous;
  const activeKeys = new Set(draft.active.map((row) => row.item.key));
  const exits = build.instant ? [] : (previous?.rows ?? [])
    .filter((row) => !activeKeys.has(row.item.key)).map((row) => exitingRow(build, row));
  const before = previous?.rows.filter((row) => row.phase !== "exiting").map((row) => row.item.key) ?? [];
  const changed = before.length !== draft.active.length || before.some((key, index) => key !== draft.active[index]?.item.key);
  return { key: draft.key, order: draft.order, rows: [...draft.active, ...exits], instant: build.instant,
    revision: (previous?.revision ?? 0) + (changed ? 1 : 0) };
}

function exitGroup(build: PresenceBuild, group: BubblePresenceGroup): BubblePresenceGroup {
  return { ...group, rows: group.rows.map((row) => exitingRow(build, row)), instant: false,
    revision: group.revision + (group.rows.some((row) => row.phase !== "exiting") ? 1 : 0) };
}

export function settleBubbleRow(state: BubblePresenceState, input: { groupKey: string; itemKey: string; token: number }): BubblePresenceState {
  let changed = false;
  const groups = state.groups.map((group) => {
    if (group.key !== input.groupKey) return group;
    const rows = group.rows.flatMap((row): BubblePresenceRow[] => {
      if (row.item.key !== input.itemKey || row.token !== input.token || row.phase === "present") return [row];
      changed = true;
      return row.phase === "exiting" ? [] : [{ ...row, phase: "present" }];
    });
    return changed ? { ...group, rows } : group;
  });
  return changed ? { ...state, groups } : state;
}

export function settleEmptyBubbleGroup(state: BubblePresenceState, input: { groupKey: string; revision: number }): BubblePresenceState {
  const groups = state.groups.filter((group) => group.key !== input.groupKey || group.revision !== input.revision
    || group.rows.some((row) => row.phase !== "exiting"));
  return groups.length === state.groups.length ? state : { ...state, groups };
}
