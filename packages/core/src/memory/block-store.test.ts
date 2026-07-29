import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { rmTempDir } from "../testing/rm-temp.ts";
import { createBlockStore, type BlockStore } from "./block-store.ts";

const roots: string[] = [];
function freshStore(): { store: BlockStore; root: string } {
  const root = mkdtempSync(join(tmpdir(), "taki-blocks-"));
  roots.push(root);
  return { store: createBlockStore({ root }), root };
}
afterEach(() => {
  for (const root of roots.splice(0)) rmTempDir(root);
});

describe("block store — read", () => {
  it("returns undefined for a block whose file does not exist (the feature is simply off)", () => {
    const { store } = freshStore();
    expect(store.readBlock({ id: "user-card" })).toBeUndefined();
    expect(store.readBlock({ id: "memory-index", characterId: "taki" })).toBeUndefined();
  });

  it("returns undefined for an empty/whitespace-only file rather than an empty section", () => {
    const { store } = freshStore();
    store.writeBlock({ id: "user-card", content: "   \n\n", caller: "user" });
    expect(store.readBlock({ id: "user-card" })).toBeUndefined();
  });

  it("strips the leading `>` editor note and keeps the body", () => {
    const { store } = freshStore();
    store.writeBlock({
      id: "user-card",
      content: "> Edit this file by hand; it wins over anything she infers.\n\nName: pleia\nTimezone: UTC+8",
      caller: "user",
    });
    const read = store.readBlock({ id: "user-card" });
    expect(read).toBe("Name: pleia\nTimezone: UTC+8");
    expect(read).not.toContain("Edit this file by hand");
  });

  it("sees a hand-edit made between two reads (no boot cache)", () => {
    const { store, root } = freshStore();
    store.writeBlock({ id: "user-card", content: "Name: pleia", caller: "user" });
    expect(store.readBlock({ id: "user-card" })).toBe("Name: pleia");

    // The user edits the card in a text editor mid-session: the very next turn must see it, with no restart.
    writeFileSync(join(root, "global", "user-card.md"), "Name: pleia\nCalls me: 立希");
    expect(store.readBlock({ id: "user-card" })).toBe("Name: pleia\nCalls me: 立希");
  });

  it("throws on an unknown block id (a wiring bug, never a runtime condition)", () => {
    const { store } = freshStore();
    expect(() => store.readBlock({ id: "not-a-block" })).toThrow(/unknown memory block/);
  });
});

describe("block store — writer policy (the agent-side path can never write a user block)", () => {
  it("refuses a background write to the user-owned card and allows the user's own", () => {
    const { store } = freshStore();
    const refused = store.writeBlock({ id: "user-card", content: "Name: guessed", caller: "background" });
    expect(refused.ok).toBe(false);
    expect(store.readBlock({ id: "user-card" })).toBeUndefined();

    expect(store.writeBlock({ id: "user-card", content: "Name: pleia", caller: "user" }).ok).toBe(true);
    expect(store.readBlock({ id: "user-card" })).toBe("Name: pleia");
  });

  it("refuses the mirror case on the background-owned blocks", () => {
    const { store } = freshStore();
    expect(store.writeBlock({ id: "user-model", content: "x", caller: "user" }).ok).toBe(false);
    expect(store.writeBlock({ id: "memory-index", characterId: "taki", content: "x", caller: "user" }).ok).toBe(false);

    expect(store.writeBlock({ id: "user-model", content: "Works late", caller: "background" }).ok).toBe(true);
    expect(store.writeBlock({ id: "memory-index", characterId: "taki", content: "拉面", caller: "background" }).ok).toBe(true);
  });

  it("refuses an unknown block id instead of throwing (the write path is tool-facing)", () => {
    const { store } = freshStore();
    const result = store.writeBlock({ id: "not-a-block", content: "x", caller: "background" });
    expect(result).toEqual({ ok: false, reason: expect.stringContaining("unknown memory block") });
  });
});

describe("block store — placement + atomic write", () => {
  it("places global and per-character blocks in their own subtrees", () => {
    const { store, root } = freshStore();
    store.writeBlock({ id: "user-card", content: "Name: pleia", caller: "user" });
    store.writeBlock({ id: "memory-index", characterId: "taki", content: "拉面 / 电影", caller: "background" });

    expect(readFileSync(join(root, "global", "user-card.md"), "utf8")).toBe("Name: pleia");
    expect(readFileSync(join(root, "characters", "taki", "memory-index.md"), "utf8")).toBe("拉面 / 电影");
    // Per-character blocks are scoped: another character's index is a different file.
    expect(store.readBlock({ id: "memory-index", characterId: "other" })).toBeUndefined();
  });

  it("refuses a per-character block without a characterId, and a global block with one", () => {
    const { store } = freshStore();
    expect(store.writeBlock({ id: "memory-index", content: "x", caller: "background" }).ok).toBe(false);
    expect(store.writeBlock({ id: "user-card", characterId: "taki", content: "x", caller: "user" }).ok).toBe(false);
    expect(() => store.readBlock({ id: "memory-index" })).toThrow(/per-character/);
    expect(() => store.readBlock({ id: "user-card", characterId: "taki" })).toThrow(/global/);
  });

  it("leaves no temp file behind (write is temp+rename, so a reader never sees a half-written block)", () => {
    const { store, root } = freshStore();
    store.writeBlock({ id: "user-card", content: "Name: pleia", caller: "user" });
    store.writeBlock({ id: "user-card", content: "Name: pleia\nCalls me: 立希", caller: "user" });

    expect(readdirSync(join(root, "global"))).toEqual(["user-card.md"]);
    expect(store.readBlock({ id: "user-card" })).toBe("Name: pleia\nCalls me: 立希");
  });

  it("refuses a characterId that is not a safe path segment", () => {
    const { store } = freshStore();
    const result = store.writeBlock({ id: "memory-index", characterId: "../evil", content: "x", caller: "background" });
    expect(result.ok).toBe(false);
  });

  it("reads an unsafe characterId as 'no block' rather than throwing (it is protocol data, not wiring)", () => {
    const { store } = freshStore();
    // `chat.send` only constrains characterId to a non-empty string, so this value reaches the assemble hot path.
    expect(store.readBlock({ id: "memory-index", characterId: "../evil" })).toBeUndefined();
    expect(store.readBlock({ id: "memory-index", characterId: "a/b" })).toBeUndefined();
  });
});
