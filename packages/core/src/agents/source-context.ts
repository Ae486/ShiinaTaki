/**
 * INPUT: optional retained source facts, material text and native SDK tool outputs
 * OUTPUT: model-readable source projections with unchanged outcome kinds and reducible associated bodies
 * POS: core/agents — common source renderer; projection only, no inference of attribution or authority
 */
import type { ToolResultPart } from "ai";
import type { ContextMaterial, SourceContext, ToolSourceMaterial } from "@taki/shared";
import { fenceUntrusted } from "./untrusted-fence.ts";
import { toolSourceMaterials, withToolSourceMaterials } from "./tool-source-materials.ts";
import type { TurnMessage } from "./turn-mapping.ts";

type ToolOutput = ToolResultPart["output"];
// Projection-local association lets reduction separate the source header from the original body.
// Never recover program-known source facts by parsing a tool's text or a model-authored label.
const projectedOutputs = new WeakMap<object, { original: ToolOutput; materials: readonly ToolSourceMaterial[] }>();

/** The SDK's output conversion can discard non-enumerable producer facts; bind them to its exact completed pair. */
export function retainStepToolSources(messages: TurnMessage[], results: readonly { toolCallId: string; toolName: string; output: unknown }[]): TurnMessage[] {
  return messages.map((message) => message.role !== "tool" ? message : { ...message, content: message.content.map((part) => {
    if (part.type !== "tool-result") return part;
    const result = results.find((item) => item.toolCallId === part.toolCallId && item.toolName === part.toolName);
    const materials = toolSourceMaterials(result?.output);
    return materials?.length ? { ...part, output: withToolSourceMaterials({ ...part.output }, materials) } : part;
  }) });
}

export function renderSourceContext(context: SourceContext | undefined): string {
  if (!context || !context.generatedBy && !context.materials?.length) return "";
  return `Source context for the associated content (descriptive material and generation facts):\n${fenceUntrusted({
    source: "source-context", content: JSON.stringify(context),
  })}`;
}

export function renderContextMaterial(material: ContextMaterial): string {
  const source = renderSourceContext(material.source ? { materials: [material.source] } : undefined);
  return [source, fenceUntrusted({ source: "supplied-material", content: JSON.stringify({ key: material.key, text: material.text }) })]
    .filter(Boolean).join("\n");
}

export function renderToolResult(output: ToolOutput, materials?: readonly ToolSourceMaterial[]): ToolOutput {
  if (!materials?.length) return output;
  materials = structuredClone(materials);
  const original = projectedOutputs.get(output)?.original ?? output;
  const header = fenceUntrusted({ source: "tool-result-sources", content: JSON.stringify(materials) });
  let rendered: ToolOutput;
  if (original.type === "text" || original.type === "error-text") {
    rendered = { ...original, value: `${header}\n${original.value}` };
  } else if (original.type === "json" || original.type === "error-json") {
    rendered = { ...original, value: { sourceContext: header, result: original.value } };
  } else if (original.type === "content") {
    rendered = { ...original, value: [{ type: "text", text: header }, ...original.value] };
  } else {
    rendered = { ...original, reason: `${header}\n${original.reason ?? "Tool execution denied."}` };
  }
  projectedOutputs.set(rendered, { original, materials });
  return rendered;
}

/** Reduce the body/status and keep the same source facts beside its surviving content or trace. */
export function reduceSourcedToolResult(output: ToolOutput, reduce: (value: ToolOutput) => ToolOutput): ToolOutput {
  const source = projectedOutputs.get(output);
  return source ? renderToolResult(reduce(source.original), source.materials) : reduce(output);
}
