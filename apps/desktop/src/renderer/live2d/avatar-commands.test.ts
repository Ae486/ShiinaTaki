/**
 * INPUT:  avatar commands (known/unknown names, motion knobs) + a stub model capturing expression()/motion() calls.
 * OUTPUT: assertions that a known name plays and an unknown name no-ops WITHOUT throwing (Option A layer 3 degrade).
 * POS:    unit test for the avatar command applier (F3). The engine is mocked so its runtime enum loads in node
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

const VOCAB: AvatarVocabulary = { motions: ["angry01", "smile01"], expressions: ["default", "shame01"] };

function stubModel() {
  const expression = vi.fn();
  const motion = vi.fn();
  return { model: { expression, motion } as unknown as Live2DModel, expression, motion };
}

function command(overrides: Partial<AvatarCommand>): AvatarCommand {
  return { characterId: "taki", kind: "expression", name: "default", ...overrides };
}

describe("applyAvatarCommand", () => {
  it("plays a known expression and returns true", () => {
    const { model, expression, motion } = stubModel();
    expect(applyAvatarCommand(model, command({ kind: "expression", name: "shame01" }), VOCAB)).toBe(true);
    expect(expression).toHaveBeenCalledWith("shame01");
    expect(motion).not.toHaveBeenCalled();
  });

  it("plays a known motion with the mapped priority and loop knob", () => {
    const { model, motion } = stubModel();
    expect(applyAvatarCommand(model, command({ kind: "motion", name: "angry01", priority: "force", loop: true }), VOCAB)).toBe(true);
    expect(motion).toHaveBeenCalledWith("angry01", undefined, 3, { loop: true });
  });

  it("defaults an unspecified motion to normal priority, no loop", () => {
    const { model, motion } = stubModel();
    applyAvatarCommand(model, command({ kind: "motion", name: "smile01" }), VOCAB);
    expect(motion).toHaveBeenCalledWith("smile01", undefined, 2, { loop: false });
  });

  it("no-ops an unknown expression without throwing or touching the model (graceful degrade)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { model, expression, motion } = stubModel();
    expect(() => applyAvatarCommand(model, command({ kind: "expression", name: "nope" }), VOCAB)).not.toThrow();
    expect(applyAvatarCommand(model, command({ kind: "expression", name: "nope" }), VOCAB)).toBe(false);
    expect(expression).not.toHaveBeenCalled();
    expect(motion).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("no-ops an unknown motion name", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { model, motion } = stubModel();
    expect(applyAvatarCommand(model, command({ kind: "motion", name: "ghost99" }), VOCAB)).toBe(false);
    expect(motion).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
