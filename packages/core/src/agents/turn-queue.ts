/**
 * INPUT:  acquire(key) calls — one per chat turn, keyed by characterId
 * OUTPUT: createTurnQueue() -> { acquire } a keyed async mutex; resolves a release fn when the key is free
 * POS:    core/agents — per-characterId turn serialization (D1 #3); a turn holds the lock across its whole commit
 */

export interface TurnQueue {
  /**
   * Resolves once every earlier holder of `key` has released — the caller then owns the turn and MUST call the
   * returned release fn (in a finally) exactly once. Different keys never block each other.
   */
  acquire(key: string): Promise<() => void>;
}

export function createTurnQueue(): TurnQueue {
  // Per key, the tail of a chain of "held until released" promises; acquiring appends a new link.
  const tails = new Map<string, Promise<void>>();

  return {
    acquire(key: string): Promise<() => void> {
      const prior = tails.get(key) ?? Promise.resolve();
      let release!: () => void;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      // The next holder waits on `held`; a prior throw can't happen (held only ever resolves), so no wedging.
      const tail = prior.then(() => held);
      tails.set(key, tail);
      // Once released, if we are still the live tail, drop the entry so the map does not grow unbounded.
      void tail.then(() => {
        if (tails.get(key) === tail) tails.delete(key);
      });
      return prior.then(() => release);
    },
  };
}
