/**
 * INPUT: trusted completed tool source descriptions and references to actual retained work evidence
 * OUTPUT: native result sidecars and selected material descriptions with exact scope validation
 * POS: core/harness — descriptive evidence only; no source strings become execution or publication authority
 */
import { MaterialRefSchema, ToolSourceMaterialSchema, type MaterialRef, type MaterialSource, type PrivateMessage,
  type ToolSourceMaterial } from "@taki/shared";
import type { SubagentRepo } from "../db/subagent-repo.ts";
import type { SubagentInputRepo } from "../db/subagent-input-repo.ts";
import type { SubagentExecutionRepo } from "../db/subagent-execution-repo.ts";
import type { RunMessageRepo } from "../db/run-message-repo.ts";

export interface ToolMaterialSink {
  register(invocation: { attemptId: string; toolCallId: string; toolName: string }, materials: readonly ToolSourceMaterial[]): void;
  attach(attemptId: string, messages: PrivateMessage[]): PrivateMessage[];
}

export function createToolMaterialSink(): ToolMaterialSink {
  const known = new Map<string, { name: string; materials: ToolSourceMaterial[] }>();
  return {
    register(invocation, materials) {
      if (materials.length > 200) throw new Error("SUBAGENT_MATERIAL_LIMIT");
      const parsed = materials.map((material) => ToolSourceMaterialSchema.parse(material));
      if (new Set(parsed.map((material) => material.key)).size !== parsed.length) throw new Error("SUBAGENT_MATERIAL_CONFLICT");
      const key = `${invocation.attemptId}:${invocation.toolCallId}`;
      const value = { name: invocation.toolName, materials: parsed };
      if (known.has(key) && JSON.stringify(known.get(key)) !== JSON.stringify(value)) throw new Error("SUBAGENT_MATERIAL_CONFLICT");
      known.set(key, value);
    },
    attach(attemptId, messages) {
      return messages.map((message) => ({ ...message, ...(message.parts ? { parts: message.parts.map((part) => {
        if (part.type !== "tool-result") return part;
        const value = known.get(`${attemptId}:${part.toolCallId}`);
        if (!value || value.name !== part.toolName || part.output.type.startsWith("error")) return part;
        return { ...part, sourceMaterials: value.materials };
      }) } : {}) }));
    },
  };
}

export interface MaterialSelection {
  resolve(refs: readonly MaterialRef[]): MaterialSource[];
}

export function createMaterialSelection(input: {
  characterId: string; subagentId?: string; children: SubagentRepo; inputs: SubagentInputRepo;
  executions: SubagentExecutionRepo; messages: RunMessageRepo;
}): MaterialSelection {
  const assertChild = (id: string) => {
    if (input.children.get(id).characterId !== input.characterId || (input.subagentId && input.subagentId !== id)) {
      throw new Error("SUBAGENT_MATERIAL_SCOPE_MISMATCH");
    }
  };
  const resolve = (candidate: MaterialRef): MaterialSource | undefined => {
    const ref = MaterialRefSchema.parse(candidate);
    if (ref.kind === "input") {
      const message = input.inputs.get(ref.inputId); assertChild(message.subagentId);
      const material = message.materials.find((item) => item.key === ref.key);
      if (!material) throw new Error("SUBAGENT_MATERIAL_NOT_FOUND");
      return material.source;
    }
    const execution = input.executions.get(ref.kind === "retained_result" ? ref.childRunId : ref.runId);
    assertChild(execution.subagentId);
    if (ref.kind === "retained_result") {
      const result = input.executions.result(ref.childRunId);
      if (!result || result.childDigest !== ref.resultDigest) throw new Error("SUBAGENT_MATERIAL_STALE");
      const material = result.child.sourceContext.materials?.[ref.materialIndex];
      if (!material) throw new Error("SUBAGENT_MATERIAL_NOT_FOUND");
      return material;
    }
    let afterSeq = 0;
    for (;;) {
      const page = input.messages.list({ runId: ref.runId, afterSeq, limit: 2000 });
      const material = page.filter((row) => row.attemptId === ref.attemptId && row.stepNumber === ref.stepNumber)
        .flatMap((row) => row.parts ?? []).filter((part) => part.type === "tool-result").filter((part) => part.toolCallId === ref.toolCallId)
        .flatMap((part) => part.sourceMaterials ?? []).find((item) => item.key === ref.key);
      if (material) return material.source;
      if (page.length < 2000) throw new Error("SUBAGENT_MATERIAL_NOT_FOUND");
      afterSeq = page.at(-1)!.seq;
    }
  };
  return { resolve(refs) {
    if (refs.length > 200) throw new Error("SUBAGENT_MATERIAL_LIMIT");
    return refs.flatMap((ref) => { const source = resolve(ref); return source ? [source] : []; });
  } };
}
