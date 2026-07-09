import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { runRepl, type ReplIo } from "./repl.ts";

const macrotask = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function makeIo(): { io: ReplIo; input: PassThrough } {
  const input = new PassThrough();
  const output = new PassThrough();
  output.resume(); // drain writes so buffered prompts never stall the queue
  return { io: { input, output }, input };
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("runRepl", () => {
  it("(a) processes a line buffered before authenticate resolves, then completes", async () => {
    const { io, input } = makeIo();
    input.write("hello\n");
    input.end(); // line + EOF land while authenticate is still pending
    const processed: string[] = [];
    let authRan = false;

    await runRepl(io, {
      authenticate: async () => {
        await macrotask();
        authRan = true;
      },
      onLine: async (line) => {
        processed.push(line);
      },
    });

    expect(authRan).toBe(true);
    expect(processed).toEqual(["hello"]);
  });

  it("(b) completes cleanly on EOF with no lines", async () => {
    const { io, input } = makeIo();
    input.end();
    const processed: string[] = [];

    await runRepl(io, {
      authenticate: async () => {
        await macrotask();
      },
      onLine: async (line) => {
        processed.push(line);
      },
    });

    expect(processed).toEqual([]);
  });

  it("(c) feeds a queued line to the pairing question, not the chat handler", async () => {
    const { io, input } = makeIo();
    input.write("123456\n");
    input.write("hello\n");
    input.end();
    const asked: string[] = [];
    const processed: string[] = [];

    await runRepl(io, {
      authenticate: async (ask) => {
        asked.push(await ask("code: "));
      },
      onLine: async (line) => {
        processed.push(line);
      },
    });

    expect(asked).toEqual(["123456"]);
    expect(processed).toEqual(["hello"]);
  });

  it("(d) processes live lines in order after authenticate resolves", async () => {
    const { io, input } = makeIo();
    const processed: string[] = [];
    const gate = deferred();

    const run = runRepl(io, {
      authenticate: () => gate.promise,
      onLine: async (line) => {
        processed.push(line);
      },
    });

    gate.resolve();
    await macrotask();
    input.write("one\n");
    await macrotask();
    input.write("two\n");
    await macrotask();
    input.end();
    await run;

    expect(processed).toEqual(["one", "two"]);
  });
});
