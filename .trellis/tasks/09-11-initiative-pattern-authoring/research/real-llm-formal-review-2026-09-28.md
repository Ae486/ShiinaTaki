# C3 real-model acceptance extension — formal review

Date: 2026-09-28. Worktree: `H:/TakiAgent-worktrees/t4`; branch: `task/t4-skills-mcp-productization`.
This extends `formal-review-2026-09-28.md` and does not replace its C3/manual boundaries.

## Assignment and source set

The owner approved real-model acceptance after the earlier C3 gate. Reviewed the active child PRD/check context,
`size-rule-alignment-2026-09-28.md`, `real-llm-timezone-fix-2026-09-28.md`, current time/runtime/tool/E2E specifications,
the production changes, actual real-test assertions and the isolated provider relay.

Production remained frozen during the running real-model batch. The reviewer reported findings first and received
ownership only of the test observer, its local regressions, fixture index, E2E harness specification and this report.
The root retained production/schema/main, real-test scenario teardown, context marker assertions and real API calls.
No reviewer real-provider call, full package suite, commit, push or archive occurred. The stale global Avatar Lab
pointer remained untouched; the existing native C3 binding and explicit assignment remained authoritative.

## Findings (fixed)

### R1 — Provider error diagnostics retained raw content and did not bound buffering

- File: `e2e/src/fixture/real-provider-observer.ts`.
- Original issue: a non-2xx response was fully materialized with `upstream.text()` and copied into evidence after
  replacing only the exact API-key string. This could retain echoed request content or other sensitive error text,
  contrary to the observer's non-content contract. Successful streaming ignored downstream backpressure. Closing
  the observer did not explicitly await every forwarding operation or provide an idempotent close promise.
- Fix: forward successful and error response bodies through the same unchanged streaming path; wait for downstream
  `drain`. Retain at most an 8 KiB ephemeral error prefix and publish only the HTTP status, closed failure reason,
  allow-listed provider code/type and `schemaObjectRootRejected` boolean. No provider message/body enters diagnostics.
  Request bodies remain capped at 2,000,000 bytes; tool diagnostics are bounded and select schema-shape keys only.
- Cancellation: total request deadline, downstream close and observer close abort the upstream request. Partial
  uploads are destroyed on abort. Observer close stops its server, closes downstream sockets, awaits forwarding
  operations and returns the same promise on repetition. A partial real response fails as an incomplete stream;
  synthetic JSON is never appended to already forwarded provider bytes.
- Local regression: exact request/UTF-8 stream/error bytes, supplied credential routing without diagnostic retention,
  unknown provider-code exclusion, a large error body, transport failure before headers, interrupted successful
  streaming, upstream cancellation on close/client abort, idempotent close and a 64 MiB paused-client backpressure case.

### R2 — A cleanup failure could prevent the remaining real-scenario teardown

- File: `e2e/src/initiative-pattern-real.e2e.test.ts`; fixed by the root after the review finding.
- Original issue: sequential calls in `finally` could throw before later process/observer cleanup, evidence writing
  and temporary-directory removal. A later diagnostic failure could also mask the original assertion failure.
- Fix verified in source: `finalizeScenario` invokes independent socket/process/observer cleanup through
  `Promise.allSettled`, then independently attempts evidence writing and verified-path fixture removal. It preserves
  an original scenario failure and fails a previously successful scenario if cleanup or required evidence fails.
- This is source verification of the changed teardown; the final real batch remains root-owned.

### R3 — The named selected-context test did not observe the outgoing selected context

- Files: the observer and `initiative-pattern-real.e2e.test.ts`; the root owns the real-test assertion changes.
- Original issue: completed Run, valid structural decision and positive model count did not establish that Character
  Memory was included or primary relationship history was excluded from the actual outgoing model request.
- Fix: optional `probeMarkers` inspect outgoing message bodies and retain only `selectedMemoryPresent` and
  `primaryHistoryPresent` booleans. The real suite requires observed heartbeat requests and checks every one.
- Review caught a false-positive marker: `赤隼计划` also appeared in a Pattern purpose, so it could not uniquely prove
  Block inclusion. The root replaced it with `CHARACTER_MEMORY_C3_REAL_ONLY`, present only in the seeded Character
  Block. `PRIMARY_HISTORY_C3_REAL_ONLY` independently marks only the seeded primary history. Verified both bindings
  and assertions in the final source. The root's final real batch exercises the new observation assertions.

## Production/source review conclusions

- **Decision schema:** `HeartbeatDecisionToolInputSchema` is a strict object root with every nullable field required.
  Outcome-specific validation rejects missing/inconsistent fields before normalization into the unchanged strict
  `HeartbeatDecisionSchema` domain union. Candidate membership, allowed-outcome, captured Avatar vocabulary,
  currentness, duplicate/conflict latching and structural-stop checks remain effective. No persisted union or old
  decision/event storage was rewritten to satisfy the provider.
- **Timezone:** ordinary ChatAgent attempts capture one instant and the same User Timezone before awaited recall.
  Stable day and volatile time use that captured zone; the next attempt reads current authority. Selected initiative
  context retains its existing immutable path. `get_current_time` reads the live authority once per invocation,
  preserves one ISO/epoch/capturedAt instant and reports failure rather than using the host if the supplied authority
  throws. Main's earlier static-tool construction closes lazily over the later initialized service; it does not read
  the service during construction. No primary cancellation or scheduling authority was added.
- **Authoring guidance:** stronger tool/Skill descriptions require an actual saved candidate before claiming a card
  exists and require returned timestamps before relative-date claims. Core remains authoritative if the Skill is
  absent or changed. Exact source/CAS/confirmation and permission guards were not relaxed to improve model pass rates.
- **Real tests:** calls use the real configured provider through unmodified production Core. Assertions read actual
  tool invocation parts, Pattern revisions/lifecycle, exact UTC scheduling, Run/delivery/Monitor state and the new
  outgoing context booleans. No successful response substitution exists in the observer. Native Avatar completion
  remains scripted protocol evidence, not proof that a real renderer applied an expression.
- **Opt-in:** the new suite requires credentials plus `TAKI_E2E_REAL_INITIATIVE=1`. With the flag explicitly zero,
  actual test collection skipped all eight cases. Existing older L2 tests retain their separate original key gates.
- **Seeds:** optional Canonical Block fixtures use existing repositories before Core starts and pass values as Node
  argument data, not interpolated shell source. They do not write a live real-user database or forge selected context.
- **Size policy:** exact test/spec extension/tree matches disable only the two line-count rules. Other type/naming/
  parameter rules and ordinary production defaults remain. The existing Shared entry's numeric/AST restrictions
  are retained; no production code was moved into a test tree by this extension.

## Semantic evidence and limits

The reviewer read the saved round-2 clarification and heartbeat artifacts under
`validation/real-llm-round2-2026-09-28/`. Both clarification replies deny direct stress/fatigue detection and ask the
user to select supported observations/thresholds; neither artifact records a Pattern/Schedule creation. The first
heartbeat has a valid silent decision. The second speaks about the seeded index-completed/upcoming-demo facts and
stages `smile`. These are concrete samples, not a guarantee that every future model reply is correct.

The clarification test's hard assertions are only no Pattern, no Schedule and a nonempty reply. Semantic clarification
acceptance therefore requires reading the actual reply, as performed for round 2; those assertions alone do not
prove useful clarification or absence of every prose claim. Final real reruns and their updated artifacts are the
root's evidence source, especially for the newly added outgoing-context checks.

## Verification executed by the reviewer

| Command | Result |
| --- | --- |
| `pnpm --filter @taki/core exec vitest run src/agents/chat-agent-time.test.ts src/time/current-time-tool.test.ts src/agents/heartbeat-respond-tool.test.ts src/initiative/manage-pattern-tool.test.ts src/initiative/authoring-skill.test.ts --maxWorkers=1` | Passed: 5 files, 34 tests. |
| `pnpm --filter @taki/e2e exec vitest run src/fixture/real-provider-observer.e2e.test.ts --maxWorkers=1` | Final run passed: 9 local-HTTP tests; no paid endpoint used. |
| `TAKI_E2E_REAL_INITIATIVE=0` followed by `pnpm --filter @taki/e2e exec vitest run src/initiative-pattern-real.e2e.test.ts --maxWorkers=1` in an isolated PowerShell command environment | Exit 0: all 8 real-model cases skipped, no calls. |
| `pnpm --filter @taki/shared typecheck` | Passed. |
| `pnpm --filter @taki/core typecheck` | Passed. |
| `pnpm --filter @taki/e2e typecheck` | Passed, including final observer/test changes. |

Final scoped lint passed:

```text
pnpm exec eslint e2e/src/fixture/real-provider-observer.ts e2e/src/fixture/real-provider-observer.e2e.test.ts e2e/src/initiative-pattern-real.e2e.test.ts packages/core/src/agents/chat-agent.ts packages/core/src/time/current-time-tool.ts packages/shared/src/initiative-schema.ts packages/core/src/agents/heartbeat-respond-tool.ts packages/core/src/initiative/manage-pattern-tool.ts
```

The fixture index and E2E harness specification were synchronized with bounded diagnostics, unchanged streaming,
independent cleanup, unique context markers and the semantic-review boundary. Root owns the final production wire
schema specification, combined source inventory, full-package/process gates and complete real acceptance report.

## Findings (not fixed)

No unresolved source defect from this scoped review remains after R1-R3. Final real-model execution with the revised
observer/unique context assertions was running when this report was written, so this report does not mark it passed.
The root must attach its outcome, combined full-package and deterministic process results. Native trusted input,
OS IME, human visual/interaction acceptance and owner AC confirmation retain their earlier explicit pending status.

## Root execution addendum

The final strengthened real batch subsequently passed 8/8 in 119.29 seconds. Every final heartbeat request includes
the unique Character Memory marker and excludes the unique primary-history marker. Root read all final replies and
recorded residual prose limitations rather than treating structural passes as flawless language quality. The combined
20 production-process and 9 local HTTP regressions also passed. Final full-package results and usage accounting are
owned by [the consolidated real-model report](real-llm-acceptance-2026-09-28.md).
