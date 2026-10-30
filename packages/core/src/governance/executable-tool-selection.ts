/**
 * INPUT: the final immutable SDK tool lookup and trusted extension dispatch options
 * OUTPUT: process-private membership binding shared by direct tools and extension aliases
 * POS: core/governance — selection propagation only; ordinary governance still decides every available operation
 */
import type { Tool, ToolExecutionOptions, ToolSet } from "ai";

const SELECTION = Symbol("taki.executable-tool-selection");

export function selectedExecutableTools(options: unknown): ReadonlySet<string> | undefined {
  return typeof options === "object" && options !== null
    ? (options as Record<PropertyKey, unknown>)[SELECTION] as ReadonlySet<string> | undefined : undefined;
}

export function bindExecutableToolSelection(tools: ToolSet): ToolSet {
  const selected = new Set(Object.keys(tools));
  return Object.freeze(Object.fromEntries(Object.entries(tools).map(([name, value]) => {
    const execute = value.execute;
    if (!execute) return [name, value];
    const descriptors = Object.getOwnPropertyDescriptors(value);
    descriptors.execute = { ...descriptors.execute,
      value: (input: unknown, options: ToolExecutionOptions<unknown>) => execute(input,
        { ...options, [SELECTION]: selected } as ToolExecutionOptions<unknown>) };
    return [name, Object.freeze(Object.create(Object.getPrototypeOf(value), descriptors)) as Tool];
  })));
}
