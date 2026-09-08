/**
 * INPUT:  an optional projection observer and closed extension change targets
 * OUTPUT: failure-isolated invalidation without identifiers, source content or follow-up work
 * POS:    core/extensions — producer callback boundary; lifecycle owners retain all state and authority
 */
import type { ExtensionChangeTarget } from "@taki/shared";

export type { ExtensionChangeTarget } from "@taki/shared";
export type ExtensionChangeObserver = (targets: readonly ExtensionChangeTarget[]) => void;

export function notifyExtensionChange(
  observer: ExtensionChangeObserver | undefined,
  targets: readonly ExtensionChangeTarget[],
): void {
  try { observer?.(targets); }
  catch { /* A disposable projection observer cannot undo or interrupt lifecycle truth. */ }
}
