/**
 * INPUT: accepted browser observations, Wake selections and evidence from an admitted governed Run
 * OUTPUT: finite media opportunities and committed invitation actions bound to the same viewing
 * POS: core/co-watching — domain source adapter; canonical execution/publication stay with Wake/Run/Delivery
 */
import { randomUUID } from "node:crypto";
import { HeartbeatDecisionSchema, type BrowserPlaybackView, type CoWatchingControlResult,
  type CoWatchingInvitation, type CoWatchingInvitationReadResult, type CoWatchingInvitationRespond,
  type CoWatchingInvitationRespondResult, type InitiativeViewingFact } from "@taki/shared";
import type { Database } from "../db/sqlite.ts";
import type { TurnContext } from "../agents/chat-agent.ts";
import type { TurnInteractive } from "../mcp/mcp-turn-tools.ts";
import type { BrowserPlaybackSources } from "../perception/browser-playback-sources.ts";
import type { WakeSelection } from "../initiative/wake/wake-contract.ts";
import { createViewingPlayback, eligiblePlayback, type ViewingInvitationPolicy, type ViewingPlayback } from "./viewing-playback.ts";

export type { ViewingInvitationPolicy } from "./viewing-playback.ts";
export interface ViewingInvitationPreparation { source: BrowserPlaybackView; expiresAt: number; isCurrent(): boolean }
/** Return only after exact-media acquisition and real screened capture succeed under the supplied Run. */
export interface ViewingInvitationEvidence { title: string; text: string; isCurrent(): boolean }
interface Dependencies {
  db: Database;
  sources: Pick<BrowserPlaybackSources, "read">;
  policy(): ViewingInvitationPolicy;
  ready?(): boolean;
  presence(): "present" | "unknown";
  activeSession(characterId: string): boolean;
  acceptedSource?(characterId: string): string | undefined;
  prepareEvidence(input: ViewingInvitationPreparation, turn: TurnContext): Promise<ViewingInvitationEvidence | undefined>;
  startAccepted(input: { characterId: string; requestId: string; sourceRef: string }, interactive: TurnInteractive): CoWatchingControlResult;
  onChanged(characterId: string): void;
  now?(): number;
}
interface Invitation {
  id: string; version: number; characterId: string; viewingId: string; sourceRevision: string;
  candidateId: string; runId: string; expiresAt: number; source: BrowserPlaybackView;
  evidence?: ViewingInvitationEvidence; published?: { seq: number; expiresAt: number };
  retired?: boolean;
  handled?: "accept" | "defer";
}
interface State {
  deps: Dependencies; now(): number; tracker: ReturnType<typeof createViewingPlayback>;
  records: Map<string, Invitation>; commands: Map<string, { payload: string; result: CoWatchingInvitationRespondResult }>;
  signatures: Map<string, string>; closed: boolean;
  suppressed: Set<string>;
}
export interface ViewingInvitationSource {
  facts(characterId: string): InitiativeViewingFact[];
  isCurrent(selection: WakeSelection): boolean;
  admitted(selection: WakeSelection, identity: { runId: string; attemptId: string }): boolean;
  prepareInput(selection: WakeSelection, turn: TurnContext): Promise<string | undefined>;
  read(characterId: string): CoWatchingInvitationReadResult;
  respond(input: CoWatchingInvitationRespond, interactive: TurnInteractive): CoWatchingInvitationRespondResult;
  changed(): void;
  close(): void;
}

export function createViewingInvitationSource(deps: Dependencies): ViewingInvitationSource {
  const state: State = { deps, now: deps.now ?? Date.now, tracker: createViewingPlayback(), records: new Map(),
    commands: new Map(), signatures: new Map(), suppressed: new Set(), closed: false };
  return {
    facts: (characterId) => facts(state, characterId),
    isCurrent: (selection) => currentSelection(state, selection),
    admitted: (selection, identity) => admit(state, selection, identity.runId),
    prepareInput: (selection, turn) => prepare(state, selection, turn),
    read: (characterId) => ({ characterId, invitation: readInvitation(state, characterId) }),
    respond: (input, interactive) => respond(state, input, interactive),
    changed() {
      views(state);
      for (const characterId of new Set([...state.records.values()].map((record) => record.characterId))) {
        const signature = JSON.stringify(readInvitation(state, characterId));
        if (state.signatures.get(characterId) === signature) continue;
        state.signatures.set(characterId, signature); deps.onChanged(characterId);
      }
    },
    close() { state.closed = true; state.records.clear(); state.commands.clear(); state.signatures.clear(); state.suppressed.clear(); },
  };
}
function views(state: State): ViewingPlayback[] {
  const playback = state.deps.sources.read();
  return state.tracker.update(state.closed || !playback.enabled ? [] : playback.sources,
    { now: state.now(), present: state.deps.presence() === "present", policy: state.deps.policy() });
}
function facts(state: State, characterId: string): InitiativeViewingFact[] {
  if (state.closed || state.deps.ready?.() === false) return [];
  const observed = views(state);
  const acceptedSource = state.deps.acceptedSource?.(characterId);
  const accepted = observed.find((view) => view.source.sourceRef === acceptedSource);
  if (accepted) suppress(state, characterId, accepted.viewingId);
  if (state.deps.activeSession(characterId)) return [];
  const selected = observed.filter((view) => view.source.sample.state === "playing"
    && (view.source.sample.visible || view.source.sample.pictureInPicture));
  // Observation contains no user-selected tie-breaker across simultaneous players/Hosts.
  if (selected.length !== 1) return [];
  return selected.flatMap((view): InitiativeViewingFact[] => {
    if (view.eligibleAt === undefined || !eligiblePlayback(view.source, state.deps.policy())
      || handled(state, characterId, view.viewingId)) return [];
    const expiresAt = view.eligibleAt + state.deps.policy().invitationTtlMs;
    return expiresAt <= state.now() ? [] : [{ characterId, viewingId: view.viewingId,
      sourceRevision: view.revision, eligibleAt: view.eligibleAt, expiresAt }];
  });
}
function handled(state: State, characterId: string, viewingId: string): boolean {
  return state.suppressed.has(`${characterId}:${viewingId}`) || [...state.records.values()].some((record) => record.characterId === characterId
    && record.viewingId === viewingId && record.handled !== undefined);
}
function suppress(state: State, characterId: string, viewingId: string): void {
  state.suppressed.add(`${characterId}:${viewingId}`);
  if (state.suppressed.size > 128) state.suppressed.delete(state.suppressed.values().next().value!);
}
function currentSelection(state: State, selection: WakeSelection): boolean {
  const media = selection.candidates.filter((candidate) => candidate.kind === "media");
  if (!media.length) return true;
  const current = facts(state, selection.characterId);
  return media.every((candidate) => current.some((view) => view.viewingId === candidate.viewingId
    && view.sourceRevision === candidate.sourceRevision) && [...state.records.values()].filter((record) =>
      record.candidateId === candidate.candidateId && record.sourceRevision === candidate.sourceRevision)
    .every((record) => !record.retired && (record.evidence === undefined || evidenceCurrent(record))));
}
function admit(state: State, selection: WakeSelection, runId: string): boolean {
  const candidate = selection.candidates.find((entry) => entry.kind === "media");
  if (!candidate) return true;
  if (!currentSelection(state, selection)) return false;
  const source = views(state).find((view) => view.viewingId === candidate.viewingId)?.source;
  if (!source) return false;
  if (state.records.has(runId)) return true;
  // These are disposable source handles. Durable claims and committed publication remain in the existing repos.
  if (state.records.size >= 64) state.records.delete(state.records.keys().next().value!);
  state.records.set(runId, { id: randomUUID(), version: 0, characterId: selection.characterId,
    viewingId: candidate.viewingId, sourceRevision: candidate.sourceRevision, candidateId: candidate.candidateId,
    runId, expiresAt: selection.expiresAt, source: structuredClone(source) });
  return true;
}
function currentSource(state: State, record: Invitation): BrowserPlaybackView | undefined {
  if (state.closed || record.handled || record.retired) return;
  if (state.deps.ready?.() === false || state.deps.activeSession(record.characterId)) { record.retired = true; return; }
  const view = views(state).find((entry) => entry.viewingId === record.viewingId && entry.revision === record.sourceRevision);
  const sample = view?.source.sample;
  // Opening Chat to answer an already committed invitation may hide/pause the video; that is still explicit consent.
  if (!sample || sample.durationSeconds === null || sample.positionSeconds === null
    || sample.durationSeconds - sample.positionSeconds < state.deps.policy().minimumRemainingSeconds) {
    record.retired = true; return;
  }
  return view?.source;
}
function evidenceCurrent(record: Invitation): boolean {
  try { if (record.evidence?.isCurrent() === true) return true; }
  catch { /* A failed evidence authority is unavailable, never a reason to reopen an old invitation. */ }
  record.retired = true;
  return false;
}
async function prepare(state: State, selection: WakeSelection, turn: TurnContext): Promise<string | undefined> {
  const record = turn.runId && state.records.get(turn.runId);
  if (!record || !currentSelection(state, selection) || !turn.runContext || turn.signal?.aborted) return;
  const isCurrent = () => state.now() < (record.published?.expiresAt ?? record.expiresAt)
    && !turn.signal?.aborted && currentSource(state, record) !== undefined;
  const evidence = await state.deps.prepareEvidence({ source: structuredClone(record.source),
    expiresAt: record.expiresAt + state.deps.policy().invitationTtlMs, isCurrent }, turn);
  if (!isCurrent() || !currentSelection(state, selection) || !evidence?.isCurrent() || !evidence.text.trim()
    || evidence.text.length > 7_000 || !evidence.title.trim()) return;
  record.evidence = { ...evidence, title: evidence.title.trim().slice(0, 240).replace(/[\uD800-\uDBFF]$/u, "") };
  return evidence.text + "\nThis is an unsolicited Co-Watching invitation decision, not acceptance. "
    + "If inviting, choose speak with responseExpectation=invitation. Do not claim detailed analysis is ready. Otherwise remain silent.";
}
function syncPublication(state: State, record: Invitation): void {
  if (record.published || !record.evidence) return;
  const row = state.deps.db.prepare("SELECT timeline_seq,charged_at,decision_json FROM run_deliveries WHERE run_id=:runId AND delivery_class='class_b'")
    .get({ runId: record.runId });
  if (!row || typeof row.timeline_seq !== "number" || typeof row.charged_at !== "string" || typeof row.decision_json !== "string") return;
  const decision = HeartbeatDecisionSchema.safeParse(JSON.parse(row.decision_json));
  if (!decision.success || decision.data.outcome !== "speak" || decision.data.responseExpectation !== "invitation"
    || !decision.data.selectedCandidateIds.includes(record.candidateId)) return;
  record.published = { seq: row.timeline_seq, expiresAt: Date.parse(row.charged_at) + state.deps.policy().invitationTtlMs };
}
function readInvitation(state: State, characterId: string): CoWatchingInvitation | null {
  for (const record of [...state.records.values()].reverse()) {
    if (record.characterId !== characterId || record.handled) continue;
    syncPublication(state, record);
    if (!record.published || state.now() >= record.published.expiresAt || !currentSource(state, record) || !evidenceCurrent(record) || !record.evidence) continue;
    return { invitationId: record.id, version: record.version, characterId, media: structuredClone(record.source.source.media),
      title: record.evidence.title, timelineSeq: record.published.seq, expiresAt: new Date(record.published.expiresAt).toISOString() };
  }
  return null;
}
function respond(state: State, input: CoWatchingInvitationRespond, interactive: TurnInteractive): CoWatchingInvitationRespondResult {
  const payload = JSON.stringify(input); const previous = state.commands.get(input.commandId);
  if (previous) return previous.payload === payload ? previous.result : { status: "refused", reason: "command_conflict" };
  const record = [...state.records.values()].find((entry) => entry.id === input.invitationId && entry.characterId === input.characterId);
  let result: CoWatchingInvitationRespondResult;
  if (!record) result = { status: "refused", reason: "not_found" };
  else if (record.handled) result = { status: "refused", reason: "already_handled" };
  else if (record.version !== input.expectedVersion || readInvitation(state, input.characterId)?.invitationId !== input.invitationId) {
    result = { status: "refused", reason: "stale" };
  } else result = applyResponse(state, { input, record }, interactive);
  if (state.commands.size >= 128) state.commands.delete(state.commands.keys().next().value!);
  state.commands.set(input.commandId, { payload, result });
  return result;
}
function applyResponse(state: State, selection: { input: CoWatchingInvitationRespond; record: Invitation }, interactive: TurnInteractive): CoWatchingInvitationRespondResult {
  const { input, record } = selection;
  if (input.action === "defer") {
    record.handled = "defer"; record.version += 1; suppress(state, record.characterId, record.viewingId); state.deps.onChanged(record.characterId);
    return { status: "applied", action: "defer", session: null };
  }
  const source = currentSource(state, record);
  if (!source || !evidenceCurrent(record)) return { status: "refused", reason: "stale" };
  const result = state.deps.startAccepted({ characterId: input.characterId, requestId: input.commandId, sourceRef: source.sourceRef }, interactive);
  if (!result.accepted) return { status: "refused", reason: "not_ready" };
  record.handled = "accept"; record.version += 1; suppress(state, record.characterId, record.viewingId); state.deps.onChanged(record.characterId);
  return { status: "applied", action: "accept", session: result.session };
}
