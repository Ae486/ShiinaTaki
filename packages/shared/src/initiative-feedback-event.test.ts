import { describe, expect, it } from "vitest";
import { InitiativeEventPayloadSchema } from "./initiative-event-schema.ts";

describe("presentation and feedback event facts", () => {
  it("requires measured opportunity and a closed disposition at settlement", () => {
    const fact = { kind: "delivery.feedback_settled", state: "feedback_settled", deliveryId: "delivery",
      opportunityMs: 120_000, disposition: "weak_non_engagement" };
    expect(InitiativeEventPayloadSchema.parse(fact)).toEqual(fact);
    expect(InitiativeEventPayloadSchema.safeParse({ ...fact, opportunityMs: undefined }).success).toBe(false);
    expect(InitiativeEventPayloadSchema.safeParse({ ...fact, disposition: "read" }).success).toBe(false);
    expect(InitiativeEventPayloadSchema.safeParse({ ...fact, opportunityMs: -1 }).success).toBe(false);
    expect(InitiativeEventPayloadSchema.safeParse({ ...fact, opportunityMs: 3_600_001 }).success).toBe(false);
    expect(InitiativeEventPayloadSchema.safeParse({ ...fact, sourceText: "private" }).success).toBe(false);
  });

  it("cannot reinterpret transport acceptance or presentation as engagement", () => {
    expect(InitiativeEventPayloadSchema.safeParse({ kind: "delivery.sent", state: "sent", deliveryId: "delivery" }).success).toBe(true);
    expect(InitiativeEventPayloadSchema.safeParse({ kind: "delivery.sent", state: "sent", deliveryId: "delivery",
      opportunityMs: 0 }).success).toBe(false);
    expect(InitiativeEventPayloadSchema.safeParse({ kind: "delivery.presented", state: "presented", deliveryId: "delivery",
      opportunityMs: 0 }).success).toBe(true);
    expect(InitiativeEventPayloadSchema.safeParse({ kind: "delivery.presented", state: "presented", deliveryId: "delivery" }).success).toBe(true);
    expect(InitiativeEventPayloadSchema.safeParse({ kind: "delivery.presented", state: "presented", deliveryId: "delivery",
      opportunityMs: 0, disposition: "engaged" }).success).toBe(false);
  });
});
