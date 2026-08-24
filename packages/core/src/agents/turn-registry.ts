/**
 * INPUT:  begin/end from the chat.send pump (one active turn per characterId) + cancel from chat.cancel
 * OUTPUT: createTurnRegistry() -> { begin, end, cancel } over per-character AbortControllers
 * POS:    core/agents — the cancellation seam (D1 #4); the queue guarantees at most one active turn per character
 */

export interface TurnRegistry {
  /** Registers a fresh controller as the character's active turn; the caller must end() it in a finally. */
  begin(characterId: string, controller?: AbortController, runId?: string): AbortController;
  /** Unregisters — only if this controller is still the active one (a later begin wins). */
  end(characterId: string, controller: AbortController): void;
  /** Aborts the active turn; false when the character has none (a queued-but-unstarted turn is not cancellable). */
  cancel(characterId: string, runId?: string): boolean;
}

export function createTurnRegistry(): TurnRegistry {
  const active = new Map<string, { controller: AbortController; runId?: string }>();

  return {
    begin(characterId, prepared, runId) {
      const controller = prepared ?? new AbortController();
      active.set(characterId, { controller, runId });
      return controller;
    },
    end(characterId, controller) {
      if (active.get(characterId)?.controller === controller) active.delete(characterId);
    },
    cancel(characterId, runId) {
      const current = active.get(characterId);
      if (!current || (runId !== undefined && current.runId !== runId) || current.controller.signal.aborted) return false;
      current.controller.abort("turn cancelled by operator");
      return true;
    },
  };
}
