import { describe, expect, it } from "vitest";
import { SubagentHandleEventToolSchema, SubagentInboxActionSchema, SubagentInboxResumeParamsSchema } from "./subagent-inbox-schema.ts";

const target = { subagentId: "11111111-1111-4111-8111-111111111111", workInputId: "22222222-2222-4222-8222-222222222222",
  expectedRunId: null, expectedControlVersion: 4 };

describe("model inbox handling contract", () => {
  it.each(["record", "ask_user", "reply", "answer_child", "continue_child"])("accepts the flat %s intent", (intent) => {
    const value = { eventId: "event", intent, text: "Meaningful answer", target: intent.endsWith("_child") ? target : null };
    expect(SubagentHandleEventToolSchema.parse(value)).toEqual(value);
  });

  it("rejects invalid target combinations, incomplete exact targets and obsolete model bookkeeping", () => {
    const base = { eventId: "event", intent: "record", text: "", target: null };
    for (const value of [{ ...base, target }, { ...base, intent: "answer_child" },
      { ...base, intent: "continue_child", target: { ...target, expectedRunId: undefined } },
      { ...base, operationKey: "model-generated" }, { eventId: "event", operationKey: "old", action: { kind: "retained", note: "" } }]) {
      expect(SubagentHandleEventToolSchema.safeParse(value).success).toBe(false);
    }
  });

  it("requires meaningful questions and answers without changing retained text bytes", () => {
    for (const intent of ["ask_user", "reply", "answer_child"]) {
      expect(SubagentHandleEventToolSchema.safeParse({ eventId: "event", intent, text: " \n\t ", target: intent === "answer_child" ? target : null }).success).toBe(false);
    }
    for (const intent of ["record", "continue_child"]) {
      expect(SubagentHandleEventToolSchema.safeParse({ eventId: "event", intent, text: "", target: intent === "record" ? null : target }).success).toBe(true);
    }
    expect(SubagentHandleEventToolSchema.parse({ eventId: "event", intent: "reply", text: "  Answer\n", target: null })).toHaveProperty("text", "  Answer\n");
  });

  it("retains historical no_action and operator operation keys", () => {
    expect(SubagentInboxActionSchema.parse({ kind: "no_action", note: "" })).toEqual({ kind: "no_action", note: "" });
    expect(SubagentInboxResumeParamsSchema.parse({ characterId: "taki", consumerId: "consumer", operationKey: "original" })).toHaveProperty("operationKey", "original");
  });
});
