/**
 * INPUT: explicit accepted operator actions, real playback changes and existing Core work/delivery owners
 * OUTPUT: one source-bound Co-Watching purpose per Character, optional preparation and guarded real publication
 * POS: core/co-watching — business composition; model ticks, secondary queues and execution tables are forbidden
 */
import { randomUUID } from "node:crypto";
import { CO_WATCHING_SKILL, CoWatchingStartSchema, CoWatchingInviteSchema, type CoWatchingControlResult,
  type CoWatchingReadResult, type CoWatchingStart, type CoWatchingInvite } from "@taki/shared";
import type { TurnInteractive } from "../mcp/mcp-turn-tools.ts";
import { createCoWatchingPublicationSource } from "./publication-source.ts";
import { coWatchingCurrent, coWatchingGate, coWatchingView, retireCoWatching } from "./runtime-source.ts";
import { prepareCoWatching } from "./runtime-model.ts";
import { coWatchingConversationContext } from "./conversation-context.ts";
import type { CoWatchingBinding, CoWatchingDependencies, CoWatchingRuntimeState } from "./runtime-types.ts";

export interface CoWatchingRuntime {
  read(characterId: string): CoWatchingReadResult;
  context(characterId: string): string;
  yieldToPrimary(characterId: string): void;
  start(input: CoWatchingStart, interactive: TurnInteractive): CoWatchingControlResult;
  invite(input: CoWatchingInvite, interactive: TurnInteractive): CoWatchingControlResult;
  stop(characterId: string, sessionId: string): CoWatchingControlResult;
  revise(input: { characterId: string; sessionId: string; instruction: string }): CoWatchingControlResult;
  playbackChanged(): void;
  released(): void;
  close(): Promise<void>;
}

export function createCoWatchingRuntime(deps: CoWatchingDependencies): CoWatchingRuntime {
  const state: CoWatchingRuntimeState = { deps, sessions: new Map(), closing: false, scheduled: false,
    work: new Set(), schedule: () => schedule(state) };
  let signature = "";
  return {
    read: (characterId) => read(state, characterId),
    context: (characterId) => coWatchingConversationContext(state, characterId),
    yieldToPrimary(characterId) {
      const session = state.sessions.get(characterId);
      if (!session || session.closed || !session.working || !session.controller) return;
      // Only this accepted task's preparation is interruptible. Other tools, tasks and foreground turns retain ownership.
      session.yieldRequested = true; session.workRequired = true;
      session.controller.abort("foreground conversation reserved");
    },
    start: (input, interactive) => start(state, input, { interactive }),
    invite: (input, interactive) => invite(state, input, interactive),
    stop: (characterId, sessionId) => stop(state, { characterId, sessionId }),
    revise: (input) => revise(state, input),
    playbackChanged() {
      const playback = deps.sources.read();
      for (const session of state.sessions.values()) {
        if (session.closed) continue;
        const position = playback.sources.find((source) => source.sourceRef === session.playback.sourceRef)?.sample.positionSeconds;
        if (position !== undefined && position !== null) {
          session.furthestPositionSeconds = Math.max(session.furthestPositionSeconds ?? 0, position);
        }
      }
      const next = JSON.stringify([playback.enabled, playback.sources.map((source) => [source.sourceRef, source.source.media,
        source.sample.state, source.sample.visible, source.sample.pictureInPicture])]);
      if (next !== signature) { signature = next; deps.onChanged("*"); }
      state.schedule();
    },
    released: state.schedule,
    async close() {
      state.closing = true;
      for (const session of state.sessions.values()) retireCoWatching(state, session, "shutdown");
      await Promise.allSettled([...state.work]);
    },
  };
}

function read(state: CoWatchingRuntimeState, characterId: string): CoWatchingReadResult {
  const playback = state.deps.sources.read();
  const session = state.sessions.get(characterId);
  return { characterId, enabled: playback.enabled, sources: playback.sources,
    analyses: state.deps.catalog.list().map(({ analysisId, title, media }) => ({ analysisId, title, media })),
    session: session ? coWatchingView(session) : null };
}

function invite(state: CoWatchingRuntimeState, candidate: CoWatchingInvite, interactive: TurnInteractive): CoWatchingControlResult {
  const { reanalyze, ...request } = CoWatchingInviteSchema.parse(candidate); const { deps } = state;
  const existing = state.sessions.get(request.characterId);
  if (existing?.request.requestId === request.requestId) return start(state, { ...request, analysisId: existing.request.analysisId }, { interactive });
  if (existing && !existing.closed) return { accepted: false, reason: "already_active" };
  const playback = deps.sources.resolve(request.sourceRef);
  if (state.closing || !playback || !deps.targetReady(request.characterId) || !deps.skills.describe(CO_WATCHING_SKILL)) return { accepted: false, reason: "not_ready" };
  if (reanalyze && (!existing?.closed || existing.reason !== "analysis_failed" || !existing.analysisRequest
    || JSON.stringify(existing.playback.source.media) !== JSON.stringify(playback.source.media))) return { accepted: false, reason: "not_ready" };
  const analysis = deps.catalog.list().find((entry) => JSON.stringify(entry.media) === JSON.stringify(playback.source.media)
    && deps.resultTool(entry.serverId)?.isCurrent());
  if (analysis && !reanalyze) return start(state, { ...request, analysisId: analysis.analysisId }, { interactive });
  const services = deps.analysisTools?.().filter((entry) => entry.isCurrent()
    && (!reanalyze || entry.serverId === existing?.analysisRequest?.serverId)) ?? [];
  // Multiple services require explicit setup/selection; never send user media to an arbitrary configured endpoint.
  if (services.length !== 1) return { accepted: false, reason: "not_ready" };
  const reserved = deps.catalog.reserve({ media: playback.source.media, serverId: services[0]!.serverId,
    ...(reanalyze ? { replaceRequestId: existing?.analysisRequest?.requestId } : {}) });
  return start(state, { ...request, analysisId: reserved.request.analysisId }, { interactive, submitAnalysis: reserved.created });
}

function start(state: CoWatchingRuntimeState, candidate: CoWatchingStart, options: { interactive: TurnInteractive; submitAnalysis?: boolean }): CoWatchingControlResult {
  const { interactive, submitAnalysis = false } = options;
  const request = CoWatchingStartSchema.parse(candidate); const { deps } = state;
  const existing = state.sessions.get(request.characterId);
  if (existing?.request.requestId === request.requestId) return JSON.stringify(existing.request) === JSON.stringify(request)
    ? { accepted: true, session: coWatchingView(existing) } : { accepted: false, reason: "request_conflict" };
  if (existing && !existing.closed) return { accepted: false, reason: "already_active" };
  if (state.closing || !deps.targetReady(request.characterId) || (!existing && state.sessions.size >= 64)) return { accepted: false, reason: "not_ready" };
  const analysis = deps.catalog.get(request.analysisId); const playback = deps.sources.resolve(request.sourceRef);
  const analysisRequest = analysis ? undefined : deps.catalog.request(request.analysisId);
  const analysisTools = analysisRequest && deps.analysisTools?.().find((entry) => entry.serverId === analysisRequest.serverId && entry.isCurrent());
  const skill = deps.skills.describe(CO_WATCHING_SKILL);
  const nativeTool = analysis ? deps.resultTool(analysis.serverId) : analysisTools && { toolKey: analysisTools.result, isCurrent: analysisTools.isCurrent };
  const media = analysis?.media ?? analysisRequest?.media;
  if (!media || !playback || !skill || !nativeTool || !nativeTool.isCurrent()
    || JSON.stringify(media) !== JSON.stringify(playback.source.media)) return { accepted: false, reason: "not_ready" };
  const lifetime = new AbortController();
  const session: CoWatchingBinding = { id: randomUUID(), request, analysis, playback, nativeTool, skillRevision: skill.contentRevision,
    analysisRequest, analysisTools, submitAnalysis, submissionAllowed: submitAnalysis,
    expiresAt: new Date(Date.now() + request.lifetimeMinutes * 60_000).toISOString(), revision: randomUUID(),
    status: "starting", reason: null, closed: false, lifetime, interactive: { ...interactive, signal: lifetime.signal },
    furthestPositionSeconds: playback.sample.positionSeconds,
    workRequired: true, working: false, publishing: false, settledCandidates: new Set(), sent: new Map(), committed: new Map() };
  session.source = createCoWatchingPublicationSource({
    readAccepted: () => ({ sourceRef: `co-watching:${session.id}`, acceptanceRef: session.id, characterId: request.characterId,
      revision: session.revision, expiresAt: session.expiresAt, policy: "accepted_co_watching" }),
    isCurrent: () => coWatchingCurrent(state, session),
    resolve: ({ candidateRef, expectedRevision }) => {
      const item = session.plan?.candidates.find((entry) => entry.candidateRef === candidateRef);
      return item && expectedRevision === session.revision ? { candidateRef, revision: session.revision,
        text: item.text, expiresAt: session.expiresAt } : undefined;
    }, gate: (candidate) => coWatchingGate(state, session, candidate),
  });
  state.sessions.set(request.characterId, session);
  session.deadline = setTimeout(() => retireCoWatching(state, session, "expired"), request.lifetimeMinutes * 60_000);
  session.deadline.unref(); deps.onChanged(request.characterId); state.schedule();
  return { accepted: true, session: coWatchingView(session) };
}

function stop(state: CoWatchingRuntimeState, input: { characterId: string; sessionId: string }): CoWatchingControlResult {
  const session = state.sessions.get(input.characterId);
  if (!session || session.id !== input.sessionId) return { accepted: false, reason: "not_found" };
  retireCoWatching(state, session, "stopped");
  return { accepted: true, session: coWatchingView(session) };
}

function revise(state: CoWatchingRuntimeState, input: { characterId: string; sessionId: string; instruction: string }): CoWatchingControlResult {
  const session = state.sessions.get(input.characterId);
  if (!session || session.id !== input.sessionId || session.closed) return { accepted: false, reason: "not_found" };
  if (!coWatchingCurrent(state, session)) { retireCoWatching(state, session, "source_lost"); return { accepted: false, reason: "not_ready" }; }
  if (session.owner) {
    session.edit ??= session.owner.beginEdit(session.revision);
    if (!session.edit) return { accepted: false, reason: "busy" };
  }
  session.pending = input.instruction; session.workRequired = true;
  session.status = "revising"; session.controller?.abort("revision superseded");
  state.deps.onChanged(input.characterId); state.schedule();
  return { accepted: true, session: coWatchingView(session) };
}

function schedule(state: CoWatchingRuntimeState): void {
  if (state.scheduled || state.closing) return;
  state.scheduled = true;
  queueMicrotask(() => {
    state.scheduled = false;
    for (const session of state.sessions.values()) {
      if (session.closed) continue;
      if (!coWatchingCurrent(state, session)) {
        retireCoWatching(state, session, state.deps.sources.resolve(session.playback.sourceRef) ? "authority_changed" : "source_lost");
        continue;
      }
      if (session.working || session.publishing) continue;
      if (session.workRequired) prepare(state, session);
      else if (session.plan) publish(state, session);
    }
  });
}

function prepare(state: CoWatchingRuntimeState, session: CoWatchingBinding): void {
  const release = state.deps.queue.tryAcquireBackground(session.request.characterId);
  if (!release) return;
  session.working = true;
  const work = prepareCoWatching(state, session).catch(() => {
    retireCoWatching(state, session, "preparation_failed");
  }).finally(() => {
    session.working = false; release(); state.work.delete(work); state.schedule();
  });
  state.work.add(work);
}

function publish(state: CoWatchingRuntimeState, session: CoWatchingBinding): void {
  if (!session.owner || !session.native || !session.plan || session.edit) return;
  session.publishing = true;
  const work = publishCandidates(state, session).catch(() => {
    retireCoWatching(state, session, "authority_changed");
  }).finally(() => { session.publishing = false; state.work.delete(work); });
  state.work.add(work);
}

async function publishCandidates(state: CoWatchingRuntimeState, session: CoWatchingBinding): Promise<void> {
  if (!session.owner || !session.plan || !session.native) return;
  const moments = new Map(session.native.analysis.moments.map((moment) => [moment.moment_id, moment]));
  const candidates = [...session.plan.candidates].sort((left, right) =>
    (moments.get(left.momentId)?.at_seconds ?? Infinity) - (moments.get(right.momentId)?.at_seconds ?? Infinity));
  for (const item of candidates) {
    if (session.closed || session.edit || session.workRequired) return;
    if (session.settledCandidates.has(item.candidateRef)) continue;
    const source = state.deps.sources.resolve(session.playback.sourceRef); const moment = moments.get(item.momentId);
    if (!source || !moment || source.sample.positionSeconds === null || source.sample.positionSeconds < moment.at_seconds) break;
    const result = await session.owner.publish({ candidateRef: item.candidateRef, expectedRevision: session.revision });
    if (result.status === "deferred") break;
    if (result.status === "refused") {
      if (result.reason === "output_committed") { session.settledCandidates.add(item.candidateRef); continue; }
      if (session.edit || session.workRequired) return;
      retireCoWatching(state, session, "authority_changed"); return;
    }
    if (["sent", "unknown", "no_target", "dispatch_committed", "expired", "suppressed"].includes(result.state)) {
      session.settledCandidates.add(item.candidateRef);
      if (["sent", "unknown", "no_target", "dispatch_committed"].includes(result.state)) {
        session.committed.set(item.candidateRef, { text: item.text, momentId: item.momentId });
      }
      if (result.state === "sent") session.sent.set(item.candidateRef, { text: item.text, momentId: item.momentId });
      state.deps.onChanged(session.request.characterId);
    }
    if (result.state === "held") break;
  }
}
