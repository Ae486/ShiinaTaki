/**
 * INPUT:  validated extension directory results and one captured registry's Host vector
 * OUTPUT: compact descriptors retaining exact selectors, availability, routing and truncation
 * POS:    core/extensions — model-only directory projection; disclosure still consumes raw identity/toolName
 */
import type { ExtensionDescriptor, ExtensionDescribeResult, ExtensionDiscoverResult } from "@taki/shared";

export function extensionDescriptorModelView(entry: ExtensionDescriptor, multiHost: boolean) {
  return { extensionId: entry.identity.extensionId, kind: entry.identity.kind,
    ...(multiHost ? { ownerHostId: entry.identity.ownerHostId } : {}),
    displayName: entry.displayName, summary: entry.summary, callMode: entry.callMode, available: entry.available };
}

export function extensionDiscoverModelOutput(output: ExtensionDiscoverResult, multiHost: boolean) {
  return { type: "json" as const, value: { entries: output.entries.map((entry) => extensionDescriptorModelView(entry, multiHost)),
    truncated: output.truncated } };
}

export function extensionDescribeModelOutput(output: ExtensionDescribeResult, multiHost: boolean) {
  return { type: "json" as const, value: { entry: output.entry ? extensionDescriptorModelView(output.entry, multiHost) : null,
    ...(output.toolName ? { toolName: output.toolName } : {}) } };
}
