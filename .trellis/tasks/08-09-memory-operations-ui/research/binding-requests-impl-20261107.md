## 1. Outcome — done

P1-O is implemented. Expected requests per Bank, verified by deterministic transport-call assertions:

| Memories | Label requests | Own-body GETs | Total requests |
|---|---:|---:|---:|
| 8 | 1 | 0 | **33**, previously 56 |
| 20 (`8+8+4`) | 3 | 0 | **87**, previously 144 |

Receipt-proof downloads remain. Counts assume single-part bodies and exclude initial catch-up, the separate Source association and retries. [source packages/core/src/memory/hindsight/hindsight-template-binding.test.ts:287]

## 2. Changes

- Candidates expose verified label contexts; packing requests evidence once. `Lookahead` and `SpillLabel` were removed. Prepared-job recovery still precedes new labels. [source packages/core/src/memory/hindsight/hindsight-application-binding-collector.ts:36] [source packages/core/src/memory/hindsight/hindsight-application-binding-runner.ts:31]
- Label validation isolates invalid IDs and individual proofs while retaining all existing checks and the selection recheck. The client also isolates malformed proof rows without weakening envelope validation. [source packages/core/src/memory/hindsight/hindsight-template-label-evidence.ts:28] [source packages/core/src/memory/hindsight/hindsight-template-client.ts:37]
- `cachedBody` previously read only replica bodies; prepared bytes live in the durable command-body table. It now consults that table on a miss, requiring an exact namespace/ref match. [source packages/core/src/db/hindsight-application-replica-cache.ts:13] [source packages/core/src/db/hindsight-application-command-storage.ts:65]
- Updated four colocated test files, affected headers, both folder indexes and the runtime spec. The complete **12-file inventory with line references** is in the report.

[Full report](G:/taki-codex-work/tmp-o/p1-o-20261107/report.md) · [Exact delta against inherited files](G:/taki-codex-work/tmp-o/p1-o-20261107/agent-delta.patch)

## 3. Evidence and checks

All required commands used `TEMP/TMP=G:/taki-codex-work/tmp-o`.

- Required Vitest filters, `--pool=threads --maxWorkers=2`: **344 tests passed across 14 files**. [run artifact G:/taki-codex-work/tmp-o/p1-o-20261107/vitest-green.log]
- Core typecheck: **passed**. [run artifact G:/taki-codex-work/tmp-o/p1-o-20261107/typecheck-green.log]
- Scoped ESLint: **passed**. [run artifact G:/taki-codex-work/tmp-o/p1-o-20261107/eslint-green.log]
- Assigned-file `git diff --check`, direct whitespace inspection and patch reverse-application dry run: **passed**. [run artifact G:/taki-codex-work/tmp-o/p1-o-20261107/patch-check.log]

Coverage includes sibling isolation, selection drift, unsupported endpoints, SQLite reopen of prepared/completed jobs, original-body recovery, ref-mismatch downloads and commit-before-pull publication. Earlier failed checks and their corrected test-fixture causes remain documented in the report.

## 4. Trade-offs

- Removing spill state may repeat one evidence request at a rare byte boundary.
- A transport failure affects the whole batch; unsupported endpoints retain existing neutral-policy behavior.
- Replica misses incur an additional indexed outbox lookup. Byte/hash verification remains; no new cache store was added. [source .trellis/spec/backend/hindsight-application-runtime.md:98] [source .trellis/spec/backend/hindsight-application-runtime.md:117]

## 5. Open items / UNKNOWN

No assigned implementation or required check remains open. **UNKNOWN:** actual Native latency savings and completion within 60 seconds; journeys remain leader-owned.

No Core/Native/PG services were started. Verification used SQLite and deterministic transport substitutes.

## 6. Outside scope

No additional defect was established or fixed. The delta excludes Native, scheduling/deadlines, transition loaders, recall hydration, prompts/templates and leader-owned records. No original application data, credentials, Git mutations or task lifecycle operations were involved. [run artifact G:/taki-codex-work/tmp-o/p1-o-20261107/changed-files.json]