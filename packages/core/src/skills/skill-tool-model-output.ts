/**
 * INPUT:  raw Skill load/resource results captured by existing governed tool closures
 * OUTPUT: model JSON without successful-load revision bookkeeping; failures stay complete
 * POS:    core/skills — SDK-only projection; raw revision remains the disclosure/currentness authority
 */
import type { Tool } from "ai";

export const skillToolModelOutput: NonNullable<Tool["toModelOutput"]> = ({ output }) => {
  if (typeof output === "object" && output !== null && "ok" in output && output.ok === true
    && "content" in output && typeof output.content === "string" && "contentRevision" in output) {
    return { type: "json", value: { ok: true, content: output.content,
      ...("files" in output ? { files: output.files } : {}) } };
  }
  return { type: "json", value: output };
};
