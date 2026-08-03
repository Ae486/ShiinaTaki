/**
 * INPUT:  an image part's workspace-relative ref (zod-parsed timeline part) + the chat WsClient (context).
 * OUTPUT: useAttachmentImage(ref) -> loading | error | { url } — lazy media.get, cached ref→dataURL across rows.
 * POS:    ui/windows/home/pages/chat — the media.get touchpoint (hook-guidelines: components never call ws-client). ONE image
 *         path for live + scroll-back (prd §4.3); the data URL's mediaType comes from the zod-parsed closed enum.
 */

import { useEffect, useState } from "react";
import type { WsClient } from "@/lib/ws-client.js";
import { useChatClient } from "./chat-client-context.ts";

// Module-level ref→dataURL promise cache: one fetch per ref across every row (and across scroll-back re-mounts).
// The promise (not the value) is cached so concurrent mounts of the same ref share a single media.get.
const cache = new Map<string, Promise<string>>();

function loadImage(client: WsClient, ref: string): Promise<string> {
  const cached = cache.get(ref);
  if (cached) return cached;
  const pending = client.mediaGet(ref).then((result) => `data:${result.mediaType};base64,${result.dataBase64}`);
  cache.set(ref, pending);
  void pending.catch(() => cache.delete(ref)); // a failed fetch must not poison the cache — allow a later retry
  return pending;
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
