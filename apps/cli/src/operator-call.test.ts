import { PassThrough } from "node:stream";
import { JSONRPCErrorException } from "json-rpc-2.0";
import { describe, expect, it } from "vitest";
import { JSON_RPC_APP_ERROR, MEMORY_METHODS } from "@taki/shared";
import {
  buildOperatorCall,
  parseOperatorCall,
  runOperatorCall,
  type OperatorCaller,
} from "./operator-call.ts";

describe("parseOperatorCall", () => {
  it("leaves a plain chat line alone", () => {
    for (const line of ["hello", "", "   ", "/calls are fun", "tell me about /call"]) {
      expect(parseOperatorCall(line)).toEqual({ kind: "chat" });
    }
  });

  it("defaults the params to an empty object when only a method is given", () => {
    expect(parseOperatorCall(`  /call ${MEMORY_METHODS.tidy}  `)).toEqual({
      kind: "call",
      call: { method: "memory.tidy", params: {} },
    });
  });

  it("parses JSON params after the method", () => {
    expect(parseOperatorCall('/call memory.tidy {"characterId":"taki"}')).toEqual({
      kind: "call",
      call: { method: "memory.tidy", params: { characterId: "taki" } },
    });
  });

  it("reports bad JSON params as a usage error instead of throwing", () => {
    const parsed = parseOperatorCall("/call memory.tidy {characterId}");
    expect(parsed.kind).toBe("usage");
    expect(parsed.kind === "usage" && parsed.message).toContain("invalid JSON params");
  });

  it("reports a missing method name as a usage error", () => {
    const parsed = parseOperatorCall("/call   ");
    expect(parsed.kind).toBe("usage");
    expect(parsed.kind === "usage" && parsed.message).toContain("/call <method>");
  });
});

describe("buildOperatorCall (argv one-shot)", () => {
  it("treats an omitted --params as an empty object", () => {
    expect(buildOperatorCall("memory.tidy", "")).toEqual({
      kind: "call",
      call: { method: "memory.tidy", params: {} },
    });
  });

  it("shares the JSON usage error with the REPL parser", () => {
    expect(buildOperatorCall("memory.tidy", "{oops}").kind).toBe("usage");
  });
});

function stubCaller(reply: () => Promise<unknown>): { caller: OperatorCaller; calls: unknown[] } {
  const calls: unknown[] = [];
  return {
    caller: {
      call: (method, params) => {
        calls.push({ method, params });
        return reply();
      },
    },
    calls,
  };
}

async function run(caller: OperatorCaller, method: string, params: unknown): Promise<{ ok: boolean; text: string }> {
  const output = new PassThrough();
  let text = "";
  output.on("data", (chunk: Buffer) => {
    text += chunk.toString();
  });
  const ok = await runOperatorCall(caller, { method, params }, output);
  return { ok, text };
}

describe("runOperatorCall", () => {
  it("sends the call verbatim and pretty-prints the result", async () => {
    const { caller, calls } = stubCaller(() => Promise.resolve({ status: "clean", defects: { stale: 0 } }));

    const { ok, text } = await run(caller, "memory.tidy", { characterId: "taki" });

    expect(calls).toEqual([{ method: "memory.tidy", params: { characterId: "taki" } }]);
    expect(ok).toBe(true);
    expect(text).toBe(`{\n  "status": "clean",\n  "defects": {\n    "stale": 0\n  }\n}\n`);
  });

  it("prints the app error code of a JSON-RPC error without throwing", async () => {
    const { caller } = stubCaller(() =>
      Promise.reject(
        new JSONRPCErrorException("operator role required", JSON_RPC_APP_ERROR, { code: "PERMISSION_DENIED" }),
      ),
    );

    const { ok, text } = await run(caller, "memory.tidy", {});

    expect(ok).toBe(false);
    expect(text).toBe("[PERMISSION_DENIED] operator role required\n");
  });

  it("falls back to the numeric JSON-RPC code when the error carries no app code", async () => {
    const { caller } = stubCaller(() => Promise.reject(new JSONRPCErrorException("Method not found", -32601)));

    const { ok, text } = await run(caller, "nope.method", {});

    expect(ok).toBe(false);
    expect(text).toBe("[-32601] Method not found\n");
  });

  it("survives a transport failure that is not a JSON-RPC error", async () => {
    const { caller } = stubCaller(() => Promise.reject(new Error("connection closed")));

    const { ok, text } = await run(caller, "memory.tidy", {});

    expect(ok).toBe(false);
    expect(text).toBe("[request failed] connection closed\n");
  });
});
