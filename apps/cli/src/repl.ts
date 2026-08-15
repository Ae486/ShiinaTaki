/**
 * INPUT:  a readable input stream (stdin) + a writable output stream; authenticate + per-line deps
 * OUTPUT: runRepl(io, deps) -> resolves when input closes; buffers lines from readline creation; askOnce(io, query)
 * POS:    cli — the REPL loop, split from main for testability; owns readline + line buffering (no OS access)
 */
import { createInterface } from "node:readline";

export interface ReplIo {
  input: NodeJS.ReadableStream;
  output: NodeJS.WritableStream;
}

export interface ReplDeps {
  /** Pre-REPL handshake; `ask` writes a prompt and reads the next line (e.g. a pairing code). */
  authenticate: (ask: (query: string, signal?: AbortSignal) => Promise<string | null>) => Promise<void>;
  /** Handles one chat line; runRepl re-prompts after it resolves. */
  onLine: (line: string) => Promise<void>;
  /** Receives the shared line-reader once, so mid-turn prompts (e.g. tool approval) read the same stdin queue. */
  bindAsk?: (ask: (query: string, signal?: AbortSignal) => Promise<string | null>) => void;
}

// A pull-based line queue. readline pushes into it from the moment the interface is created, so lines
// (and the EOF 'close') that arrive before a consumer pulls are buffered rather than lost — the fix for
// the piped-stdin hang where a lazily-attached `for await` missed the 'close' that had already fired.
class LineQueue {
  private readonly buffer: string[] = [];
  private closed = false;
  private pending: {
    resolve: (line: string | null) => void;
    signal?: AbortSignal;
    onAbort?: () => void;
  } | null = null;

  push(line: string): void {
    const pending = this.pending;
    if (pending) {
      this.pending = null;
      if (pending.onAbort) pending.signal?.removeEventListener("abort", pending.onAbort);
      pending.resolve(line);
    } else {
      this.buffer.push(line);
    }
  }

  close(): void {
    this.closed = true;
    const pending = this.pending;
    if (pending) {
      this.pending = null;
      if (pending.onAbort) pending.signal?.removeEventListener("abort", pending.onAbort);
      pending.resolve(null);
    }
  }

  /** Next buffered line, else the next live line; null once closed and drained. */
  next(signal?: AbortSignal): Promise<string | null> {
    const line = this.buffer.shift();
    if (line !== undefined) return Promise.resolve(line);
    if (this.closed) return Promise.resolve(null);
    if (signal?.aborted) return Promise.resolve(null);
    return new Promise((resolve) => {
      const pending: {
        resolve: (line: string | null) => void;
        signal?: AbortSignal;
        onAbort?: () => void;
      } = { resolve, signal };
      pending.onAbort = () => {
        if (this.pending !== pending) return;
        this.pending = null;
        resolve(null);
      };
      signal?.addEventListener("abort", pending.onAbort, { once: true });
      this.pending = pending;
    });
  }
}

export async function runRepl(io: ReplIo, deps: ReplDeps): Promise<void> {
  const queue = new LineQueue();
  const rl = createInterface({ input: io.input, output: io.output });
  // Attach before the first await so instant piped input can't slip past an unattached consumer.
  rl.on("line", (line) => queue.push(line));
  rl.on("close", () => queue.close());
  rl.on("SIGINT", () => rl.close());

  const ask = async (query: string, signal?: AbortSignal): Promise<string | null> => {
    io.output.write(query);
    return queue.next(signal);
  };
  deps.bindAsk?.(ask);

  try {
    await deps.authenticate(ask);
    io.output.write("> ");
    for (;;) {
      const line = await queue.next();
      if (line === null) break;
      await deps.onLine(line);
      io.output.write("> ");
    }
  } finally {
    rl.close();
  }
}

/** One prompt without the loop, for non-REPL entries (`--call` still needs the pairing code on first run). */
export function askOnce(io: ReplIo, query: string, signal?: AbortSignal): Promise<string | null> {
  const rl = createInterface({ input: io.input, output: io.output });
  return new Promise((resolve) => {
    let settled = false;
    const finish = (answer: string | null): void => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", abort);
      rl.close();
      resolve(answer);
    };
    const abort = (): void => finish(null);
    signal?.addEventListener("abort", abort, { once: true });
    // EOF before an answer (closed or piped stdin) resolves empty instead of hanging the one-shot path.
    rl.on("close", () => finish(null));
    rl.question(query, (answer) => {
      finish(answer);
    });
  });
}
