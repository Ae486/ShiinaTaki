/**
 * INPUT:  an AttachmentStore, the configured retention TTL, a Logger
 * OUTPUT: startAttachmentGc(deps) -> void; one boot sweep plus a 6h unref'd interval
 * POS:    core/media — the retention arm of the content-addressed store (#17): only raw BYTES expire, the description
 *         memory is permanent. Deliberately not the croner scheduler (D5 is M5); unref() keeps the timer from holding
 *         the process open on shutdown.
 */
import type { Logger } from "../logging/logger.ts";
import type { AttachmentStore } from "./attachment-store.ts";

const SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000;

export function startAttachmentGc(deps: { store: AttachmentStore; ttlMs: number; logger: Logger }): void {
  const log = deps.logger.child({ mod: "attachments" });
  const sweep = (): void => {
    const swept = deps.store.sweepExpired(deps.ttlMs);
    if (swept.removedCount > 0) log.info(swept, "expired attachments swept");
  };
  sweep();
  setInterval(sweep, SWEEP_INTERVAL_MS).unref();
}
