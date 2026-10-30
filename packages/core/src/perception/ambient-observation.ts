/**
 * INPUT:  screened frame, bounded observation lease, VLM bridge and ambient-only stores
 * OUTPUT: scrubbed screen context only while the original consent and Host remain current
 * POS:    core/perception — post-capture privacy and retention; never starts another capture
 */
import type { Logger } from "../logging/logger.ts";
import type { AmbientShotStore } from "./ambient-shot-store.ts";
import { scrubPii } from "./pii-scrub.ts";
import type { ScreenContext } from "./screen-context.ts";
import { AMBIENT_DESCRIBE_FOCUS, isSensitiveScreenVerdict } from "./sensitive-screen.ts";

export interface AmbientObservationDeps {
  describe: (input: { dataBase64: string; mediaType: string; prompt?: string }) => Promise<string | null>;
  store: AmbientShotStore;
  context: ScreenContext;
  logger: Logger;
  dropRawAfterDescribe: boolean;
  onRefused?: () => void;
}

export async function observeAmbientFrame(
  deps: AmbientObservationDeps,
  frame: { dataBase64: string; mediaType: string },
  observation: { observedAt: number; isCurrent: () => boolean },
): Promise<void> {
  if (!observation.isCurrent()) return;
  const saved = deps.store.save(frame.dataBase64, observation.observedAt);
  let sensitive = false;
  try {
    if (!observation.isCurrent()) return;
    const description = await deps.describe({ dataBase64: frame.dataBase64, mediaType: frame.mediaType, prompt: AMBIENT_DESCRIBE_FOCUS });
    if (!observation.isCurrent()) return;
    sensitive = description !== null && isSensitiveScreenVerdict(description);
    if (sensitive) {
      deps.onRefused?.();
      deps.logger.debug("ambient screen judged sensitive by the vision pass; frame and description discarded");
      return;
    }
    if (description !== null) deps.context.push(scrubPii(description), observation.observedAt);
  } finally {
    // Retirement overrides configured retention even on a throwing describer: a withdrawn observation is unusable.
    if (saved !== null && (sensitive || deps.dropRawAfterDescribe || !observation.isCurrent())) deps.store.discard(saved.name);
  }
}
