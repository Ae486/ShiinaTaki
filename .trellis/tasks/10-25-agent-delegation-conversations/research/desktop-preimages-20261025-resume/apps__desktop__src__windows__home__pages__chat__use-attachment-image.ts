/**
 * INPUT:  an image part's workspace-relative ref (zod-parsed timeline part) + the chat WsClient (context).
 * OUTPUT: useAttachmentImage(ref) -> loading | error | { url } — lazy media.get, cached ref→dataURL across rows.
 * POS:    ui/windows/home/pages/chat — the media.get touchpoint (hook-guidelines: components never call ws-client). ONE image
 *         path for live + scroll-back (prd §4.3); the data URL's mediaType comes from the zod-parsed closed enum.
 *         P1b: the module cache is LRU-bounded at IMAGE_CACHE_LIMIT resolved entries (a data URL is image-sized
 *         memory; scroll-back must not pin every image ever seen) — in-flight fetches are never evicted (the
 *         single-fetch-per-ref contract) and failures self-evict so a later mount can retry.
 */

import { useEffect, useState } from "react";
import type { WsClient } from "@/lib/ws-client.js";
import { useChatClient } from "./chat-client-context.ts";

export const IMAGE_CACHE_LIMIT = 40;

// Module-level ref→dataURL promise cache: one fetch per ref across every row (and across scroll-back re-mounts).
// The promise (not the value) is cached so concurrent mounts of the same ref share a single media.get. Map order is
// recency order: touched/resolved entries re-insert at the end, so eviction scans the least-recently-used front.
const cache = new Map<string, Promise<string>>();
const resolvedRefs = new Set<string>(); // refs whose cached promise settled successfully (the evictable set)

function touch(ref: string): void {
  const pending = cache.get(ref);
  if (!pending || !resolvedRefs.has(ref)) return;
  cache.delete(ref);
  cache.set(ref, pending);
}

function evictOverflow(): void {
  for (const ref of cache.keys()) {
    if (cache.size <= IMAGE_CACHE_LIMIT) return;
    if (!resolvedRefs.has(ref)) continue; // never evict an in-flight fetch — it must stay single-flight
    cache.delete(ref);
    resolvedRefs.delete(ref);
  }
}

export function loadImage(client: WsClient, ref: string): Promise<string> {
  const cached = cache.get(ref);
  if (cached) {
    touch(ref);
    return cached;
  }
  const pending = client.mediaGet(ref).then(
    (result) => {
      resolvedRefs.add(ref);
      evictOverflow();
      return `data:${result.mediaType};base64,${result.dataBase64}`;
    },
    (cause: unknown) => {
      cache.delete(ref); // a failed fetch must not poison the cache — allow a later retry
      resolvedRefs.delete(ref);
      throw cause;
    },
  );
  cache.set(ref, pending);
  return pending;
}

/** Test seam: drop the whole module cache (module state must not leak between tests). */
export function resetAttachmentCacheForTests(): void {
  cache.clear();
  resolvedRefs.clear();
}

export type AttachmentImageState = { kind: "loading" } | { kind: "error" } | { kind: "ready"; url: string };

export function useAttachmentImage(imageRef: string): AttachmentImageState {
  const client = useChatClient();
  const [state, setState] = useState<AttachmentImageState>({ kind: "loading" });

  useEffect(() => {
    if (!client) return;
    let active = true;
    setState({ kind: "loading" });
    loadImage(client, imageRef)
      .then((url) => active && setState({ kind: "ready", url }))
      .catch(() => active && setState({ kind: "error" }));
    return () => {
      active = false;
    };
  }, [client, imageRef]);

  return state;
}
