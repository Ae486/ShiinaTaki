/**
 * INPUT: governed tools, captured extension identities and trusted Skill tool bundles
 * OUTPUT: initial model tools and SDK activeTools derived from this generation's completed steps
 * POS: core/agents — visibility only; registration, execution, permission and connection owners stay intact
 */
import type { ToolExecutionOptions, ToolSet } from "ai";
import type { ToolDisclosureSnapshot } from "../extensions/tool-disclosure-snapshot.ts";

export interface SkillToolBundle {
  readonly skillName: string;
  readonly tools: ToolSet;
}

export function bindCapturedSkillLoad(input: {
  tools: ToolSet; snapshot?: ToolDisclosureSnapshot; capturedTools?: ToolSet;
}): ToolSet {
  const original = input.tools.load_skill;
  const snapshot = input.snapshot;
  if (!original || !snapshot) return input.tools;
  const execute = input.capturedTools?.extension_call?.execute as
    ((value: unknown, options: ToolExecutionOptions<unknown>) => unknown | PromiseLike<unknown>) | undefined;
  return { ...input.tools, load_skill: { ...original, async execute(value, options) {
    const reference = record(value) && typeof value.name === "string" ? snapshot.skills[value.name] : undefined;
    if (!reference || !execute) return { ok: false, code: "NOT_FOUND", message: "Skill is unavailable in this captured Run" };
    // Reuse the captured Skill candidate's generation guard and normal governance once. The direct loader must
    // not read a newly published same-name package behind an older Run's immutable snapshot.
    const result = await execute({ extensionId: reference.extensionId, input: {} }, options);
    return record(result) && result.ok === true ? result.output : result;
  } } };
}
interface CompletedToolResult { toolName: string; input: unknown; output: unknown }
interface CompletedStep { toolResults: readonly CompletedToolResult[] }

export function createToolDisclosure(input: {
  tools: ToolSet; snapshot?: ToolDisclosureSnapshot; bundles: readonly SkillToolBundle[];
}) {
  const names = Object.keys(input.tools);
  const bundles = new Map(input.bundles.map((bundle) => [bundle.skillName, Object.keys(bundle.tools)]));
  const deferred = new Set([...(input.snapshot?.deferredToolNames ?? []), ...[...bundles.values()].flat()]);
  const initial = names.filter((name) => !deferred.has(name));
  const initialTools = Object.fromEntries(Object.entries(input.tools).filter(([name]) => !deferred.has(name)));
  return {
    initialTools,
    activeTools(steps: readonly CompletedStep[]): string[] {
      const active = new Set(initial);
      for (const step of steps) for (const result of step.toolResults) {
        const skill = loadedSkill(result, input.snapshot);
        if (skill) for (const name of bundles.get(skill) ?? []) active.add(name);
        const described = describedTool(result, input.snapshot);
        if (described) active.add(described);
      }
      // The SDK validates calls against each step's active subset. A loader and hidden tool in the same
      // response cannot skip the next-step boundary; a historical Timeline load cannot activate anything.
      return names.filter((name) => active.has(name));
    },
  };
}

function loadedSkill(result: CompletedToolResult, snapshot?: ToolDisclosureSnapshot): string | undefined {
  if (!snapshot || !record(result.input)) return;
  if (result.toolName === "load_skill" && typeof result.input.name === "string") {
    const skill = snapshot.skills[result.input.name];
    if (skill && successfulLoad(result.output, skill.contentRevision)) return result.input.name;
  }
  if (result.toolName !== "extension_call" || typeof result.input.extensionId !== "string") return;
  const output = result.output;
  if (!record(output) || output.ok !== true || !record(output.owner)
    || output.owner.extensionId !== result.input.extensionId) return;
  const extensionId = result.input.extensionId;
  return Object.entries(snapshot.skills).find(([, skill]) => skill.extensionId === extensionId
    && successfulLoad(output.output, skill.contentRevision))?.[0];
}

function successfulLoad(output: unknown, revision: string): boolean {
  return record(output) && output.ok === true && typeof output.content === "string" && output.contentRevision === revision;
}

function describedTool(result: CompletedToolResult, snapshot?: ToolDisclosureSnapshot): string | undefined {
  if (!snapshot || result.toolName !== "extension_describe" || !record(result.input)
    || typeof result.input.extensionId !== "string" || !record(result.output)) return;
  const expected = snapshot.describedTools[result.input.extensionId];
  const entry = result.output.entry;
  if (expected && result.output.toolName === expected && record(entry) && entry.available === true
    && record(entry.identity) && entry.identity.extensionId === result.input.extensionId) return expected;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
