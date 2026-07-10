/**
 * INPUT:  a readable input stream (stdin) + a writable output stream; authenticate + per-line deps
 * OUTPUT: runRepl(io, deps) -> resolves when input closes; buffers lines from readline creation
 * POS:    cli — the REPL loop, split from main for testability; owns readline + line buffering (no OS access)
 */
import { createInterface } from "node:readline";

export interface ReplIo {
  input: NodeJS.ReadableStream;
  output: NodeJS.WritableStream;
}

export interface ReplDeps {
  /** Pre-REPL handshake; `ask` writes a prompt and reads the next line (e.g. a pairing code). */
  authenticate: (ask: (query: string) => Promise<string>) => Promise<void>;
  /** Handles one chat line; runRepl re-prompts after it resolves. */
  onLine: (line: string) => Promise<void>;
  /** Receives the shared line-reader once, so mid-turn prompts (e.g. tool approval) read the same stdin queue. */
  bindAsk?: (ask: (query: string) => Promise<string>) => void;
}

// A pull-based line queue. readline pushes into it from the moment the interface is created, so lines
// (and the EOF 'close') that arrive before a consumer pulls are buffered rather than lost — the fix for
// the piped-stdin hang where a lazily-attached `for await` missed the 'close' that had already fired.
class LineQueue {
  private readonly buffer: string[] = [];
  private closed = false;
  private pending: ((line: string | null) => void) | null = null;

  push(line: string): void {
    const resolve = this.pending;
    if (resolve) {
      this.pending = null;
      resolve(line);
    } else {
      this.buffer.push(line);
    }
  }

  close(): void {
    this.closed = true;
    const resolve = this.pending;
    if (resolve) {
      this.pending = null;
      resolve(null);
    }
  }

  /** Next buffered line, else the next live line; null once closed and drained. */
  next(): Promise<string | null> {
    const line = this.buffer.shift();
    if (line !== undefined) return Promise.resolve(line);
    if (this.closed) return Promise.resolve(null);
    return new Promise((resolve) => {
      this.pending = resolve;
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

  const ask = async (query: string): Promise<string> => {
    io.output.write(query);
    return (await queue.next()) ?? "";
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
