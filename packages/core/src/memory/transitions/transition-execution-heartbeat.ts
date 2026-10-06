/**
 * INPUT: one transition executor's abort lifetime, guarded renewal and current-state assertion
 * OUTPUT: serial 30-second renewal, transaction-external event-loop joins and terminal cleanup
 * POS: core/memory/transitions — shared lifetime mechanism; the caller alone supplies any Native renewal
 */
import { setImmediate as yieldEventLoop } from "node:timers/promises";

export function createTransitionExecutionHeartbeat(input: {
  signal: AbortSignal; abort(): void; renew(): Promise<void> | void; assertCurrent(): void; failure(error: unknown): void;
}) {
  let pending: Promise<void> = Promise.resolve(); let failure: unknown; let failed = false;
  const check = () => { if (failed) throw failure; };
  const timer = setInterval(() => {
    pending = pending.then(async () => {
      if (input.signal.aborted) return;
      await input.renew();
    }).catch((error: unknown) => {
      input.failure(error); failure = error; failed = true; input.abort();
    });
  }, 30_000);
  const stopTimer = () => clearInterval(timer);
  input.signal.addEventListener("abort", stopTimer, { once: true });
  return { check,
    boundary: async (terminal = false) => {
      // A microtask cannot deliver a due timer/socket. Never call this while SQLite owns a transaction.
      await yieldEventLoop();
      if (terminal) clearInterval(timer);
      let joined: Promise<void>;
      do { joined = pending; await joined; } while (joined !== pending);
      check(); input.assertCurrent();
    },
    stop: async () => { clearInterval(timer); input.signal.removeEventListener("abort", stopTimer); input.abort(); await pending; },
  };
}
