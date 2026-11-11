/**
 * INPUT:  begin/end from the chat.send pump (one active turn per characterId) + cancel from chat.cancel
 * OUTPUT: turn cancellation/drain and read-only live activity/idle notification for background admission
 * POS:    core/agents — the cancellation seam (D1 #4); the queue guarantees at most one active turn per character
 */

export interface TurnRegistry {
  idleSince(characterId: string | null): number | null;
  observe(listener: () => void): () => void;
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
  const listeners = new Set<() => void>();
  const ended = new Map<string, number>();
  const createdAt = Date.now(); let lastEndedAt = createdAt;
  const resolveWaiters = (): void => {
    if (active.size !== 0) return;
    for (const resolve of [...waiters]) resolve();
    waiters.clear();
  };

  return {
    idleSince: (characterId) => characterId === null ? active.size ? null : lastEndedAt
      : active.has(characterId) ? null : ended.get(characterId) ?? createdAt,
    observe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    begin(characterId, prepared, runId) {
      const controller = prepared ?? new AbortController();
      active.set(characterId, { controller, runId });
      return controller;
    },
    end(characterId, controller) {
      if (active.get(characterId)?.controller === controller) {
        active.delete(characterId);
        lastEndedAt = Date.now(); ended.set(characterId, lastEndedAt);
        resolveWaiters();
        for (const listener of listeners) listener();
      }
    },
    cancel(characterId, runId) {
      const current = active.get(characterId);
      if (!current || (runId !== undefined && current.runId !== runId) || current.controller.signal.aborted) return false;
      current.controller.abort("turn cancelled by operator");
      return true;
    },
    drain: (timeoutMs = 5_000) => drainTurns(active, waiters, timeoutMs),
  };
}

function drainTurns(active: ReadonlyMap<string, { controller: AbortController }>, waiters: Set<() => void>, timeoutMs: number): Promise<void> {
  if (active.size === 0) return Promise.resolve();
  for (const entry of active.values()) if (!entry.controller.signal.aborted) entry.controller.abort("core shutdown");
  if (active.size === 0) return Promise.resolve();
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
  });
}
