import { describe, expect, it } from "vitest";
import { workBindingRefusal } from "./run-work-binding.ts";

describe("retained work source callback contract", () => {
  it.each([1, "true", {}, Promise.resolve(true)])("rejects truthy non-boolean source authority %s", (value) => {
    const context = { authorityCurrent: () => true, acceptedWork: { sourceRef: "original", isCurrent: () => true } };
    Reflect.set(context.acceptedWork, "isCurrent", () => value);
    expect(workBindingRefusal(context, "original")).toBe("binding_lost");
  });

  it("treats a throwing current-source callback as lost authority", () => {
    const context = { authorityCurrent: () => true, acceptedWork: { sourceRef: "original",
      isCurrent: () => { throw new Error("source view unavailable"); } } };
    expect(workBindingRefusal(context, "original")).toBe("authority_changed");
  });
});
