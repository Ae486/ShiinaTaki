import { describe, expect, it } from "vitest";
import { createAvatarVocabulary } from "./avatar-vocabulary.ts";

describe("createAvatarVocabulary", () => {
  it("renders the reported expression and motion names plus the tool names to call", () => {
    const vocab = createAvatarVocabulary();
    vocab.set("taki", { motions: ["smile01", "angry01"], expressions: ["default", "shame01"] });

    const rendered = vocab.render("taki");
    expect(rendered).toContain("default");
    expect(rendered).toContain("shame01");
    expect(rendered).toContain("smile01");
    expect(rendered).toContain("angry01");
    expect(rendered).toContain("avatar_set_expression");
    expect(rendered).toContain("avatar_play_motion");
  });

  it("returns an empty string for an unknown character (no empty section)", () => {
    expect(createAvatarVocabulary().render("nobody")).toBe("");
  });

  it("keys the vocabulary on characterId (invariant 7 — not a hardcoded single character)", () => {
    const vocab = createAvatarVocabulary();
    vocab.set("taki", { motions: ["smile01"], expressions: [] });
    vocab.set("other", { motions: ["mtn_smile01_C"], expressions: [] });

    expect(vocab.render("taki")).toContain("smile01");
    expect(vocab.render("taki")).not.toContain("mtn_smile01_C");
    expect(vocab.render("other")).toContain("mtn_smile01_C");
  });

  it("a re-report fully replaces the prior vocabulary (costume / soul swap)", () => {
    const vocab = createAvatarVocabulary();
    vocab.set("taki", { motions: ["old01"], expressions: ["oldexp"] });
    vocab.set("taki", { motions: ["new01"], expressions: ["newexp"] });

    const rendered = vocab.render("taki");
    expect(rendered).toContain("new01");
    expect(rendered).toContain("newexp");
    expect(rendered).not.toContain("old01");
  });

  it("omits the empty side (expressions only, no motions line)", () => {
    const vocab = createAvatarVocabulary();
    vocab.set("taki", { motions: [], expressions: ["default"] });

    const rendered = vocab.render("taki");
    expect(rendered).toContain("avatar_set_expression");
    expect(rendered).not.toContain("avatar_play_motion");
  });
});
