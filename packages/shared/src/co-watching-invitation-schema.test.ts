import { describe, expect, it } from "vitest";
import { CoWatchingInvitationReadResultSchema, CoWatchingInvitationRespondSchema,
  CoWatchingInvitationRespondResultSchema } from "./co-watching-invitation-schema.ts";
import { InitiativeViewingFactSchema } from "./initiative-wake-schema.ts";

const input = { characterId: "taki", invitationId: "11111111-1111-4111-8111-111111111111", expectedVersion: 0,
  commandId: "22222222-2222-4222-8222-222222222222", action: "accept" };
describe("Co-Watching invitation contracts", () => {
  it("requires exact command/review references and refuses caller-supplied authority or media changes", () => {
    expect(CoWatchingInvitationRespondSchema.safeParse(input).success).toBe(true);
    expect(CoWatchingInvitationRespondSchema.safeParse({ ...input, expectedVersion: -1 }).success).toBe(false);
    expect(CoWatchingInvitationRespondSchema.safeParse({ ...input, operatorId: "spoofed" }).success).toBe(false);
    expect(CoWatchingInvitationRespondSchema.safeParse({ ...input, sourceRef: input.invitationId }).success).toBe(false);
  });
  it("never treats an accepted acknowledgement without its actual session as success", () => {
    expect(CoWatchingInvitationRespondResultSchema.safeParse({ status: "applied", action: "accept", session: null }).success).toBe(false);
    expect(CoWatchingInvitationRespondResultSchema.safeParse({ status: "applied", action: "defer", session: null }).success).toBe(true);
    expect(CoWatchingInvitationRespondResultSchema.safeParse({ status: "refused", reason: "stale" }).success).toBe(true);
  });
  it("permits an empty read and requires canonical Timeline evidence for an offered card", () => {
    expect(CoWatchingInvitationReadResultSchema.safeParse({ characterId: "taki", invitation: null }).success).toBe(true);
    const invitation = { invitationId: input.invitationId, characterId: "taki", version: 0,
      media: { kind: "bilibili", bvid: "BV1xx411c7mD", cid: "123", page: 1 }, title: "video", expiresAt: "2026-10-17T12:02:00.000Z" };
    expect(CoWatchingInvitationReadResultSchema.safeParse({ characterId: "taki", invitation }).success).toBe(false);
    expect(CoWatchingInvitationReadResultSchema.safeParse({ characterId: "taki", invitation: { ...invitation, timelineSeq: 1 } }).success).toBe(true);
  });
  it("keeps a viewing fact finite and excludes playback positions as granted authority", () => {
    const fact = { viewingId: "view", characterId: "taki", sourceRevision: "r1", eligibleAt: 60_000, expiresAt: 180_000 };
    expect(InitiativeViewingFactSchema.safeParse(fact).success).toBe(true);
    expect(InitiativeViewingFactSchema.safeParse({ ...fact, expiresAt: 60_000 }).success).toBe(false);
    expect(InitiativeViewingFactSchema.safeParse({ ...fact, accepted: true }).success).toBe(false);
  });
});
