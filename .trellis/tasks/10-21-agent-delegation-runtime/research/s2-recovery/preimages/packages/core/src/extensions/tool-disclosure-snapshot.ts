/**
 * INPUT:  one captured extension registry, matching direct MCP tools, and the Core Host identity
 * OUTPUT: frozen ToolDisclosureSnapshot linking eligible descriptors to existing tool and Skill identities
 * POS:    core/extensions — internal model disclosure metadata; no schemas, handlers, or execution authority
 */
import type { ToolSet } from "ai";
import type { ExtensionRegistry } from "./extension-registry.ts";

export type ToolDisclosureSnapshot = {
  readonly deferredToolNames: readonly string[];
  readonly describedTools: Readonly<Record<string, string>>;
  readonly skills: Readonly<Record<string, { readonly extensionId: string; readonly contentRevision: string }>>;
};

export function createToolDisclosureSnapshot(
  registry: ExtensionRegistry,
  directTools: ToolSet,
  coreHostId: string,
): ToolDisclosureSnapshot {
  const describedTools: [string, string][] = [];
  const skills = new Map<string, { readonly extensionId: string; readonly contentRevision: string }>();
  const duplicateSkills = new Set<string>();
  for (const entry of registry.snapshot.entries) {
    const { extensionId, subjectRevision, ownerHostId, kind } = entry.identity;
    const { toolName } = registry.describe({ extensionId });
    if (toolName && Object.hasOwn(directTools, toolName)) describedTools.push([extensionId, toolName]);
    if (kind !== "skill" || entry.callMode !== "skill-load" || ownerHostId !== coreHostId || !entry.available) continue;
    if (skills.has(entry.displayName)) duplicateSkills.add(entry.displayName);
    skills.set(entry.displayName, Object.freeze({ extensionId, contentRevision: subjectRevision }));
  }
  for (const name of duplicateSkills) skills.delete(name);
  return Object.freeze({
    // Discovery overflow stays deferred: its unadmitted descriptor cannot disclose a model-callable definition.
    deferredToolNames: Object.freeze(Object.keys(directTools)),
    describedTools: Object.freeze(Object.fromEntries(describedTools)),
    skills: Object.freeze(Object.fromEntries(skills)),
  });
}
