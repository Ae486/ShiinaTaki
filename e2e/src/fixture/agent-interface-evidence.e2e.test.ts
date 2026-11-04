import { describe, expect, it } from "vitest";
import { assessInterfaceCalls, assertAssessedInterfaceBehavior, mainCalls } from "./agent-interface-evidence.ts";

describe("private native invocation evidence with intentionally omitted input", () => {
  it("derives only receipt-backed intent and refuses unknown execution or inspection assessments", () => {
    const parts = [{ type: "tool-call", toolCallId: "handled-final-step", toolName: "handle_agent_event" },
      { type: "tool-call", toolCallId: "unobserved-exec", toolName: "exec" },
      { type: "tool-call", toolCallId: "unobserved-extension", toolName: "extension_call" },
      { type: "tool-call", toolCallId: "unobserved-inspection-a", toolName: "inspect_subagent" },
      { type: "tool-call", toolCallId: "unobserved-inspection-b", toolName: "inspect_subagent" }];
    const calls = mainCalls({ requests: [], rows: (sql) => sql.includes("parts_json")
      ? [{ parts: JSON.stringify(parts) }]
      : [{ tool_call_id: "handled-final-step", event_id: "accepted-final-event",
        action_json: JSON.stringify({ kind: "speech_proposed", note: "A complete actual publication proposal." }) }] });
    expect(calls[0]).toMatchObject({ arguments: null, inputProvenance: "canonical-input-unavailable", category: "derived:reply",
      derivedIntent: { intent: "reply", actionKind: "speech_proposed", eventId: "accepted-final-event", provenance: "canonical-action-receipt" } });
    expect(calls[1]).toMatchObject({ arguments: null, command: null, waitOnlyExec: null, derivedIntent: null });
    const assessment = assessInterfaceCalls(calls);
    expect(assessment.unassessedExecutionInputs).toHaveLength(2);
    expect(assessment.unknownInspectionInputs).toHaveLength(2);
    expect(assessment.repeatedIdenticalInspections).toEqual([]);
    expect(() => assertAssessedInterfaceBehavior(assessment)).toThrow(/Missing execution input/u);
    expect(() => assertAssessedInterfaceBehavior(assessInterfaceCalls(calls.filter((call) => call.toolName === "inspect_subagent"))))
      .toThrow(/Missing inspection input/u);
    expect(() => assertAssessedInterfaceBehavior(assessInterfaceCalls([calls[0]!]))).not.toThrow();
  });
});
