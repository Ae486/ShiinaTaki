/**
 * INPUT:  begin/end from the chat.send pump (one active turn per characterId) + cancel from chat.cancel
 * OUTPUT: createTurnRegistry() -> { begin, end, cancel, drain } over per-character AbortControllers
 * POS:    core/agents — the cancellation seam (D1 #4); the queue guarantees at most one active turn per character
 */

export interface TurnRegistry {
  /** Registers a fresh controller as the character's active turn; the caller must end() it in a finally. */
  begin(characterId: string, controller?: AbortController, runId?: string): AbortController;
  /** Unregisters — only if this controller is still the active one (a later begin wins). */
  end(characterId: string, controller: AbortController): void;
  /** Aborts the active turn; false when the character has none (a queued-but-unstarted turn is not cancellable). */
  cancel(characterId: string, runId?: string): boolean;
  /** Waits for active turns to finish, aborting remaining turns at the bounded deadline. */
  drain(timeoutMs?: number): Promise<void>;
}

export function createTurnRegistry(): TurnRegistry {
  const active = new Map<string, { controller: AbortController; runId?: string }>();
  const waiters = new Set<() => void>();
  const resolveWaiters = (): void => {
    if (active.size !== 0) return;
    for (const resolve of [...waiters]) resolve();
    waiters.clear();
  };

  return {
    begin(characterId, prepared, runId) {
      const controller = prepared ?? new AbortController();
      active.set(characterId, { controller, runId });
      return controller;
    },
    end(characterId, controller) {
      if (active.get(characterId)?.controller === controller) {
        active.delete(characterId);
        resolveWaiters();
      }
    },
    cancel(characterId, runId) {
      const current = active.get(characterId);
      if (!current || (runId !== undefined && current.runId !== runId) || current.controller.signal.aborted) return false;
      current.controller.abort("turn cancelled by operator");
      return true;
    },
    drain(timeoutMs = 5_000) {
      if (active.size === 0) return Promise.resolve();
      for (const entry of active.values()) if (!entry.controller.signal.aborted) entry.controller.abort("core shutdown");
      return new Promise<void>((resolve) => {
        let settled = false;
        const finish = (): void => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          waiters.delete(finish);
          resolve();
        };
        const timer = setTimeout(finish, Math.max(0, timeoutMs));
        waiters.add(finish);
        resolveWaiters();
      });
    },
  };
}
