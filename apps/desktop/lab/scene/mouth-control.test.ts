import { describe, expect, it } from "vitest";

import type { FrameContext, Overlay } from "./frame-hooks.ts";
import type { ModelContext } from "./lab-scene.ts";
import { MouthControl, type MouthMode } from "./mouth-control.ts";
import { createMouthTrack } from "./mouth-track.ts";
import type { PreparedMouthClip } from "../speech/mouth-preparation.ts";

function fakeContext(costume: string, generation: "cubism2" | "cubism3") {
  const values = new Map<string, number>();
  const overlays = new Set<Overlay>();
  const manager = {
    currentAudio: undefined as { isPlaying: boolean; duration: number; instances: { progress: number }[] } | undefined,
    currentContext: { state: "running" },
  };
  const params = { has: () => true, get: (id: string) => values.get(id) ?? 0, set: (id: string, value: number) => { values.set(id, value); } };
  const ctx = {
    entry: { characterId: "taki", costume },
    internal: { motionManager: manager, lipSync: true },
    params,
    hooks: { add: (_position: string, fn: Overlay) => { overlays.add(fn); return () => { overlays.delete(fn); }; } },
    facts: { generation, lipSyncIds: [] },
  };
  const frame = { nowMs: 0, dtMs: 16, params } as unknown as FrameContext;
  return { ctx: ctx as unknown as ModelContext, internal: ctx.internal, manager, values, overlays,
    fire: () => { for (const fn of overlays) fn(frame); },
    play: (progress: number) => { manager.currentAudio = { isPlaying: true, duration: 4, instances: [{ progress }] }; } };
}

function preparedClip(): PreparedMouthClip {
  const track = createMouthTrack({ durationMs: 4000, source: "envelope", approximate: true,
    cues: [{ startMs: 0, endMs: 4000, mouth: "open", openness: 1, confidence: 1 }] });
  return { track, decodeMs: 1, envelopeMs: 1, durationMs: 4000 };
}

async function readyControl(costume = "arbeit", generation: "cubism2" | "cubism3" = "cubism2", mode: MouthMode = "envelope") {
  const fake = fakeContext(costume, generation);
  const control = new MouthControl(async () => preparedClip());
  control.attach(fake.ctx);
  control.setMode(mode);
  await control.prepare(new ArrayBuffer(8));
  return { ...fake, control };
}

describe("mouth control", () => {
  it("reports a missing profile as the fallback reason and never claims native lip-sync on an unsupported rig", async () => {
    const { control, internal, overlays } = await readyControl("casual");
    control.startPlayback();
    const snapshot = control.snapshot();
    expect(snapshot.profileId).toBeNull();
    expect(snapshot.fallbackReason).toBe("No calibrated profile for this character/costume");
    expect(snapshot.effectiveMode).toBe("native");
    expect(snapshot.writer).toBeNull();
    expect(internal.lipSync).toBe(true);
    expect(overlays.size).toBe(0);
  });

  it("ignores a late preparation result after clearInput or cancelPreparation", async () => {
    const fake = fakeContext("arbeit", "cubism2");
    const pending: ((clip: PreparedMouthClip) => void)[] = [];
    const control = new MouthControl(() => new Promise<PreparedMouthClip>((done) => { pending.push(done); }));
    control.attach(fake.ctx);
    control.setMode("envelope");
    const preparing = control.prepare(new ArrayBuffer(8));
    expect(control.snapshot().preparation.status).toBe("preparing");
    control.clearInput();
    pending.shift()?.(preparedClip());
    await preparing;
    expect(control.snapshot().preparation.status).toBe("empty");
    expect(control.snapshot().fallbackReason).toBe("No prepared envelope");
    const second = control.prepare(new ArrayBuffer(8));
    control.cancelPreparation();
    pending.shift()?.(preparedClip());
    await second;
    expect(control.snapshot().preparation.status).toBe("empty");
    control.startPlayback();
    expect(control.snapshot().writer).toBeNull();
  });

  it("owns native lip-sync only while the envelope writer runs and restores it on stop, attach(null) and dispose", async () => {
    for (const terminal of ["stop", "attach", "dispose"] as const) {
      const { control, internal, overlays, fire, values, play } = await readyControl();
      play(0.25);
      control.startPlayback();
      expect(internal.lipSync).toBe(false);
      expect(overlays.size).toBe(1);
      fire();
      expect(values.get("PARAM_MOUTH_OPEN_Y")).toBeCloseTo(0.8);
      expect(control.snapshot().writer?.enabled).toBe(true);
      if (terminal === "stop") control.stop();
      else if (terminal === "attach") control.attach(null);
      else control.dispose();
      expect(internal.lipSync).toBe(true);
      expect(overlays.size).toBe(0);
      expect(control.snapshot().writer).toBeNull();
    }
  });

  it("falls back to native playback when the audio position is unavailable after speak resolved", async () => {
    const { control, internal, manager } = await readyControl();
    control.startPlayback();
    expect(internal.lipSync).toBe(false);
    manager.currentAudio = { isPlaying: true, duration: 4, instances: [{ progress: 0 }, { progress: 0 }] };
    control.confirmPlayback();
    const snapshot = control.snapshot();
    expect(snapshot.writer).toBeNull();
    expect(snapshot.fallbackReason).toBe("Audio position unavailable; native playback active");
    expect(snapshot.effectiveMode).toBe("native");
    expect(internal.lipSync).toBe(true);
  });

  it("previews authored poses with native lip-sync suspended and restores it on off or mode change", async () => {
    const { control, internal, fire, values } = await readyControl("live_01", "cubism3", "native");
    control.previewPose("a");
    fire();
    expect(control.snapshot()).toMatchObject({ preview: "a", effectiveMode: "preview" });
    expect(internal.lipSync).toBe(false);
    expect(values.get("ParamMouthOpenY")).toBeCloseTo(0.85);
    control.previewPose("off");
    expect(control.snapshot().preview).toBe("off");
    expect(internal.lipSync).toBe(true);
    control.previewPose("o");
    expect(internal.lipSync).toBe(false);
    control.setMode("envelope");
    expect(control.snapshot().preview).toBe("off");
    expect(internal.lipSync).toBe(true);
    const unsupported = await readyControl("casual");
    unsupported.control.previewPose("a");
    expect(unsupported.control.snapshot().preview).toBe("off");
    expect(unsupported.internal.lipSync).toBe(true);
    expect(unsupported.overlays.size).toBe(0);
  });

  it("derives the writer clock from audio progress so suspension freezes elapsed time", async () => {
    const { control, manager, fire, play } = await readyControl();
    play(0.25);
    control.startPlayback();
    control.confirmPlayback();
    fire();
    expect(control.snapshot().writer?.elapsedMs).toBeCloseTo(1000);
    expect(control.snapshot().clock).toEqual({ positionMs: 1000, source: "pixi-sound-progress", contextState: "running" });
    manager.currentContext.state = "suspended";
    fire();
    expect(control.snapshot().writer?.elapsedMs).toBeCloseTo(1000);
    expect(control.snapshot().clock.contextState).toBe("suspended");
    manager.currentContext.state = "running";
    manager.currentAudio!.instances[0]!.progress = 0.5;
    fire();
    expect(control.snapshot().writer?.elapsedMs).toBeCloseTo(2000);
  });

  it("reports each selected arm as the effective mode and starts a writer only for envelope", async () => {
    for (const mode of ["native", "native-tuned", "envelope"] as const) {
      const { control, internal } = await readyControl("arbeit", "cubism2", mode);
      expect(control.snapshot().effectiveMode).toBe(mode);
      expect(control.parameterIds()).toEqual(["PARAM_MOUTH_OPEN_Y", "PARAM_MOUTH_FORM_01", "PARAM_MOUTH_FORM_Y", "PARAM_MOUTH_SCALE"]);
      control.startPlayback();
      expect(control.snapshot().writer !== null).toBe(mode === "envelope");
      expect(internal.lipSync).toBe(mode !== "envelope");
      expect(control.snapshot().effectiveMode).toBe(mode);
      control.dispose();
    }
  });
});
