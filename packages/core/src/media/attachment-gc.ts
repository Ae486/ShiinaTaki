/**
 * INPUT:  an AttachmentStore, the configured retention TTL, a Logger
 * OUTPUT: startAttachmentGc(deps) -> void; one boot sweep plus a 6h unref'd interval (via the shared sweep runner)
 * POS:    core/media — the retention arm of the content-addressed store (#17): only raw BYTES expire, the description
 *         memory is permanent. The schedule/log shape lives in scheduler/sweep-runner.ts (extracted at T5-R8's third
 *         instance); this module owns only the policy — what expires and when.
 */
import { startSweeper } from "../scheduler/sweep-runner.ts";
import type { Logger } from "../logging/logger.ts";
import type { AttachmentStore } from "./attachment-store.ts";

export function startAttachmentGc(deps: { store: AttachmentStore; ttlMs: number; logger: Logger }): void {
  startSweeper({
    name: "attachments",
    message: "expired attachments swept",
    logger: deps.logger,
    sweep: () => {
      const swept = deps.store.sweepExpired(deps.ttlMs);
      return swept.removedCount > 0 ? { ...swept } : undefined;
    },
  });
}
