/**
 * INPUT:  a captured candidate lookup and raw sealed extension-call results
 * OUTPUT: known non-MCP candidate projections or conservative complete MCP/unknown output and failure views
 * POS:    core/extensions — process-local projection paired with canonical identity; no new registry or transport
 */
import { ExtensionCallParamsSchema, ExtensionCallResultSchema, type ExtensionIdentity } from "@taki/shared";
import type { Tool } from "ai";

interface ModelBinding { identity: ExtensionIdentity; toModelOutput?: Tool["toModelOutput"] }

export function createExtensionCallModelOutput(lookup: (extensionId: string) => ModelBinding | undefined): NonNullable<Tool["toModelOutput"]> {
  return ({ input, output, toolCallId }) => {
    const params = ExtensionCallParamsSchema.safeParse(input);
    const parsed = ExtensionCallResultSchema.safeParse(output);
    if (!parsed.success) return { type: "json", value: output };
    const result = parsed.data;
    const binding = params.success ? lookup(params.data.extensionId) : undefined;
    if (result.ok) {
      if (binding?.toModelOutput && binding.identity.kind !== "mcp-tool" && params.success
        && JSON.stringify(result.owner) === JSON.stringify(binding.identity)) {
        return binding.toModelOutput({ input: params.data.input, output: result.output, toolCallId });
      }
      return { type: "json", value: { ok: true, output: result.output } };
    }
    return { type: "json", value: { ok: false, code: result.code, message: result.message,
      ...("state" in result && result.state ? { state: result.state } : {}) } };
  };
}
