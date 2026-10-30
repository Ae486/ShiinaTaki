/**
 * INPUT: exact Character/private-work execution registrations and targeted cancellation
 * OUTPUT: non-replacing scope controllers, exact Run lookup and complete shutdown drain
 * POS: core/agents — process-local cancellation handles; durable Run/control state remains Core-owned
 */

export interface TurnRegistry {
  /** Registers a fresh controller as the character's active turn; the caller must end() it in a finally. */
  begin(characterId: string, controller?: AbortController, runId?: string): AbortController;
  beginScoped(input: { characterId: string; scopeKey: string; runId: string; controller: AbortController }): AbortController;
  /** Unregisters — only if this controller is still the active one (a later begin wins). */
  end(characterId: string, controller: AbortController): void;
  /** Aborts the active turn; false when the character has none (a queued-but-unstarted turn is not cancellable). */
  cancel(characterId: string, runId?: string): boolean;
  cancelExact(input: { characterId: string; runId: string; scopeKey?: string; reason?: string }): boolean;
  /** Waits for active turns to finish, aborting remaining turns at the bounded deadline. */
  drain(timeoutMs?: number): Promise<void>;
}

export function createTurnRegistry(): TurnRegistry {
  const active = new Map<string, { characterId: string; controller: AbortController; runId?: string }>();
  const runs = new Map<string, string>();
  const waiters = new Set<() => void>();
  const resolveWaiters = (): void => {
    if (active.size !== 0) return;
    for (const resolve of [...waiters]) resolve();
    waiters.clear();
  };

  const begin = (input: { characterId: string; scopeKey: string; runId?: string; controller: AbortController }) => {
    const current = active.get(input.scopeKey);
    if (current && (current.controller !== input.controller || current.runId !== input.runId)) throw new Error("TURN_SCOPE_OCCUPIED");
    if (input.runId && runs.has(input.runId) && runs.get(input.runId) !== input.scopeKey) throw new Error("TURN_RUN_OCCUPIED");
    active.set(input.scopeKey, input);
    if (input.runId) runs.set(input.runId, input.scopeKey);
    return input.controller;
  };
  const cancel = (key: string, reason: string): boolean => {
    const current = active.get(key);
    if (!current || current.controller.signal.aborted) return false;
    current.controller.abort(reason); return true;
  };
  return {
    begin(characterId, prepared, runId) {
      const controller = prepared ?? new AbortController();
      return begin({ characterId, scopeKey: characterId, controller, runId });
    },
    beginScoped: begin,
    end(characterId, controller) {
      if (active.get(characterId)?.controller === controller) {
        const runId = active.get(characterId)?.runId;
        if (runId) runs.delete(runId);
        active.delete(characterId);
        resolveWaiters();
      }
    },
    cancel(characterId, runId) {
      const current = active.get(characterId);
      if (!current || (runId !== undefined && current.runId !== runId)) return false;
      return cancel(characterId, "turn cancelled by operator");
    },
    cancelExact(input) {
      const key = runs.get(input.runId);
      if (!key || active.get(key)?.characterId !== input.characterId || (input.scopeKey !== undefined && input.scopeKey !== key)) return false;
      return cancel(key, input.reason ?? "turn cancelled by operator");
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
