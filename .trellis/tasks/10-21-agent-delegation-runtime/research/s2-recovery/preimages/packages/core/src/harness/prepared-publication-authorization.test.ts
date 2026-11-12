import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPreparedPublicationAuthorization, readPreparedPublicationAuthorization } from "./prepared-publication-authorization.ts";

const scope = { sourceRef: "requested-report", acceptanceRef: "explicit-request", characterId: "taki",
  expiresAt: "2026-10-12T12:01:00.000Z", deliveryClass: "class_a" as const };
beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime("2026-10-12T12:00:00.000Z"); });
afterEach(() => { vi.useRealTimers(); });

describe("registered prepared output authorization", () => {
  it("retains immutable scope and requires the original process-owned handle", () => {
    const mutable = { ...scope };
    const authorization = createPreparedPublicationAuthorization({ scope: mutable, isCurrent: () => true });
    mutable.sourceRef = "changed";
    expect(readPreparedPublicationAuthorization(authorization, scope)).toEqual(scope);
    for (const value of [undefined, {}, { ...authorization }, JSON.parse(JSON.stringify(authorization)),
      { scope, isCurrent: () => true }]) {
      expect(readPreparedPublicationAuthorization(value, scope)).toBeUndefined();
    }
    expect(Object.isFrozen(authorization)).toBe(true);
    expect(Object.isFrozen(readPreparedPublicationAuthorization(authorization, scope))).toBe(true);
  });

  it("rechecks revocation, expiry and every acceptance identity field", () => {
    let current = true;
    const authorization = createPreparedPublicationAuthorization({ scope, isCurrent: () => current });
    for (const change of [{ sourceRef: "other" }, { acceptanceRef: "other" }, { characterId: "other" },
      { expiresAt: "2026-10-12T12:02:00.000Z" }]) {
      expect(readPreparedPublicationAuthorization(authorization, { ...scope, ...change })).toBeUndefined();
    }
    current = false;
    expect(readPreparedPublicationAuthorization(authorization, scope)).toBeUndefined();
    current = true; vi.setSystemTime(scope.expiresAt);
    expect(readPreparedPublicationAuthorization(authorization, scope)).toBeUndefined();
  });

  it("preserves the registered authority callback's receiver without adopting a replacement callback", () => {
    const registration = { scope, approved: true, isCurrent() { return this.approved; } };
    const authorization = createPreparedPublicationAuthorization(registration);
    expect(readPreparedPublicationAuthorization(authorization, scope)).toEqual(scope);
    registration.approved = false;
    registration.isCurrent = () => true;
    expect(readPreparedPublicationAuthorization(authorization, scope)).toBeUndefined();
  });

  it.each([1, "true", {}, Promise.resolve(true), false])("rejects non-affirmative authority %s", (value) => {
    const input = { scope, isCurrent: () => true };
    Reflect.set(input, "isCurrent", () => value);
    expect(() => createPreparedPublicationAuthorization(input)).toThrow("PREPARED_AUTHORIZATION_UNAVAILABLE");
  });

  it("rejects throwing authority and unsupported delivery classes", () => {
    expect(() => createPreparedPublicationAuthorization({ scope, isCurrent() { throw new Error("unavailable"); } }))
      .toThrow("PREPARED_AUTHORIZATION_UNAVAILABLE");
    const unsupported = { ...scope };
    Reflect.set(unsupported, "deliveryClass", "class_b");
    expect(() => createPreparedPublicationAuthorization({ scope: unsupported, isCurrent: () => true })).toThrow();
  });
});
