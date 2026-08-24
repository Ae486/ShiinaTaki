import { describe, expect, it } from "vitest";
import { operationIdentity } from "../legacy-migration/legacy-identities.ts";
import { hindsightOperationUuid } from "./hindsight-import-identity.ts";

describe("Hindsight import operation UUID", () => {
  it("derives a deterministic UUID without replacing the B2 audit identity", () => {
    const identity = operationIdentity("bank", "document", "a".repeat(64));
    const uuid = hindsightOperationUuid(identity);
    expect(identity).toMatch(/^sha256:/);
    expect(uuid).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-5[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
    expect(hindsightOperationUuid(identity)).toBe(uuid);
  });
});
