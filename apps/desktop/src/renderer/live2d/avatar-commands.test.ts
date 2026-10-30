/**
 * INPUT:  avatar commands (known/unknown names, motion knobs) + a fake model whose engine promises + pre-call state
 *         reproduce the Lab table (archive 09-03 production-command-findings-2026-09-08).
 * OUTPUT: assertions on the Presentation Outcome classification: applied, already_active, motion_busy, speaking,
 *         superseded, unknown_name (+ drift sink), unavailable (false / throw) — and that nothing ever throws.
 * POS:    unit test for the avatar command applier (F3 / D80). The engine is mocked so its runtime enum loads in node
 *         (avatar-commands imports MotionPriority as a value). Exempt from size caps.
 */

import { describe, expect, it, vi } from "vitest";

// avatar-commands imports MotionPriority as a runtime value; mock the engine so the module loads without a WebGL/window graph.
vi.mock("untitled-pixi-live2d-engine", () => ({
  MotionPriority: { NONE: 0, IDLE: 1, NORMAL: 2, FORCE: 3 },
}));

import type { Live2DModel } from "untitled-pixi-live2d-engine";
import type { AvatarCommand } from "@taki/shared";
import { applyAvatarCommand } from "./avatar-commands.ts";
import type { AvatarVocabulary } from "./model-vocabulary.ts";

const VOCAB: AvatarVocabulary = { motions: ["angry01", "smile01"], expressions: ["default", "shame01", "smile"] };

interface FakeState {
  currentPriority: number;
  reservePriority: number;
  audioPlaying: boolean | null;
  currentExpression: string;
}

// A fake mirroring the engine's rules: expression() returns false when the name is already current (index equality)
// or when a newer expression reserved the slot; motion() returns false under reserve/audio refusal. Results can also
// be scripted directly to reproduce a reservation replacement observed in the Lab.
function fakeModel(state: Partial<FakeState> = {}) {
  const s: FakeState = { currentPriority: 0, reservePriority: 0, audioPlaying: null, currentExpression: "default", ...state };
  const expressions = VOCAB.expressions.map((name) => ({ name }));
  const expressionManager = {
    expressions,
    get currentExpression() { return expressions.find((e) => e.name === s.currentExpression); },
    getExpressionIndex: (name: string) => VOCAB.expressions.indexOf(name),
  };
  const motionManager = {
    expressionManager,
    state: { get currentPriority() { return s.currentPriority; }, get reservePriority() { return s.reservePriority; } },
    get currentAudio() { return s.audioPlaying === null ? undefined : { isPlaying: s.audioPlaying }; },
  };
  const expression = vi.fn(async (name: string) => {
    if (VOCAB.expressions.indexOf(name) === expressions.indexOf(expressionManager.currentExpression!)) return false;
    s.currentExpression = name;
    return true;
  });
  const motion = vi.fn(async (_g: string, _i: undefined, priority: number) => {
    if (priority !== 3 && (priority <= s.currentPriority || priority <= s.reservePriority)) return false;
    if (priority !== 3 && s.audioPlaying === true) return false;
    s.currentPriority = priority;
    return true;
  });
  const model = { expression, motion, internalModel: { motionManager } } as unknown as Live2DModel;
  return { model, expression, motion, state: s };
}

function command(overrides: Partial<AvatarCommand>): AvatarCommand {
  return { characterId: "taki", commandId: "cmd", kind: "expression", name: "default", ...overrides };
}
const expr = (name: string) => command({ kind: "expression", name });
const motion = (name: string, priority?: AvatarCommand["priority"]) => command({ kind: "motion", name, priority });

describe("applyAvatarCommand", () => {
  it("expression then motion: both applied (Lab row 1)", async () => {
    const { model, expression, motion: motionFn } = fakeModel();
    await expect(applyAvatarCommand({ model, command: expr("smile"), vocabulary: VOCAB })).resolves.toEqual({ outcome: "applied" });
    await expect(applyAvatarCommand({ model, command: motion("angry01"), vocabulary: VOCAB })).resolves.toEqual({ outcome: "applied" });
    expect(expression).toHaveBeenCalledWith("smile");
    expect(motionFn).toHaveBeenCalledWith("angry01", undefined, 2, { loop: false });
  });

  it("maps priority + loop knobs onto the engine call", async () => {
    const { model, motion: motionFn } = fakeModel({ currentPriority: 2 });
    await expect(
      applyAvatarCommand({ model, command: command({ kind: "motion", name: "angry01", priority: "force", loop: true }), vocabulary: VOCAB }),
    ).resolves.toEqual({ outcome: "applied" });
    expect(motionFn).toHaveBeenCalledWith("angry01", undefined, 3, { loop: true });
  });

  it("same expression twice: the second is rejected as already_active (Lab row 5)", async () => {
    const { model } = fakeModel();
    await expect(applyAvatarCommand({ model, command: expr("smile"), vocabulary: VOCAB })).resolves.toEqual({ outcome: "applied" });
    await expect(applyAvatarCommand({ model, command: expr("smile"), vocabulary: VOCAB })).resolves.toEqual({ outcome: "rejected", reason: "already_active" });
  });

  it("NORMAL motion over a playing NORMAL motion: rejected motion_busy (Lab row 6)", async () => {
    const { model } = fakeModel({ currentPriority: 2 });
    await expect(applyAvatarCommand({ model, command: motion("smile01"), vocabulary: VOCAB })).resolves.toEqual({ outcome: "rejected", reason: "motion_busy" });
  });

  it("a NORMAL motion while another is still reserved (loading) is motion_busy too", async () => {
    const { model } = fakeModel({ reservePriority: 2 });
    await expect(applyAvatarCommand({ model, command: motion("smile01"), vocabulary: VOCAB })).resolves.toEqual({ outcome: "rejected", reason: "motion_busy" });
  });

  it("a non-FORCE motion while motion audio plays: rejected speaking", async () => {
    const { model } = fakeModel({ audioPlaying: true });
    await expect(applyAvatarCommand({ model, command: motion("smile01"), vocabulary: VOCAB })).resolves.toEqual({ outcome: "rejected", reason: "speaking" });
    await expect(applyAvatarCommand({ model, command: motion("angry01", "force"), vocabulary: VOCAB })).resolves.toEqual({ outcome: "applied" });
  });

  it("two expressions without awaiting: the earlier pending one is superseded, the later applied (Lab row 7)", async () => {
    const { model, expression } = fakeModel();
    // Reproduce the engine's reservation replacement: the first call resolves false only after the second reserved.
    let releaseFirst: (value: boolean) => void = () => undefined;
    expression.mockImplementationOnce(() => new Promise<boolean>((resolve) => { releaseFirst = resolve; }));
    expression.mockImplementationOnce(async () => true);
    const first = applyAvatarCommand({ model, command: expr("smile"), vocabulary: VOCAB });
    const second = applyAvatarCommand({ model, command: expr("shame01"), vocabulary: VOCAB });
    await expect(second).resolves.toEqual({ outcome: "applied" });
    releaseFirst(false);
    await expect(first).resolves.toEqual({ outcome: "superseded" });
  });

  it("a motion refused after a newer motion command started (and not busy/speaking) is superseded", async () => {
    const { model, motion: motionFn } = fakeModel();
    let releaseFirst: (value: boolean) => void = () => undefined;
    motionFn.mockImplementationOnce(() => new Promise<boolean>((resolve) => { releaseFirst = resolve; }));
    motionFn.mockImplementationOnce(async () => true);
    const first = applyAvatarCommand({ model, command: motion("angry01"), vocabulary: VOCAB });
    const second = applyAvatarCommand({ model, command: motion("smile01"), vocabulary: VOCAB });
    await expect(second).resolves.toEqual({ outcome: "applied" });
    releaseFirst(false);
    await expect(first).resolves.toEqual({ outcome: "superseded" });
  });

  it("an unexplained false is rejected as unavailable", async () => {
    const { model, expression, motion: motionFn } = fakeModel();
    expression.mockImplementationOnce(async () => false);
    motionFn.mockImplementationOnce(async () => false);
    await expect(applyAvatarCommand({ model, command: expr("smile"), vocabulary: VOCAB })).resolves.toEqual({ outcome: "rejected", reason: "unavailable" });
    await expect(applyAvatarCommand({ model, command: motion("smile01"), vocabulary: VOCAB })).resolves.toEqual({ outcome: "rejected", reason: "unavailable" });
  });

  it("an engine throw is rejected as unavailable, never propagated", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { model, motion: motionFn } = fakeModel();
    motionFn.mockImplementationOnce(() => { throw new Error("renderer boom"); });
    await expect(applyAvatarCommand({ model, command: motion("smile01"), vocabulary: VOCAB })).resolves.toEqual({ outcome: "rejected", reason: "unavailable" });
    warn.mockRestore();
  });

  it("an unknown name is rejected unknown_name without touching the model and fires the drift sink once (1b)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { model, expression, motion: motionFn } = fakeModel();
    const onVocabularyDrift = vi.fn();
    await expect(applyAvatarCommand({ model, command: expr("nope"), vocabulary: VOCAB, onVocabularyDrift })).resolves.toEqual({ outcome: "rejected", reason: "unknown_name" });
    await expect(applyAvatarCommand({ model, command: motion("ghost99"), vocabulary: VOCAB })).resolves.toEqual({ outcome: "rejected", reason: "unknown_name" });
    expect(expression).not.toHaveBeenCalled();
    expect(motionFn).not.toHaveBeenCalled();
    expect(onVocabularyDrift).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("does NOT fire onVocabularyDrift when the name is known", async () => {
    const { model } = fakeModel();
    const onVocabularyDrift = vi.fn();
    await applyAvatarCommand({ model, command: expr("shame01"), vocabulary: VOCAB, onVocabularyDrift });
    await applyAvatarCommand({ model, command: motion("angry01"), vocabulary: VOCAB, onVocabularyDrift });
    expect(onVocabularyDrift).not.toHaveBeenCalled();
  });
});
