import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { BrowserPlaybackSample, BrowserPlaybackView } from "@taki/shared";
import { createViewingPlayback, eligiblePlayback, type ViewingInvitationPolicy } from "./viewing-playback.ts";

const policy: ViewingInvitationPolicy = { effectivePlaybackMs: 60_000, minimumRemainingSeconds: 120, invitationTtlMs: 120_000 };
function fixture() {
  const tracker = createViewingPlayback(); let time = 1_000_000;
  let source: BrowserPlaybackView = { sourceRef: randomUUID(), hostId: randomUUID(), connectionGeneration: 1, catalogGeneration: 1,
    attachmentId: randomUUID(), attachmentGeneration: 1, sequence: 0,
    source: { tabId: 1, frameId: 0, documentId: randomUUID(), playerId: randomUUID(), media: { kind: "bilibili", bvid: "BV1xx411c7mD", cid: "123", page: 1 } },
    sample: { state: "playing", positionSeconds: 500, durationSeconds: 3600, playbackRate: 1, visible: true, pictureInPicture: false },
    receivedAt: new Date(time).toISOString(), freshUntil: new Date(time + 5_000).toISOString() };
  function tick(input: { step?: number; sample?: Partial<BrowserPlaybackSample>; present?: boolean } = {}) {
    const step = input.step ?? 1000; time += step;
    source = { ...source, sequence: source.sequence + 1, sample: { ...source.sample,
      positionSeconds: (source.sample.positionSeconds ?? 0) + step / 1000 * (source.sample.playbackRate ?? 1), ...input.sample },
      receivedAt: new Date(time).toISOString(), freshUntil: new Date(time + 5000).toISOString() };
    return tracker.update([source], { now: time, present: input.present ?? true, policy })[0]!;
  }
  return { tracker, tick, source: () => source, now: () => time,
    update: (change: Partial<BrowserPlaybackView>) => { source = { ...source, ...change }; } };
}

describe("detected viewing effective playback", () => {
  it("requires actual elapsed playback even when opened far beyond position 60", () => {
    const f = fixture(); const first = f.tick(); expect(first.eligibleAt).toBeUndefined();
    for (let index = 0; index < 59; index++) f.tick();
    expect(f.tracker.update([f.source()], { now: f.now(), present: true, policy })[0]?.effectivePlaybackMs).toBe(59_000);
    expect(f.tick().eligibleAt).toBe(f.now());
  });
  it("counts 2x at wall time and excludes large forward/backward seeks", () => {
    const f = fixture(); f.tick({ sample: { playbackRate: 2 } });
    expect(f.tick().effectivePlaybackMs).toBe(1000);
    expect(f.tick({ sample: { positionSeconds: 1500 } }).effectivePlaybackMs).toBe(1000);
    expect(f.tick({ sample: { positionSeconds: 20 } }).effectivePlaybackMs).toBe(1000);
    expect(f.tick().effectivePlaybackMs).toBe(2000);
  });
  it.each(["paused", "buffering", "seeking", "ended"] as const)("does not accumulate %s or its boundary interval", (state) => {
    const f = fixture(); f.tick(); expect(f.tick({ sample: { state } }).effectivePlaybackMs).toBe(0);
    expect(f.tick({ sample: { state: "playing" } }).effectivePlaybackMs).toBe(0);
    expect(f.tick().effectivePlaybackMs).toBe(1000);
  });
  it("excludes hidden non-PiP, unknown presence and missing intervals", () => {
    const f = fixture(); f.tick(); f.tick({ sample: { visible: false } });
    expect(f.tick().effectivePlaybackMs).toBe(0);
    f.tick({ sample: { pictureInPicture: true } }); expect(f.tick().effectivePlaybackMs).toBe(1000);
    expect(f.tick({ present: false }).effectivePlaybackMs).toBe(1000);
    expect(f.tick().effectivePlaybackMs).toBe(1000);
    expect(f.tick({ step: 5000 }).effectivePlaybackMs).toBe(1000);
  });
  it("keeps a same-player viewing identity across lease renewal but never counts the lease gap", () => {
    const f = fixture(); const first = f.tick(); f.tick();
    f.update({ sourceRef: randomUUID(), attachmentGeneration: 2, sequence: 0 });
    const renewed = f.tick(); expect(renewed.viewingId).toBe(first.viewingId);
    expect(renewed.revision).not.toBe(first.revision); expect(renewed.effectivePlaybackMs).toBe(1000);
  });
  it("resets a changed video and distinguishes a return to the previous media", () => {
    const f = fixture(); const first = f.tick(); f.tick();
    f.update({ source: { ...f.source().source, media: { ...f.source().source.media, cid: "456" } } });
    const changed = f.tick(); expect(changed.viewingId).not.toBe(first.viewingId); expect(changed.effectivePlaybackMs).toBe(0);
    f.update({ source: { ...f.source().source, media: { ...f.source().source.media, cid: "123" } } });
    expect(f.tick().viewingId).not.toBe(first.viewingId);
  });
  it("refuses unknown duration and insufficient remaining time deterministically", () => {
    const f = fixture(); f.tick();
    expect(eligiblePlayback({ ...f.source(), sample: { ...f.source().sample, durationSeconds: null } }, policy)).toBe(false);
    expect(eligiblePlayback({ ...f.source(), sample: { ...f.source().sample, positionSeconds: 3500 } }, policy)).toBe(false);
    expect(eligiblePlayback({ ...f.source(), sample: { ...f.source().sample, positionSeconds: 3480 } }, policy)).toBe(true);
  });
});
