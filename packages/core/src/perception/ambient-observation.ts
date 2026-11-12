/**
 * INPUT: screened native frame, original observation validity and ambient-only retention store
 * OUTPUT: latest pending native evidence, protected from GC until consumption or retirement
 * POS: core/perception — no image translation/model call; capture permission remains upstream
 */
import type { ImageAttachment, SourceContext } from "@taki/shared";
import type { AmbientShotStore } from "./ambient-shot-store.ts";
import type { ScreenContext } from "./screen-context.ts";

export interface AmbientObservationDeps {
  store: AmbientShotStore;
  context: ScreenContext;
  dropRawAfterConsumption: boolean;
}

export async function observeAmbientFrame(
  deps: AmbientObservationDeps,
  frame: ImageAttachment,
  observation: { observedAt: number; isCurrent(): boolean; sourceContext?: SourceContext; release?(): void },
): Promise<void> {
  let saved: ReturnType<AmbientShotStore["save"]> = null;
  let unprotect: (() => void) | undefined;
  let published = false;
  try {
    if (!observation.isCurrent()) return;
    saved = deps.store.save(frame.dataBase64, observation.observedAt);
    unprotect = saved ? deps.store.protect?.(saved.name) : undefined;
    if (!observation.isCurrent()) return;
    deps.context.push(frame, observation.observedAt, { isCurrent: observation.isCurrent, sourceContext: observation.sourceContext,
      discard(withdrawn) {
        unprotect?.();
        if (saved && (withdrawn || deps.dropRawAfterConsumption)) deps.store.discard(saved.name);
        observation.release?.();
      } });
    published = true;
  } finally {
    if (!published) { unprotect?.(); if (saved) deps.store.discard(saved.name); observation.release?.(); }
  }
}
