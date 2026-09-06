import { afterEach, describe, expect, it, vi } from "vitest";
import { createHindsightClient } from "./hindsight-client.ts";

const context = { timeoutMs: 1_000 };
const page = { provider_lineage: "11111111-1111-4111-8111-111111111111",
  bank_generation: "22222222-2222-4222-8222-222222222222", from_cursor: 8, next_cursor: 8,
  current_cursor: 8, minimum_available_cursor: 0, has_more: false, changes: [] };
const limit = 512 * 1024;
afterEach(() => vi.unstubAllGlobals());

function client() {
  return createHindsightClient({ endpoint: "http://127.0.0.1:8888", resolveApiKey: () => "fixture-key" });
}

describe("Hindsight default HTTP response budget", () => {
  it("classifies an HTTP refusal without reading private response contents", async () => {
    const cancel = vi.fn(); const pull = vi.fn();
    const body = new ReadableStream<Uint8Array>({ pull, cancel }, { highWaterMark: 0 });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(body, { status: 401 })));
    await expect(client().changesAfter?.({ bankId: "global", afterCursor: 8, limit: 500, context }))
      .rejects.toMatchObject({ code: "HINDSIGHT_AUTHENTICATION_FAILED" });
    expect(pull).not.toHaveBeenCalled(); expect(cancel).toHaveBeenCalledOnce();
  });

  it("stops and cancels a response stream as soon as its byte budget is exceeded", async () => {
    const cancel = vi.fn();
    let pulls = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        if (pulls <= 4) controller.enqueue(new Uint8Array(limit / 2).fill(32));
        else controller.close();
      },
      cancel,
    }, { highWaterMark: 0 });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(body)));
    await expect(client().changesAfter?.({ bankId: "global", afterCursor: 8, limit: 500, context }))
      .rejects.toMatchObject({ code: "HINDSIGHT_RESPONSE_INVALID" });
    expect(cancel).toHaveBeenCalledOnce();
    expect(pulls).toBe(3);
  });

  it("accepts exactly 512 KiB including multibyte JSON text split across stream chunks", async () => {
    const change = { cursor: 9, provider_lineage: page.provider_lineage, bank_generation: page.bank_generation,
      batch_id: "33333333-3333-4333-8333-333333333333", batch_index: 0, batch_size: 1,
      object_kind: "directive", object_id: "d", object_revision: 2, operation: "upsert",
      payload: { bank_id: "global", directive_id: "d", name: "fixture", content: "\u5496\u5561", priority: 1,
        is_active: true, tags: [], created_at: "2026-09-05T00:00:00.000Z", updated_at: "2026-09-05T00:00:00.000Z" },
      recorded_at: "2026-09-05T00:00:00.000Z" };
    const encoder = new TextEncoder(); const json = JSON.stringify({ ...page, next_cursor: 9, current_cursor: 9, changes: [change] });
    const bytes = encoder.encode(json + " ".repeat(limit - encoder.encode(json).byteLength));
    const split = bytes.indexOf(0xe5) + 1;
    const body = new ReadableStream<Uint8Array>({ start(controller) {
      controller.enqueue(bytes.slice(0, split)); controller.enqueue(bytes.slice(split)); controller.close();
    } });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(body)));
    await expect(client().changesAfter?.({ bankId: "global", afterCursor: 8, limit: 500, context }))
      .resolves.toMatchObject({ changes: [{ payload: { value: { content: "\u5496\u5561" } } }] });
  });
});
