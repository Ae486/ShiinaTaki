/**
 * INPUT: fresh authoritative browser samples, real presence and the current invitation policy
 * OUTPUT: bounded same-view effective playback and stable source revisions without inference
 * POS: core/co-watching — observation reduction only; no timers, history rows, jobs or consent
 */
import { BROWSER_PLAYBACK_FRESH_MS, type BrowserPlaybackView } from "@taki/shared";
import { wakeDigest } from "../initiative/wake/wake-matcher.ts";

export interface ViewingInvitationPolicy {
  effectivePlaybackMs: number;
  minimumRemainingSeconds: number;
  invitationTtlMs: number;
}
export interface ViewingPlayback {
  viewingId: string;
  source: BrowserPlaybackView;
  effectivePlaybackMs: number;
  eligibleAt?: number;
  revision: string;
}
interface Slot { occurrence: number; identity: string; view: ViewingPlayback; previous?: BrowserPlaybackView }

export function createViewingPlayback() {
  const slots = new Map<string, Slot>();
  return {
    update(sources: readonly BrowserPlaybackView[], input: { now: number; present: boolean; policy: ViewingInvitationPolicy }): ViewingPlayback[] {
      const current: ViewingPlayback[] = [];
      for (const source of sources.slice(0, 64)) {
        if (!fresh(source, input.now)) continue;
        const key = wakeDigest(JSON.stringify([source.hostId, source.source.tabId, source.source.frameId]));
        const identity = wakeDigest(JSON.stringify([source.hostId, source.source]));
        const prior = slots.get(key);
        const slot = prior?.identity === identity ? prior : newSlot(source, identity, (prior?.occurrence ?? 0) + 1);
        if (!prior && slots.size >= 64) slots.delete(slots.keys().next().value!);
        slots.set(key, slot);
        consume(slot, source, input);
        current.push({ ...slot.view, source: structuredClone(slot.view.source) });
      }
      // A missing sample may return for this same viewing, but never contributes the unobserved interval.
      const ids = new Set(current.map((entry) => entry.viewingId));
      for (const slot of slots.values()) if (!ids.has(slot.view.viewingId)) slot.previous = undefined;
      return current;
    },
  };
}

function newSlot(source: BrowserPlaybackView, identity: string, occurrence: number): Slot {
  return { identity, occurrence, view: {
    viewingId: wakeDigest(`${identity}:${occurrence}`), source, effectivePlaybackMs: 0, revision: sourceRevision(source),
  } };
}
function sourceRevision(source: BrowserPlaybackView): string {
  return wakeDigest(JSON.stringify([source.sourceRef, source.hostId, source.connectionGeneration,
    source.catalogGeneration, source.attachmentId, source.attachmentGeneration]));
}
function fresh(source: BrowserPlaybackView, now: number): boolean {
  return Date.parse(source.receivedAt) <= now && now < Date.parse(source.freshUntil);
}
export function eligiblePlayback(source: BrowserPlaybackView, policy: ViewingInvitationPolicy): boolean {
  const sample = source.sample;
  return sample.state === "playing" && (sample.visible || sample.pictureInPicture)
    && sample.durationSeconds !== null && sample.positionSeconds !== null
    && sample.durationSeconds - sample.positionSeconds >= policy.minimumRemainingSeconds;
}
function consume(slot: Slot, source: BrowserPlaybackView, input: { now: number; present: boolean; policy: ViewingInvitationPolicy }): void {
  const previous = slot.previous;
  const revision = sourceRevision(source);
  const sameLease = revision === slot.view.revision;
  if (previous && sameLease && source.sequence === previous.sequence) {
    if (!input.present) slot.previous = undefined;
    return;
  }
  if (input.present && previous && sameLease && source.sequence > previous.sequence) {
    slot.view.effectivePlaybackMs += effectiveInterval(previous, source);
  }
  slot.view.source = source;
  slot.view.revision = revision;
  slot.previous = input.present ? source : undefined;
  if (slot.view.eligibleAt === undefined && input.present && slot.view.effectivePlaybackMs >= input.policy.effectivePlaybackMs
    && eligiblePlayback(source, input.policy)) slot.view.eligibleAt = input.now;
}
function effectiveInterval(before: BrowserPlaybackView, after: BrowserPlaybackView): number {
  const left = before.sample; const right = after.sample;
  const elapsed = Date.parse(after.receivedAt) - Date.parse(before.receivedAt);
  if (elapsed <= 0 || elapsed >= BROWSER_PLAYBACK_FRESH_MS || left.state !== "playing" || right.state !== "playing"
    || !(left.visible || left.pictureInPicture) || !(right.visible || right.pictureInPicture)
    || left.positionSeconds === null || right.positionSeconds === null || left.playbackRate === null) return 0;
  // Position is only a discontinuity detector. Seeks never buy dwell; 2x playback still earns wall time once.
  const progression = right.positionSeconds - left.positionSeconds;
  const expected = elapsed / 1000 * left.playbackRate;
  return progression > 0 && Math.abs(progression - expected) <= Math.max(0.75, expected * 0.25) ? elapsed : 0;
}
