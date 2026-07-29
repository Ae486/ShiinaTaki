import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createCompanionFixture, type CompanionFixture } from "../testing/companion-fixture.ts";
import { failingGenerateModel, generatingModel } from "../testing/mock-language-model.ts";
import type { MemoryWriteOp } from "./episodic-writer.ts";
import { createImageDescriptionWriter, type ImageDescriptionAttachments } from "./image-description-writer.ts";

const fixtures: CompanionFixture[] = [];
function fresh(): CompanionFixture {
  const f = createCompanionFixture();
  fixtures.push(f);
  return f;
}
afterEach(() => {
  for (const f of fixtures.splice(0)) f.cleanup();
});

// The SAME bound write op auto-memory uses — the writer adds no new memory machinery (D28).
function episodeOp(f: CompanionFixture): MemoryWriteOp {
  return ({ layer, ...rest }) => f.memory.writeEntry({ ...rest, type: layer });
}

type WriteCall = Parameters<MemoryWriteOp>[0];
function recordingOp(): { calls: WriteCall[]; op: MemoryWriteOp } {
  const calls: WriteCall[] = [];
  return {
    calls,
    op: (input) => {
      calls.push(input);
      return { id: `id-${calls.length}` };
    },
  };
}

const okAttachments: ImageDescriptionAttachments = {
  read: () => ({ ok: true, mediaType: "image/png", dataBase64: Buffer.from("fake-image").toString("base64") }),
};
const goneAttachments: ImageDescriptionAttachments = { read: () => ({ ok: false }) };

function episodeFiles(root: string): string[] {
  try {
    return readdirSync(join(root, "memory"), { recursive: true }).filter(
      (p): p is string => typeof p === "string" && p.includes("episodes") && p.endsWith(".md"),
    );
  } catch {
    return [];
  }
}

describe("createImageDescriptionWriter (T9b)", () => {
  it("writes ONE episodic memory (with an [image] prefix) via the store path", async () => {
    const f = fresh();
    const logger = { warn: vi.fn() };
    const writer = createImageDescriptionWriter({
      model: generatingModel("A red maple leaf resting on a wooden desk."),
      attachments: okAttachments,
      writeEpisode: episodeOp(f),
      logger,
    });

    await writer.onImageTurn({ characterId: "taki", refs: [`attachments/${"a".repeat(64)}.png`], caption: "look at this" });

    const files = episodeFiles(f.root);
    expect(files).toHaveLength(1);
    const body = readFileSync(join(f.root, "memory", files[0] as string), "utf8");
    expect(body).toContain("[image] A red maple leaf resting on a wooden desk.");
    expect(body).toContain("importance: 4");
    // Origin marks the content as SENSED, which is what lets the render sites fence it (Q8; D47 closes in T5).
    expect(body).toContain('origin: "observed"');
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("writes into the episodes layer with origin 'observed' (Q8)", async () => {
    const rec = recordingOp();
    const writer = createImageDescriptionWriter({
      model: generatingModel("A cat asleep on a keyboard."),
      attachments: okAttachments,
      writeEpisode: rec.op,
      logger: { warn: vi.fn() },
    });

    await writer.onImageTurn({ characterId: "taki", refs: [`attachments/${"c".repeat(64)}.png`], caption: "" });

    expect(rec.calls).toHaveLength(1);
    expect(rec.calls[0]?.layer).toBe("episodes");
    expect(rec.calls[0]?.origin).toBe("observed");
  });

  it("PII-scrubs the description before it is stored (D44 memory half; the fence stays out of storage — D47)", async () => {
    const f = fresh();
    const writer = createImageDescriptionWriter({
      model: generatingModel("A terminal showing OPENAI_API_KEY=sk-abcdefghijklmnop1234 and a mail to alice@example.com"),
      attachments: okAttachments,
      writeEpisode: episodeOp(f),
      logger: { warn: vi.fn() },
    });

    await writer.onImageTurn({ characterId: "taki", refs: [`attachments/${"b".repeat(64)}.png`], caption: "" });

    const body = readFileSync(join(f.root, "memory", episodeFiles(f.root)[0] as string), "utf8");
    // A memory is PERMANENT: a credential the user happened to photograph must never become part of it.
    expect(body).not.toContain("sk-abcdefghijklmnop1234");
    expect(body).not.toContain("alice@example.com");
    expect(body).toContain("[redacted:email]");
    // Storage-time text carries no fence: the fence is a prompt-assembly wrapper, not a storage format (D47).
    expect(body).not.toContain("<untrusted-observation");
  });

  it("drops (warn, no throw, no write) when the vision model fails", async () => {
    const f = fresh();
    const logger = { warn: vi.fn() };
    const writer = createImageDescriptionWriter({
      model: failingGenerateModel(new Error("vlm down")),
      attachments: okAttachments,
      writeEpisode: episodeOp(f),
      logger,
    });

    await expect(
      writer.onImageTurn({ characterId: "taki", refs: [`attachments/${"a".repeat(64)}.png`], caption: "x" }),
    ).resolves.toBeUndefined();

    expect(episodeFiles(f.root)).toEqual([]);
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it("returns early (no model call, no write) when every retained image is unreadable", async () => {
    const f = fresh();
    const logger = { warn: vi.fn() };
    const model = generatingModel("unused");
    const writer = createImageDescriptionWriter({ model, attachments: goneAttachments, writeEpisode: episodeOp(f), logger });

    await writer.onImageTurn({ characterId: "taki", refs: [`attachments/${"b".repeat(64)}.png`], caption: "x" });

    expect(model.doGenerateCalls).toHaveLength(0);
    expect(episodeFiles(f.root)).toEqual([]);
    expect(logger.warn).not.toHaveBeenCalled();
  });
});
