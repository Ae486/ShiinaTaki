/**
 * INPUT:  an image part's workspace-relative ref (from a zod-parsed timeline part).
 * OUTPUT: <ImageAttachment> — the thumbnail: a Skeleton pulse block while loading, an "图片已过期" placeholder
 *         (with the image-off glyph) when the bytes are gone (TTL sweep / FORBIDDEN), else the resolved data-URL image.
 * POS:    ui/windows/home/pages/chat — presentational image-part renderer; byte fetching lives in use-attachment-image.
 *         Text stays authoritative — an expired image degrades to a placeholder, never a crash.
 */

import { ImageOffIcon } from "@/lib/icons/image-off-icon.js";
import { Skeleton } from "@/components/ui/skeleton.js";
import { useAttachmentImage } from "./use-attachment-image.ts";

export function ImageAttachment({ imageRef }: { imageRef: string }) {
  const state = useAttachmentImage(imageRef);

  if (state.kind === "error") {
    return (
      <div className="my-1 flex items-center gap-1.5 rounded-lg bg-surface-sunken px-3 py-2 text-xs text-text-faint">
        <ImageOffIcon className="h-4 w-4 shrink-0" />
        图片已过期
      </div>
    );
  }
  if (state.kind === "loading") {
    return <Skeleton block className="my-1 h-40 w-40 rounded-lg" />;
  }
  return <img src={state.url} alt="" className="my-1 max-h-64 max-w-full rounded-lg object-contain" />;
}
