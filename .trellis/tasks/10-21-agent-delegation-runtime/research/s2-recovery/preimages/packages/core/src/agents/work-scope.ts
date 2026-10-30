/**
 * INPUT: exact Core-minted child identities and ordinary Character queue keys
 * OUTPUT: disjoint private-work lane keys and a Character-hook discriminator
 * POS: core/agents — one key convention shared by the existing queue, registry and composition
 */
const CHILD_PREFIX = "subagent:";

export function subagentLaneKey(subagentId: string): string { return `${CHILD_PREFIX}${subagentId}`; }
export function isSubagentLane(key: string): boolean { return key.startsWith(CHILD_PREFIX); }
