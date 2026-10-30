/**
 * INPUT: playback choices captured for a user turn and freshly observed sources at tool execution
 * OUTPUT: one current same-media source or a bounded refusal with refreshed choices
 * POS: core/co-watching — pre-acceptance selection only; never rebinds an existing accepted task
 */
import type { BrowserPlaybackView } from "@taki/shared";

function sole(sources: BrowserPlaybackView[]): BrowserPlaybackView | undefined {
  const visible = sources.filter((source) => source.sample.visible || source.sample.pictureInPicture);
  return visible.length === 1 ? visible[0] : sources.length === 1 ? sources[0] : undefined;
}

function sameTarget(left: BrowserPlaybackView, right: BrowserPlaybackView): boolean {
  return left.hostId === right.hostId && left.source.tabId === right.source.tabId
    && left.source.frameId === right.source.frameId && left.source.documentId === right.source.documentId
    && JSON.stringify(left.source.media) === JSON.stringify(right.source.media);
}

export function selectInvitationSource(input: {
  captured: BrowserPlaybackView[]; current: BrowserPlaybackView[]; sourceRef?: string | null;
}): BrowserPlaybackView | undefined {
  const selected = input.sourceRef ? input.captured.find((source) => source.sourceRef === input.sourceRef)
    ?? input.current.find((source) => source.sourceRef === input.sourceRef) : sole(input.captured) ?? sole(input.current);
  if (!selected) return undefined;
  // A source lease can renew while the same page initializes. Before acceptance, use the current player only
  // when its actual Host/tab/document and exact media still match. A different video never inherits the request.
  const matches = input.current.filter((source) => sameTarget(source, selected));
  const original = input.sourceRef ? input.captured.find((source) => source.sourceRef === input.sourceRef)
    ?? (input.captured.length === 1 ? input.captured[0] : undefined) : sole(input.captured);
  if (original && !sameTarget(original, selected)) return undefined;
  return matches.length === 1 ? matches[0] : undefined;
}
