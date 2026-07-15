/**
 * INPUT:  an image part's workspace-relative ref (from a zod-parsed timeline part).
 * OUTPUT: <ImageAttachment> — the thumbnail: a shimmer while loading, a "图片已过期" placeholder when the bytes are
 *         gone (TTL sweep / FORBIDDEN), else the resolved data-URL image.
 * POS:    ui/windows/chat — presentational image-part renderer; byte fetching lives in use-attachment-image.
 *         Text stays authoritative — an expired image degrades to a placeholder, never a crash.
 */

import { useAttachmentImage } from "./use-attachment-image.ts";

export function ImageAttachment({ imageRef }: { imageRef: string }) {
  const state = useAttachmentImage(imageRef);

  if (state.kind === "error") {
    return <div className="my-1 rounded-lg bg-slate-100 px-3 py-2 text-xs text-slate-400">图片已过期</div>;
  }
  if (state.kind === "loading") {
    return <div className="my-1 h-40 w-40 animate-pulse rounded-lg bg-slate-200" />;
  }
  return <img src={state.url} alt="" className="my-1 max-h-64 max-w-full rounded-lg object-contain" />;
}
