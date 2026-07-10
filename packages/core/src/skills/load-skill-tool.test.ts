import { describe, expect, it } from "vitest";
import { createLoadSkillTool } from "./load-skill-tool.ts";
import type { SkillsLoader } from "./skills-loader.ts";

const loader: SkillsLoader = {
  renderList: () => "",
  load: (name) => (name === "alpha" ? { ok: true, content: "alpha body" } : { ok: false, code: "NOT_FOUND", message: "no" }),
};

describe("createLoadSkillTool", () => {
  it("exposes a single load_skill tool that delegates to the loader", async () => {
    const tools = createLoadSkillTool(loader);
    expect(Object.keys(tools)).toEqual(["load_skill"]);
    const result = await tools.load_skill?.execute?.({ name: "alpha" }, { toolCallId: "c1", messages: [] } as never);
    expect(result).toEqual({ ok: true, content: "alpha body" });
  });

  it("passes through a not-found result without throwing", async () => {
    const tools = createLoadSkillTool(loader);
    const result = await tools.load_skill?.execute?.({ name: "ghost" }, { toolCallId: "c1", messages: [] } as never);
    expect(result).toMatchObject({ ok: false, code: "NOT_FOUND" });
  });
});
