/**
 * INPUT:  emotion tags + candidate motion/expression name lists from the two taki costumes.
 * OUTPUT: assertions for the exact → prefix → boundary-regex precedence and synonym expansion.
 * POS:    unit test for the fuzzy tag→name resolver (F4). Exempt from size caps.
 */

import { describe, expect, it } from "vitest";
import { resolveByTag } from "./emotion-resolver.ts";

const ARBEIT_MOTIONS = ["angry01", "angry02", "smile01", "pui01", "shame01", "serious01", "sigh01", "thinking01", "idle01"];
const ARBEIT_EXPR = ["default", "angry01", "smile01", "shame01", "serious01", "pui01"];
const LIVE01_MOTIONS = ["mtn_angry01_C", "mtn_smile01_L", "mtn_thinking01_R"];
const LIVE01_EXPR = ["exp_smile05", "exp_shy03", "exp_serious01", "exp_amazed01"];

describe("resolveByTag", () => {
  it("prefers an exact match", () => {
    expect(resolveByTag("idle01", ARBEIT_MOTIONS)).toBe("idle01");
  });

  it("falls back to a prefix match for arbeit's numbered names", () => {
    expect(resolveByTag("angry", ARBEIT_MOTIONS)).toBe("angry01");
  });

  it("expands a synonym (shy → shame) to hit arbeit's vocabulary", () => {
    expect(resolveByTag("shy", ARBEIT_EXPR)).toBe("shame01");
  });

  it("boundary-matches a prefixed Cubism 3 expression name", () => {
    expect(resolveByTag("smile", LIVE01_EXPR)).toBe("exp_smile05");
  });

  it("resolves 'think' against a Cubism 3 motion via synonym + boundary regex", () => {
    expect(resolveByTag("think", LIVE01_MOTIONS)).toBe("mtn_thinking01_R");
  });

  it("returns null when nothing matches (graceful no-op upstream)", () => {
    expect(resolveByTag("zzz-nope", ARBEIT_MOTIONS)).toBeNull();
  });
});
