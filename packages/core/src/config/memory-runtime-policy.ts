/**
 * INPUT: resolved Memory settings and the existing configuration application observer
 * OUTPUT: cached accepted policies with independent assembly, search, retention and maintenance availability
 * POS: core/config — invalid optional policy never prevents construction of the control plane
 */
import { loadMemoryConfig, type MemoryConfig } from "./memory-config.ts";
import type { ConfigApplicationTracker } from "./config-application.ts";

const GROUPS = {
  assembly: { TAKI_MEMORY_PINNED_BUDGET: "pinnedBudget" },
  search: { TAKI_MEMORY_STOPLIST: "stoplist" },
  ranking: { TAKI_MEMORY_BM25_WEIGHTS: "bm25Weights" },
  retention: { TAKI_MEMORY_INTENTIONS_DEFAULT_DAYS: "intentionsDefaultDays" },
  tidy: {
    TAKI_MEMORY_TIDY_WRITE_THRESHOLD: "tidyWriteThreshold", TAKI_MEMORY_TIDY_MAX_STEPS: "tidyMaxSteps",
    TAKI_MEMORY_TIDY_STALE_DAYS: "tidyStaleDays", TAKI_MEMORY_TIDY_REPORT_CAP: "reportClassCap",
    TAKI_MEMORY_TIDY_BATCH_TIMEOUT_MS: "tidyBatchTimeoutMs", TAKI_MEMORY_TIDY_INPUT_TOKENS: "tidyInputTokens",
  },
} as const satisfies Record<string, Record<string, keyof MemoryConfig>>;
export type MemoryPolicyGroup = keyof typeof GROUPS;
type Environment = Record<string, string | undefined>;

export function createMemoryRuntimePolicy(env: Environment, application?: ConfigApplicationTracker) {
  let current = loadMemoryConfig({});
  const available = new Set<MemoryPolicyGroup>();
  const groupFor = (key: string): MemoryPolicyGroup | undefined =>
    (Object.keys(GROUPS) as MemoryPolicyGroup[]).find((group) => key in GROUPS[group]);
  const prepare = (group: MemoryPolicyGroup, source: Environment) => {
    const keys = Object.keys(GROUPS[group]);
    const parsed = loadMemoryConfig(Object.fromEntries(keys.map((key) => [key, source[key]])));
    return { group, parsed };
  };
  const commit = ({ group, parsed }: ReturnType<typeof prepare>) => {
    // Only the prepared group's fields advance; unrelated invalid or pending policies retain their own state.
    const patch = Object.fromEntries(Object.values(GROUPS[group]).map((field) => [field, parsed[field]]));
    current = Object.freeze({ ...current, ...patch });
    available.add(group);
  };
  for (const group of Object.keys(GROUPS) as MemoryPolicyGroup[]) {
    const keys = Object.keys(GROUPS[group]);
    try { commit(prepare(group, env)); application?.mark(keys, "applied"); }
    catch { application?.mark(keys, "unavailable", { activeValue: null,
      message: "Invalid configuration. Update this setting to enable the affected feature." }); }
  }
  return {
    groupFor, prepare, commit,
    available: (group: MemoryPolicyGroup) => available.has(group),
    keys: (group: MemoryPolicyGroup) => Object.keys(GROUPS[group]),
    // Construction only: callers must use capture(group) before policy-dependent work.
    construction: () => current,
    capture: (group: MemoryPolicyGroup): MemoryConfig => {
      if (!available.has(group)) throw new Error("MEMORY_POLICY_UNAVAILABLE");
      return current;
    },
  };
}
export type MemoryRuntimePolicy = ReturnType<typeof createMemoryRuntimePolicy>;
