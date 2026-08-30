/**
 * INPUT:  a desktop operator ConnectionStatus and the shared semantic notice mapping.
 * OUTPUT: Home/Chat banner as a NON-SHIFTING overlay strip (absolute top, z-notice, shadowed — U6) plus the compact
 *         pointer-transparent Pet notice; connected renders nothing, so the overlay can never park over content.
 * POS:    ui/components — presentation-only connection state surfaces; no transport/client ownership. The banner
 *         anchors to the nearest positioned ancestor (home-shell's <main>).
 */

import { connectionStatusNotice, type ConnectionStatus } from "@/lib/connection-status.js";

const BANNER_TONE = {
  attention: "bg-warn-soft text-warn-strong",
  error: "bg-danger-soft text-danger-strong",
} as const;

const PET_TONE = {
  attention: "bg-warn-strong/80 text-white",
  error: "bg-danger-deep/80 text-danger-soft",
} as const;

export function ConnectionStatusBanner({ status }: { status: ConnectionStatus }) {
  const notice = connectionStatusNotice(status);
  if (!notice) return null;
  return (
    <div
      role="status"
      className={`${BANNER_TONE[notice.tone]} absolute inset-x-0 top-0 z-(--z-notice) px-4 py-1.5 text-center text-xs shadow-overlay`}
    >
      {notice.text}
    </div>
  );
}

export function PetConnectionStatusNotice({ status }: { status: ConnectionStatus }) {
  const notice = connectionStatusNotice(status);
  if (!notice) return null;
  return (
    <div
      role="status"
      className={`${PET_TONE[notice.tone]} pointer-events-none max-w-[90%] rounded px-2 py-1 text-xs shadow-card`}
    >
      {notice.text}
    </div>
  );
}
