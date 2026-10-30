import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PreparedPublicationSourceSchema } from "@taki/shared";
import { preparedPublicationFixture } from "../testing/prepared-publication-fixture.ts";
import { createCoWatchingPublicationSource } from "./publication-source.ts";

const fixtures: Awaited<ReturnType<typeof preparedPublicationFixture>>[] = [];
beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime("2026-10-12T12:00:00.000Z"); });
afterEach(() => { for (const fixture of fixtures.splice(0)) fixture.cleanup(); vi.useRealTimers(); });

describe("M51 business adapter over generic prepared publication", () => {
  it("maps only current trusted accepted Co-Watching to Class A without an extra model call or initiative charge", async () => {
    let policy = "accepted_co_watching";
    const fixture = await preparedPublicationFixture({ sourceFactory: (producer) => createCoWatchingPublicationSource({
      ...producer, readAccepted: () => {
        const { validity, ...accepted } = PreparedPublicationSourceSchema.parse(producer.readAccepted());
        if (validity.kind !== "expires_at") throw new Error("FINITE_SOURCE_REQUIRED");
        return { ...accepted, expiresAt: validity.expiresAt, policy };
      },
    }) });
    fixtures.push(fixture);
    const first = await fixture.owner.publish({ candidateRef: "one", expectedRevision: "r1" });
    expect(first).toMatchObject({ status: "recorded", state: "sent" });
    if (first.status !== "recorded") throw new Error("Expected recorded output");
    expect(fixture.runs.status(first.runId).run.deliveryClass).toBe("class_a");
    expect(fixture.effects.list?.(first.runId)).toEqual([]);
    expect(fixture.db.prepare("SELECT count(*) AS n FROM initiative_model_opportunities").get()?.n).toBe(0);
    policy = "unsolicited_invitation";
    expect(await fixture.owner.publish({ candidateRef: "two", expectedRevision: "r1" }))
      .toEqual({ status: "refused", reason: "root_unavailable" });
    expect(fixture.send).toHaveBeenCalledTimes(1);
  });

  it("refuses invitations, missing acceptance and client flags at the business adapter", () => {
    const source = { sourceRef: "media", acceptanceRef: "accepted-request", characterId: "taki", revision: "r1",
      expiresAt: "2026-10-12T12:01:00.000Z", policy: "accepted_co_watching" };
    for (const data of [undefined, { ...source, policy: "unsolicited_invitation" },
      { ...source, acceptanceRef: "" }, { ...source, accepted: true }, { ...source, deliveryClass: "class_a" }]) {
      expect(() => createCoWatchingPublicationSource({ readAccepted: () => data, resolve: () => undefined,
        isCurrent: () => true, gate: () => "ready" })).toThrow();
    }
    expect(() => createCoWatchingPublicationSource({ readAccepted: () => source, resolve: () => undefined,
      isCurrent: () => false, gate: () => "ready" })).toThrow("PREPARED_AUTHORIZATION_UNAVAILABLE");
  });
});
