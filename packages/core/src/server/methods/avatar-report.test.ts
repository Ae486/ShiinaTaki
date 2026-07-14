import { describe, expect, it } from "vitest";
import { AVATAR_METHODS } from "@taki/shared";
import { createAvatarVocabulary } from "../../avatar/avatar-vocabulary.ts";
import type { Connection } from "../connection-registry.ts";
import type { MethodContext } from "../method-registry.ts";
import { avatarReportMethod } from "./avatar-report.ts";

function fakeCtx(): MethodContext {
  const connection: Connection = {
    state: { status: "authenticated", deviceId: "d1", role: "operator", capabilities: [] },
  };
  return { notify: () => undefined, connection, close: () => undefined, onClose: () => undefined };
}

describe("avatarReportMethod", () => {
  it("is operator-only and named avatar.report", () => {
    const def = avatarReportMethod(createAvatarVocabulary());
    expect(def.method).toBe(AVATAR_METHODS.report);
    expect(def.roles).toEqual(["operator"]);
  });

  it("writes the reported names into the vocabulary store (which then renders them into the turn prompt)", () => {
    const vocab = createAvatarVocabulary();

    expect(
      avatarReportMethod(vocab).handler({ characterId: "taki", motions: ["smile01"], expressions: ["default"] }, fakeCtx()),
    ).toEqual({ status: "ok" });

    const rendered = vocab.render("taki");
    expect(rendered).toContain("smile01");
    expect(rendered).toContain("default");
  });
});
