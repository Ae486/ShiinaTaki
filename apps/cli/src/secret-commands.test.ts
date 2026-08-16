import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { SECRET_METHODS } from "@taki/shared";
import { parseSecretCommand, readSecretValue, runSecretCommand, type SecretCommand } from "./secret-commands.ts";
import type { OperatorCaller } from "./operator-call.ts";

const REF = "mcp.github-mcp.env.GITHUB_TOKEN";
const SENTINEL = "sentinel-not-a-real-secret-value-0123456789";

function io(input: PassThrough = new PassThrough()): { io: { input: PassThrough; output: PassThrough }; output: PassThrough } {
  const output = new PassThrough();
  return { io: { input, output }, output };
}

function captureCaller(
  result: unknown = { secretRef: REF, present: true, provenance: { source: "catalog", keyVersion: 1, updatedAt: "2026-08-16T00:00:00.000Z" }, health: "ok" },
): { caller: OperatorCaller; calls: Array<{ method: string; params: unknown }> } {
  const calls: Array<{ method: string; params: unknown }> = [];
  return {
    calls,
    caller: {
      call: async (method, params) => {
        calls.push({ method, params });
        if (result instanceof Error) throw result;
        return result;
      },
    },
  };
}

describe("parseSecretCommand", () => {
  it("parses set/clear/presence/list with a valid ref", () => {
    expect(parseSecretCommand(["set", REF])).toEqual({ kind: "set", secretRef: REF } satisfies SecretCommand);
    expect(parseSecretCommand(["clear", REF])).toEqual({ kind: "clear", secretRef: REF } satisfies SecretCommand);
    expect(parseSecretCommand(["presence", REF])).toEqual({ kind: "presence", secretRef: REF } satisfies SecretCommand);
    expect(parseSecretCommand(["list"])).toEqual({ kind: "list" } satisfies SecretCommand);
  });

  it("usage-complains on empty, unknown verbs, bad refs, and extra list args", () => {
    expect(parseSecretCommand([]).kind).toBe("usage");
    expect(parseSecretCommand(["frobnicate", REF]).kind).toBe("usage");
    expect(parseSecretCommand(["set", "not a ref"]).kind).toBe("usage");
    expect(parseSecretCommand(["set"]).kind).toBe("usage");
    expect(parseSecretCommand(["list", REF]).kind).toBe("usage");
  });
});

describe("readSecretValue", () => {
  it("reads piped stdin and strips exactly one trailing newline", async () => {
    async function piped(payload: string): Promise<string | null> {
      const input = new PassThrough();
      input.end(payload);
      return readSecretValue(io(input).io);
    }
    expect(await piped(SENTINEL)).toBe(SENTINEL);
    expect(await piped(`${SENTINEL}\n`)).toBe(SENTINEL);
    expect(await piped(`${SENTINEL}\r\n`)).toBe(SENTINEL);
    expect(await piped("line1\nline2\n")).toBe("line1\nline2"); // interior newlines are part of the value
    expect(await piped("")).toBe("");
  });

  it("prompts one line when stdin is a TTY", async () => {
    const input = new PassThrough() as PassThrough & { isTTY?: boolean };
    input.isTTY = true;
    const { io: ttyIo, output } = io(input);
    const pending = readSecretValue(ttyIo);
    input.write(`${SENTINEL}\n`);
    input.end();
    expect(await pending).toBe(SENTINEL);
    expect(output.read()?.toString()).toContain("value:");
  });
});

describe("runSecretCommand", () => {
  it("set sends the stdin value (never argv) and prints the write-only result", async () => {
    const input = new PassThrough();
    const { io: commandIo, output } = io(input);
    const { caller, calls } = captureCaller();
    input.end(`${SENTINEL}\n`);
    const ok = await runSecretCommand({ caller, io: commandIo, positionals: ["set", REF] });
    expect(ok).toBe(true);
    expect(calls).toEqual([{ method: SECRET_METHODS.set, params: { secretRef: REF, value: SENTINEL } }]);
    const printed = output.read()?.toString() ?? "";
    expect(printed).toContain("\"present\": true");
    expect(printed).not.toContain(SENTINEL);
  });

  it("refuses to send an empty stdin value", async () => {
    const input = new PassThrough();
    input.end("\n");
    const { io: commandIo, output } = io(input);
    const { caller, calls } = captureCaller();
    const ok = await runSecretCommand({ caller, io: commandIo, positionals: ["set", REF] });
    expect(ok).toBe(false);
    expect(calls).toHaveLength(0);
    expect(output.read()?.toString()).toContain("no value provided");
  });

  it("clear/presence/list route to their methods", async () => {
    for (const [positionals, method] of [
      [["clear", REF], SECRET_METHODS.clear],
      [["presence", REF], SECRET_METHODS.presence],
      [["list"], SECRET_METHODS.list],
    ] as const) {
      const { io: commandIo } = io();
      const { caller, calls } = captureCaller();
      expect(await runSecretCommand({ caller, io: commandIo, positionals: [...positionals] })).toBe(true);
      expect(calls[0]?.method).toBe(method);
    }
  });

  it("prints a bounded app-error label and never the value on refusal", async () => {
    const input = new PassThrough();
    input.end(`${SENTINEL}\n`);
    const { io: commandIo, output } = io(input);
    const refusal = Object.assign(new Error("secret catalog refused the operation (store-locked)"), {
      data: { code: "SECRET_REFUSED", reason: "store-locked" },
    });
    const { caller } = captureCaller(refusal);
    const ok = await runSecretCommand({ caller, io: commandIo, positionals: ["set", REF] });
    expect(ok).toBe(false);
    const printed = output.read()?.toString() ?? "";
    expect(printed).toContain("[SECRET_REFUSED]");
    expect(printed).not.toContain(SENTINEL);
  });
});
