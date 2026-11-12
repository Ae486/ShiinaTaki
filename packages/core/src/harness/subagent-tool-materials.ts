/**
 * INPUT: trusted completed tool source descriptions and references to actual retained work evidence
 * OUTPUT: native result sidecars and selected material descriptions with exact scope validation
 * POS: core/harness — descriptive evidence only; no source strings become execution or publication authority
 */
import { MaterialRefSchema, ToolSourceMaterialSchema, type MaterialRef, type MaterialSource, type PrivateMessage,
  type ToolSourceMaterial, type ContextMaterial } from "@taki/shared";
import type { SubagentRepo } from "../db/subagent-repo.ts";
import type { SubagentInputRepo } from "../db/subagent-input-repo.ts";
import type { SubagentExecutionRepo } from "../db/subagent-execution-repo.ts";
import type { RunMessageRepo } from "../db/run-message-repo.ts";
import type { ModelMessage } from "ai";
import { renderToolResult } from "../agents/source-context.ts";
import { toolSourceMaterials } from "../agents/tool-source-materials.ts";
import type { PrivateToolResult, SubagentToolResultRepo } from "../db/subagent-tool-result-repo.ts";
import { copyNativeToolImages } from "../agents/native-tool-images.ts";

export interface ToolMaterialSink {
  register(invocation: { attemptId: string; stepNumber?: number; toolCallId: string; toolName: string }, materials: readonly ToolSourceMaterial[]): void;
  attach(attemptId: string, messages: PrivateMessage[], stepNumber?: number): PrivateMessage[];
  render(attemptId: string, messages: ModelMessage[]): ModelMessage[];
  capture(input: { runId: string; attemptId: string; stepNumber: number;
    results: readonly { toolCallId: string; toolName: string; output: unknown }[] }): void;
  select(ref: MaterialRef): ContextMaterial | undefined;
  release?(input: { attemptId: string; throughStep: number }): void;
}
type KnownMaterials = Map<string, { name: string; materials: ToolSourceMaterial[] }>;
type CompletedMaterials = Map<string, { ref: Extract<MaterialRef, { kind: "tool_result" }>; text: string }[]>;

export function createToolMaterialSink(storage?: Pick<SubagentToolResultRepo, "persist" | "read">): ToolMaterialSink {
  const known: KnownMaterials = new Map();
  const completed: CompletedMaterials = new Map();
  const outputs = new WeakMap<object, string>();
  return {
    register(invocation, materials) {
      if (materials.length > 200) throw new Error("SUBAGENT_MATERIAL_LIMIT");
      const parsed = materials.map((material) => ToolSourceMaterialSchema.parse(material));
      if (new Set(parsed.map((material) => material.key)).size !== parsed.length) throw new Error("SUBAGENT_MATERIAL_CONFLICT");
      const key = materialKey(invocation.attemptId, invocation.stepNumber, invocation.toolCallId);
      const value = { name: invocation.toolName, materials: parsed };
      if (known.has(key) && JSON.stringify(known.get(key)) !== JSON.stringify(value)) throw new Error("SUBAGENT_MATERIAL_CONFLICT");
      known.set(key, value);
    },
    attach(attemptId, messages, stepNumber) {
      return messages.map((message) => ({ ...message, ...(message.parts ? { parts: message.parts.map((part) => {
        if (part.type !== "tool-result") return part;
        const key = materialKey(attemptId, stepNumber, part.toolCallId);
        const value = known.get(key) ?? known.get(materialKey(attemptId, undefined, part.toolCallId));
        if (!value || value.name !== part.toolName) return part;
        outputs.set(part.output, key);
        return { ...part, sourceMaterials: value.materials };
      }) } : {}) }));
    },
    render(attemptId, messages) {
      return messages.map((message) => message.role !== "tool" ? message : { ...message, content: message.content.map((part) => {
        if (part.type !== "tool-result") return part;
        const key = outputs.get(part.output) ?? materialKey(attemptId, undefined, part.toolCallId);
        const value = known.get(key);
        if (!value || value.name !== part.toolName) return part;
        const refs = completed.get(key)?.map((item) => item.ref) ?? [];
        const original = referenceOutputs.get(part.output) ?? part.output;
        const output = copyNativeToolImages(part.output, renderToolResult(withToolMaterialReferences(original, refs), value.materials));
        referenceOutputs.set(output, original);
        outputs.set(output, key);
        return { ...part, output };
      }) });
    },
    capture: (input) => captureMaterials({ known, completed, storage }, input),
    select: (ref) => selectCompleted({ known, completed, storage }, ref),
    release: (input) => releaseMaterials({ known, completed, storage }, input),
  };
}

function releaseMaterials(state: { known: KnownMaterials; completed: CompletedMaterials;
  storage?: Pick<SubagentToolResultRepo, "persist"> }, input: { attemptId: string; throughStep: number }): void {
  const { known, completed, storage } = state;
  if (!storage) return; // Unsaved evidence must never be discarded merely to meet a cache budget.
  for (const [key, values] of completed) {
    const ref = values[0]?.ref;
    if (ref?.attemptId === input.attemptId && ref.stepNumber <= input.throughStep) {
      completed.delete(key); known.delete(key);
    }
  }
}

function captureMaterials(state: { known: KnownMaterials; completed: CompletedMaterials;
  storage?: Pick<SubagentToolResultRepo, "persist"> }, input: Parameters<ToolMaterialSink["capture"]>[0]): void {
  const { known, completed, storage } = state;
  for (const result of input.results) {
    const key = materialKey(input.attemptId, input.stepNumber, result.toolCallId);
    const supplied = toolSourceMaterials(result.output) ?? known.get(key)?.materials
      ?? known.get(materialKey(input.attemptId, undefined, result.toolCallId))?.materials;
    // An explicit empty source list means unknown provenance, not an absent completed result. Keeping its
    // result reference also gives release() the exact completed frontier for this otherwise empty cache entry.
    const materials = supplied?.length ? supplied : [{ key: "result", source: undefined }];
    const text = JSON.stringify(result.output) ?? "null";
    storage?.persist({ runId: input.runId, attemptId: input.attemptId, stepNumber: input.stepNumber,
      toolCallId: result.toolCallId, toolName: result.toolName, text, materials: [...materials] });
    known.delete(materialKey(input.attemptId, undefined, result.toolCallId));
    known.set(key, { name: result.toolName, materials: [...materials] });
    completed.set(key, materials.map((material) => ({ text, ref: { kind: "tool_result", runId: input.runId,
      attemptId: input.attemptId, stepNumber: input.stepNumber, toolCallId: result.toolCallId, key: material.key } })));
  }
}

function materialKey(attemptId: string, stepNumber: number | undefined, callId: string): string {
  return JSON.stringify([attemptId, stepNumber ?? null, callId]);
}

function selectCompleted(state: { known: KnownMaterials; completed: CompletedMaterials;
  storage?: Pick<SubagentToolResultRepo, "read"> }, ref: MaterialRef): ContextMaterial | undefined {
  if (ref.kind !== "tool_result") return undefined;
  const key = materialKey(ref.attemptId, ref.stepNumber, ref.toolCallId);
  const result = state.completed.get(key)?.find((item) => item.ref.runId === ref.runId && item.ref.key === ref.key);
  if (result) return { key: ref.key, text: result.text, source: state.known.get(key)?.materials.find((item) => item.key === ref.key)?.source };
  return storedMaterial(state.storage?.read(ref), ref.key);
}

function storedMaterial(result: PrivateToolResult | undefined, key: string): ContextMaterial | undefined {
  const material = result?.materials.find((item) => item.key === key);
  return result && material ? { key, text: result.text, source: material.source } : undefined;
}

const referenceOutputs = new WeakMap<object, import("ai").ToolResultPart["output"]>();
export function withToolMaterialReferences(output: import("ai").ToolResultPart["output"], refs: MaterialRef[]): import("ai").ToolResultPart["output"] {
  if (refs.length === 0) return output;
  const original = referenceOutputs.get(output) ?? output;
  const header = `Core material references for this exact completed result: ${JSON.stringify(refs)}`;
  const result = original.type === "json" || original.type === "error-json" ? { ...original, value: { materialReferences: refs, result: original.value } }
    : original.type === "text" || original.type === "error-text" ? { ...original, value: `${header}\n${original.value}` }
      : original.type === "content" ? { ...original, value: [{ type: "text" as const, text: header }, ...original.value] }
        : { ...original, reason: `${header}\n${original.reason ?? "Tool execution denied."}` };
  referenceOutputs.set(result, original); return result;
}

export interface MaterialSelection {
  resolve(refs: readonly MaterialRef[]): MaterialSource[];
  select(refs: readonly MaterialRef[]): ContextMaterial[];
}

export function createMaterialSelection(input: {
  characterId: string; subagentId?: string; children: SubagentRepo; inputs: SubagentInputRepo;
  executions: SubagentExecutionRepo; messages: RunMessageRepo;
  toolResults?: SubagentToolResultRepo;
}): MaterialSelection {
  const assertChild = (id: string) => {
    if (input.children.get(id).characterId !== input.characterId || (input.subagentId && input.subagentId !== id)) {
      throw new Error("SUBAGENT_MATERIAL_SCOPE_MISMATCH");
    }
  };
  const resolve = (candidate: MaterialRef): ContextMaterial => {
    const ref = MaterialRefSchema.parse(candidate);
    if (ref.kind === "input") {
      const message = input.inputs.get(ref.inputId); assertChild(message.subagentId);
      const material = message.materials.find((item) => item.key === ref.key);
      if (!material) throw new Error("SUBAGENT_MATERIAL_NOT_FOUND");
      return material;
    }
    const execution = input.executions.get(ref.kind === "retained_result" ? ref.childRunId : ref.runId);
    assertChild(execution.subagentId);
    if (ref.kind === "retained_result") {
      const result = input.executions.result(ref.childRunId);
      if (!result || result.childDigest !== ref.resultDigest) throw new Error("SUBAGENT_MATERIAL_STALE");
      const material = result.child.sourceContext.materials?.[ref.materialIndex];
      if (!material) throw new Error("SUBAGENT_MATERIAL_NOT_FOUND");
      return { key: `result:${ref.materialIndex}`, text: JSON.stringify(result.child), source: material };
    }
    const stored = storedMaterial(input.toolResults?.read(ref), ref.key);
    if (stored) return stored;
    let afterSeq = 0;
    for (;;) {
      const page = input.messages.list({ runId: ref.runId, afterSeq, limit: 2000 });
      const parts = page.filter((row) => row.attemptId === ref.attemptId && row.stepNumber === ref.stepNumber)
        .flatMap((row) => row.parts ?? []).filter((part) => part.type === "tool-result").filter((part) => part.toolCallId === ref.toolCallId)
      const part = parts.find((part) => part.sourceMaterials?.some((item) => item.key === ref.key));
      if (part) return { key: ref.key, text: JSON.stringify(part.output), source: part.sourceMaterials?.find((item) => item.key === ref.key)?.source };
      if (page.length < 2000) throw new Error("SUBAGENT_MATERIAL_NOT_FOUND");
      afterSeq = page.at(-1)!.seq;
    }
  };
  const select = (refs: readonly MaterialRef[]) => {
    if (refs.length > 200) throw new Error("SUBAGENT_MATERIAL_LIMIT");
    return refs.map((ref, index) => ({ ...resolve(ref), key: `selected:${index}` }));
  };
  return { select, resolve: (refs) => select(refs).flatMap((material) => material.source ? [material.source] : []) };
}
