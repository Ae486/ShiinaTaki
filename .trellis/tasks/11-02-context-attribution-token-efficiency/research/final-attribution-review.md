# Final attribution implementation review

Reviewed on 2026-11-02 in `H:/TakiAgent-worktrees/t4`, branch `task/t4-skills-mcp-productization`.
Authority: the original owner requirements in `prd.md`, the approved observation slice in `design.md`,
the execution handoff, and the curated backend/frontend contracts in `check.jsonl`.
The stale global `.current-task` does not replace the parent's explicitly resolved active task.

The reviewer owned this report only. Production fixes below were coordinated with their existing runtime/root
owners; existing native-image work and other contributors' changes were preserved. No paid models, live user
services/data, commits, pushes, or task archive operations were used by this review.

## Findings (fixed)

### 1. Construction metadata was lost through real production wrappers

- Files: `packages/core/src/memory/memory-engine.ts`, `packages/core/src/memory/runtime-composition.ts`,
  the canonical Memory capture/fence wrappers, `packages/core/src/harness/run-snapshot-capture.ts`,
  `packages/core/src/main.ts`, and `packages/core/src/agents/request-composition.ts`.
- Issue: the first actual Core/WS fixture exposed 7,250 unknown units in a request estimated at 18,855 units.
  Memory/persona assembly and tool-descriptor wrapping discarded sidecars even though their construction owners
  were known. Ordinary application conversation/media was also treated as an unknown supplier.
- Fix: forward the exact synchronous assembly descriptor through existing facades; preserve captured instruction
  and tool origin metadata when sealing execution context; mark explicitly Core-owned compatibility definitions
  at their factory; retain ordinary application conversation ownership. Do not infer Skill execution ownership
  from activation, or change the model-facing strings to carry attribution.
- Evidence: the later actual Core fixture retains the same 18,855 estimated units, now identifies 2,996 persona
  units, and has zero unknown-origin units. Media precision remains separately explicit. Compare
  `monitor-runtime-ui-evidence/2026-11-02T08-20-22.999Z/evidence.json` with
  `monitor-runtime-ui-evidence/2026-11-02T08-29-53.380Z/evidence.json`.

### 2. Reused historical tool identifiers could overwrite another occurrence's supplier

- Files: `packages/core/src/agents/request-composition.ts`,
  `packages/core/src/agents/tool-content-attribution.ts`, and `packages/core/src/agents/agent-attempt.ts`.
- Issue: a last-write map keyed only by `(toolCallId, toolName)` assigned the last origin to every occurrence.
  Selected history can contain the same provider-generated identifier in separate Turns; `extension_call`
  can supply MCP or Skill content under that same name. This mislabels earlier content without changing its text.
- Fix: preserve ordered origins for each occurrence at the projection boundary. SDK clone recovery keeps only
  an Attempt-local origin map, seeded from selected history; conflicting keys remain unknown. Child segment
  rollover clears and primes the mapping again. No raw tool content or process-wide history registry is added.
- Evidence: `tool-content-attribution.test.ts` covers different origins under a reused pair and conflict/reset
  behavior. The installed-SDK wire test covers three physical Effects, changed active schemas, retained Timeline
  origin, Skill result versus enabled Core tool supplier, and equal provider request bodies with/without capture.

### 3. The attributed instruction join omitted existing non-child inbox guidance

- File: `packages/core/src/agents/agent-attempt.ts`.
- Issue: the original ordinary-work branch joined both `runContext.instructions` and `work.instructions`.
  The attributed rewrite retained only the former outside the child branch, dropping required private inbox
  guidance. The root reviewer reproduced this through the existing inbox-yield suite.
- Fix: restore `work.instructions` in its original order as an explicit instruction fragment in the non-child
  join. This preserves the original request semantics while adding only attribution sidecars.
- Evidence: final source includes both fragments. The parent reports the focused inbox-yield suite now passes
  all 17 tests. This reviewer did not duplicate that diagnosis or broad suite.

## Findings (not fixed)

The failures retained at the reviewer's initial handoff are now resolved. The original Work instruction join was
restored, source forwarding and occurrence handling were corrected, and the ownership test now also asserts the
new exact Effect context. All affected domains passed the 77-test regression, then the final stable full Core suite
passed 4,556 tests with six skipped. Final workspace typecheck and active-source ESLint passed. The root lint
command still includes the unrelated pre-existing artifact max-lines violation, which was preserved and reported.
No remaining confirmed code defect blocks this observation slice. These final gate updates were supplied by root;
they do not turn the reviewer's earlier pending results into earlier passes.
Native Tauri interaction and owner acceptance remain unverified here. Broader token-reduction experiments and
equivalent-task cost/quality measurement remain later parent work, as authorized for this observation slice.

## Verified boundaries

- The outer model middleware commits an Effect and binds it through the existing model-usage AsyncLocalStorage.
  The native middleware filters retired/expired images before the attribution observer reads the final envelope.
  Each physical dispatch gets its own Effect. Optional measurement/storage failure cannot retry or fail a valid
  provider operation. Counts, identity and window facts enter the existing event ledger; usage stays in `run_usage`.
- Final prepared schemas reflect each step's active tools. Source comes from construction metadata and actual
  selected execution output. Tool images keep tool ownership even under user transport. Timeline sanitization,
  private replay, and reduction preserve machine-only origin without sending it as model content.
- Duplicate text with conflicting descriptors is explicitly `other/unknown`, not another occurrence's category.
  The current duplicate-text regression passes. Concurrent intermediate reads are not counted as another finding.
- Nine exclusive raw categories and their four-origin rows conserve the common heuristic estimate. Display groups
  sum raw units before ratios, so future grouping does not require changing stored categories. Known framing can
  be `other/builtin`. Reported provider input is never scaled into invented exact component tokens.
- Reported occupancy divides input by the captured effective real-token window. Estimate-only occupancy uses the
  captured estimator window. Missing input, reported zero, absent measurement, unknown origin and heuristic media
  remain distinguishable. Images remain in their enclosing category; there is no image meter or added model call.
- The durable latest-primary projection selects the newest terminal primary source, then model intent order;
  late background completion and summary publication cannot replace that request. A new failed or unmeasured
  terminal request does not expose an older success as current. Usage is joined once by Effect; file reopen
  reproduces the snapshot. Bounded source scans and indexed exact-Run lookups expose exhaustion explicitly.
- Existing all-request cache arithmetic and reset authority remain unchanged. Both initial subscription and explicit
  flush carry the independent latest-primary sibling. Terminal model settlement refreshes missing-usage cases.
  Monitor retains mode, physical-client generation, visibility, revision and reconnect fences, without polling.
- The renderer WeakMap keeps one latest result per live renderer closure, replaced by each synchronous render;
  the consumer checks the exact rendered string. No unbounded-history retention or cross-request misassociation
  was established. It is not treated as a defect or used to justify a new provenance framework.

## Verification

- Reviewer-run: `pnpm exec vitest run src/db/request-attribution-repo.test.ts src/agents/request-attribution-observer.test.ts`
  from `packages/core`: **2 files / 14 tests passed** at 16:24 local time.
- Reviewer-run after the source update: `pnpm exec vitest run src/agents/request-composition.test.ts`
  from `packages/core`: **1 file / 4 tests passed** at 16:29 local time.
- Runtime-owned installed-SDK/native/disclosure/replay checks and root-owned comprehensive gates remain separate
  evidence. Broad tests were intentionally not duplicated while the parent was already running them.
- **Final root gates:** all-package `pnpm typecheck` passed; active-source ESLint passed; stable Core 4,556,
  Shared 710, Desktop 1,356 and CLI 50 tests passed, with six Core skips. Final Desktop build passed. The root
  artifact-only lint exception remains explicit in `execution-progress.md`; no blanket rule was disabled.
- The inspected actual Core/real WS/browser artifact records three synthetic-provider requests, zero paid calls,
  no live-data writes, successful re-entry/disconnect/reconnect, and no overflow in its recorded wide/narrow views.
  Loading, zero, estimate-only and unavailable display cases are explicitly marked controlled fixtures.
  `browserIsTauriAcceptance` is false; these results do not establish native manual acceptance or model quality.

The original observation slice is wired and automatically verified with the reviewed fixes: Monitor combines cache
rate, latest-request occupancy and source-aware composition using existing runtime producers. This review does not claim reduced real
cost, complete historical provenance, a provider hard-window guarantee, or completion of the whole optimization PRD.
