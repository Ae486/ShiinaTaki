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

    // Assert on the NAMES header line, not the tool name — the usage-discipline prose (1c) always mentions both tools.
    const rendered = vocab.render("taki");
    expect(rendered).toContain("Avatar expressions you can set");
    expect(rendered).not.toContain("Avatar motions you can play");
  });

  it("get() returns the raw names and undefined for an unknown character (the per-turn dynamic-enum source, 1e)", () => {
    const vocab = createAvatarVocabulary();
    vocab.set("taki", { motions: ["smile01"], expressions: ["default"] });

    expect(vocab.get("taki")).toEqual({ motions: ["smile01"], expressions: ["default"] });
    expect(vocab.get("nobody")).toBeUndefined();
  });
});

describe("createAvatarVocabulary costume-change detection (1f)", () => {
  it("never fires on the first turn — a boot promotion (report undefined → real id) is only the baseline", () => {
    const vocab = createAvatarVocabulary();
    vocab.set("taki", { motions: [], expressions: [] }); // boot report: no formal id
    vocab.set("taki", { motions: ["m"], expressions: [] }, "arbeit"); // promotion: real id
    // The first turn only snapshots whatever is worn now, so a dev→imported boot is not mistaken for a change.
    expect(vocab.consumeCostumeChanged("taki")).toBe(false);
    expect(vocab.consumeCostumeChanged("taki")).toBe(false); // still arbeit → unchanged
  });

  it("fires exactly once after a real costume switch, then consumes it", () => {
    const vocab = createAvatarVocabulary();
    vocab.set("taki", { motions: [], expressions: [] }, "arbeit");
    expect(vocab.consumeCostumeChanged("taki")).toBe(false); // baseline turn
    vocab.set("taki", { motions: [], expressions: [] }, "casual"); // operator switches
    expect(vocab.consumeCostumeChanged("taki")).toBe(true); // notice injected once
    expect(vocab.consumeCostumeChanged("taki")).toBe(false); // ...and consumed (no re-fire next turn)
  });

  it("does NOT fire on churn back to the same costume with no turns between (A→B→C→A)", () => {
    const vocab = createAvatarVocabulary();
    vocab.set("taki", { motions: [], expressions: [] }, "A");
    expect(vocab.consumeCostumeChanged("taki")).toBe(false); // baseline = A
    vocab.set("taki", { motions: [], expressions: [] }, "B");
    vocab.set("taki", { motions: [], expressions: [] }, "C");
    vocab.set("taki", { motions: [], expressions: [] }, "A"); // wandered back before sending a message
    expect(vocab.consumeCostumeChanged("taki")).toBe(false); // current A === baseline A → no notice
  });

  it("does not fire for the pure-dev case (undefined throughout) or an unknown character", () => {
    const vocab = createAvatarVocabulary();
    vocab.set("taki", { motions: [], expressions: [] }); // dev model: no formal id ever
    expect(vocab.consumeCostumeChanged("taki")).toBe(false); // baseline undefined
    expect(vocab.consumeCostumeChanged("taki")).toBe(false); // undefined === undefined
    expect(vocab.consumeCostumeChanged("nobody")).toBe(false); // nothing known
  });

  it("a costume-less re-report (drift self-heal) keeps the worn id — no false change", () => {
    const vocab = createAvatarVocabulary();
    vocab.set("taki", { motions: ["m1"], expressions: [] }, "casual");
    expect(vocab.consumeCostumeChanged("taki")).toBe(false); // baseline = casual
    // Drift self-heal re-reports the SAME model's vocab with no formal id — it must not clobber "casual" to undefined.
    vocab.set("taki", { motions: ["m1", "m2"], expressions: [] });
    expect(vocab.get("taki")).toEqual({ motions: ["m1", "m2"], expressions: [] }); // vocab still updated
    expect(vocab.consumeCostumeChanged("taki")).toBe(false); // costume still casual → no notice
  });
});
