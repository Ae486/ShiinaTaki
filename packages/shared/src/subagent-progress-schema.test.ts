import { expect, it } from "vitest";
import { SubagentInputWaitSchema } from "./subagent-inbox-schema.ts";
import { SubagentCheckInPolicySchema, SubagentCheckInSchema } from "./subagent-progress-schema.ts";
import { SubagentMessageToolSchema } from "./subagent-tool-schema.ts";

const id = "fb896308-5884-4d67-9148-62a6334fd101";
it("keeps legacy questions readable while requiring check-in sidecars only for check-ins", () => {
  const base = { eventId: "event", workInputId: id, state: "open", answerInputId: null };
  expect(SubagentInputWaitSchema.parse(base)).toMatchObject({ reason: "question", checkIn: null });
  expect(() => SubagentInputWaitSchema.parse({ ...base, reason: "check_in" })).toThrow();
  const checkIn = SubagentCheckInSchema.parse({ completedSteps: 50, intervalStartSteps: 0, intervalSteps: 50,
    parentApprovalLimit: 3, consecutiveParentApprovals: 3, requiredActor: "user", reportKind: "core_snapshot" });
  expect(SubagentInputWaitSchema.parse({ ...base, reason: "check_in", checkIn }).checkIn).toEqual(checkIn);
  expect(() => SubagentInputWaitSchema.parse({ ...base, reason: "question", checkIn })).toThrow();
});
it("accepts configurable positive step intervals and zero parent approvals without disable sentinels", () => {
  expect(SubagentCheckInPolicySchema.parse({ steps: 1, parentApprovals: 0 })).toEqual({ steps: 1, parentApprovals: 0 });
  for (const steps of [0, -1, 1.5, Number.POSITIVE_INFINITY]) {
    expect(() => SubagentCheckInPolicySchema.parse({ steps, parentApprovals: 3 })).toThrow();
  }
});
it("ordinary model input can name only the child and retains an optional explicit work", () => {
  const message = { target: { subagentId: id }, continue: false, direction: "Continue research" };
  expect(SubagentMessageToolSchema.parse(message).target).toEqual(message.target);
  expect(SubagentMessageToolSchema.parse({ ...message, target: { ...message.target, workInputId: id } }).target.workInputId).toBe(id);
});
