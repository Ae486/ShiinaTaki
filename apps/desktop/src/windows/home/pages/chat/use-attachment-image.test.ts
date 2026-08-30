/**
 * INPUT:  loadImage() calls against a stub media client; module cache reset between tests.
 * OUTPUT: assertions for the P1b image-cache contract: one fetch per ref (concurrent mounts share the promise),
 *         a resolved entry past IMAGE_CACHE_LIMIT evicts in least-recently-fetched order while in-flight fetches
 *         stay single-flight, re-getting a ref refreshes its recency, and failures self-evict so a retry refetches.
 * POS:    unit test for use-attachment-image's module cache (the hook's React wiring is DOM-bound). Exempt from caps.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WsClient } from "@/lib/ws-client.js";
import { IMAGE_CACHE_LIMIT, loadImage, resetAttachmentCacheForTests } from "./use-attachment-image.ts";

function ref(n: number): string {
  return `workspace/img-${n}.png`;
}

interface Deferred {
  promise: Promise<{ mediaType: string; dataBase64: string }>;
  resolve(value: { mediaType: string; dataBase64: string }): void;
  reject(cause: unknown): void;
}

function deferred(): Deferred {
  let resolve!: Deferred["resolve"];
  let reject!: Deferred["reject"];
  const promise = new Promise<{ mediaType: string; dataBase64: string }>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

/** A stub client whose mediaGet hands out the deferreds in call order (the list itself is NOT consumed). */
function stubClient(deferrals: Deferred[]): WsClient {
  let index = 0;
  return { mediaGet: vi.fn(() => deferrals[index++]!.promise) } as unknown as WsClient;
}

beforeEach(resetAttachmentCacheForTests);

describe("attachment image module cache (P1b)", () => {
  it("fetches a ref once and shares the promise across concurrent/repeat loads", async () => {
    const call = deferred();
    const client = stubClient([call]);
    const first = loadImage(client, ref(1));
    const second = loadImage(client, ref(1));
    call.resolve({ mediaType: "image/png", dataBase64: "AAAA" });
    expect(await first).toBe("data:image/png;base64,AAAA");
    expect(await second).toBe("data:image/png;base64,AAAA");
    expect(client.mediaGet).toHaveBeenCalledTimes(1);
  });

  it("evicts the least-recently-fetched RESOLVED entry once the cache exceeds its bound", async () => {
    const calls = Array.from({ length: IMAGE_CACHE_LIMIT + 1 }, () => deferred());
    const client = stubClient(calls);
    for (let n = 1; n <= IMAGE_CACHE_LIMIT + 1; n += 1) void loadImage(client, ref(n));
    for (const call of calls) call.resolve({ mediaType: "image/png", dataBase64: "AAAA" });
    await Promise.allSettled(calls.map((call) => call.promise));

    // ref(1) is the oldest resolved entry — refetching it must hit the client again; a survivor must not.
    const retry = deferred();
    const client2 = stubClient([retry]);
    void loadImage(client2, ref(1));
    loadImage(client2, ref(2));
    expect(client2.mediaGet).toHaveBeenCalledTimes(1);
    expect(client2.mediaGet).toHaveBeenCalledWith(ref(1));
  });

  it("never evicts an in-flight fetch, even when it is the oldest entry", async () => {
    const calls = Array.from({ length: IMAGE_CACHE_LIMIT + 1 }, () => deferred());
    const client = stubClient(calls);
    for (let n = 1; n <= IMAGE_CACHE_LIMIT + 1; n += 1) void loadImage(client, ref(n));
    calls[0]!.resolve({ mediaType: "image/png", dataBase64: "AAAA" }); // oldest resolves; the rest stay pending
    await calls[0]!.promise;

    const retry = deferred();
    const client2 = stubClient([retry]);
    void loadImage(client2, ref(1)); // evicted (oldest resolved)
    loadImage(client2, ref(2)); // oldest remaining is still in flight — must stay cached, no second fetch
    expect(client2.mediaGet).toHaveBeenCalledTimes(1);
    expect(client2.mediaGet).toHaveBeenCalledWith(ref(1));
  });

  it("refreshes recency on a re-get: the touched ref survives the next overflow", async () => {
    const calls = Array.from({ length: IMAGE_CACHE_LIMIT }, () => deferred());
    const client = stubClient(calls);
    for (let n = 1; n <= IMAGE_CACHE_LIMIT; n += 1) void loadImage(client, ref(n));
    for (const call of calls) call.resolve({ mediaType: "image/png", dataBase64: "AAAA" });
    await Promise.all(calls.map((call) => call.promise));

    loadImage(client, ref(1)); // touch the oldest — moves it to the recency end
    const spill = deferred();
    const client2 = stubClient([spill]);
    void loadImage(client2, ref(IMAGE_CACHE_LIMIT + 1)); // pushes the cache one over
    spill.resolve({ mediaType: "image/png", dataBase64: "BBBB" });
    await spill.promise;

    const check = deferred();
    const client3 = stubClient([check]);
    void loadImage(client3, ref(1)); // touched ref survived; ref(2) (now LRU) was evicted instead
    loadImage(client3, ref(2));
    expect(client3.mediaGet).toHaveBeenCalledTimes(1);
    expect(client3.mediaGet).toHaveBeenCalledWith(ref(2));
  });

  it("self-evicts a failed fetch so a later mount retries the fetch", async () => {
    const failure = deferred();
    const client = stubClient([failure]);
    const first = loadImage(client, ref(1));
    failure.reject(new Error("media gone"));
    await expect(first).rejects.toThrow("media gone");

    const retry = deferred();
    const client2 = stubClient([retry]);
    void loadImage(client2, ref(1));
    expect(client2.mediaGet).toHaveBeenCalledTimes(1); // the failure did not poison the cache
    retry.resolve({ mediaType: "image/png", dataBase64: "CCCC" });
  });
});
