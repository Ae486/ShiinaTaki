/**
 * INPUT:  the existing shared Utility Slot and per-Character ingestion actions
 * OUTPUT: owner cancellation, serial ingestion chains and a drain that waits for every underlying operation
 * POS:    core/memory/hindsight — lifecycle only; never stops the shared slot or races model/retain work into detachment
 */
import { captureUtilitySlot, type UtilitySlot } from "../utility-slot.ts";

export interface HindsightIngestionLifetime {
  readonly signal: AbortSignal;
  readonly slot: UtilitySlot;
  enqueue<T>(characterId: string, action: () => Promise<T>): Promise<T>;
  stop(): Promise<void>;
  settle(): Promise<void>;
}

export function createHindsightIngestionLifetime(slot: UtilitySlot): HindsightIngestionLifetime {
  const controller = new AbortController();
  const chains = new Map<string, Promise<unknown>>();
  const alive = () => assertHindsightIngestionAlive(controller.signal);
  const enqueue = <T>(characterId: string, action: () => Promise<T>): Promise<T> => {
    if (controller.signal.aborted) return Promise.reject(new Error("MEMORY_OPERATION_CANCELLED"));
    const next = (chains.get(characterId) ?? Promise.resolve()).catch(() => undefined).then(async () => {
      alive(); const result = await action(); alive(); return result;
    });
    chains.set(characterId, next);
    const release = () => { if (chains.get(characterId) === next) chains.delete(characterId); };
    void next.then(release, release); return next;
  };
  const guarded = (slot: UtilitySlot): UtilitySlot => ({ get model() { return slot.model; }, usage: () => slot.usage(),
    available: () => slot.available?.() !== false, capture: () => guarded(captureUtilitySlot(slot)),
    run: (label, task) => {
      alive();
      return slot.run(label, async () => {
        // The existing gate API has no AbortSignal parameter. Check again inside its queued slot turn and await
        // the actual model promise; stopping must not leave an unobserved late task behind SQLite shutdown.
        alive(); const result = await task(); alive(); return result;
      });
    } });
  const settle = async () => { while (chains.size) await Promise.allSettled([...chains.values()]); };
  return { signal: controller.signal, slot: guarded(slot), enqueue, settle,
    stop: () => { controller.abort(); return settle(); } };
}

export function assertHindsightIngestionAlive(signal: AbortSignal): void {
  if (signal.aborted) throw new Error("MEMORY_OPERATION_CANCELLED");
}
