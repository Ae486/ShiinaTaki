# Backlog optimization final review

Date: 2026-11-06. Scope: the follow-up described in `backlog-optimization.md` and
`budget-advisor.md`, against the original reliability PRD. The pre-follow-up
snapshot is `target/memory-tidy-backlog-preimages`. Earlier unrelated dirty work
was not reverted or included in this review's ownership.

## Result

Two concrete defects were reproduced in production composition or real Canonical
tools with isolated SQLite. The parent fixed both during review. The current
source has no remaining confirmed blocker from this bounded review. This reviewer
added only `packages/core/src/memory/tidy-shutdown.test.ts` and this document;
production changes and the other regression belong to the parent.

## Findings fixed

### Legacy shutdown omitted the new tidy cancellation path

- Files: `packages/core/src/memory/bootstrap.ts`,
  `packages/core/src/memory/tidy-shutdown.test.ts`.
- The new 600,000 ms default also applies to Legacy. Its subsystem initially still
  returned only `retention.stop`, leaving the active tidy request uncancelled when
  the real `composeMemoryRuntime().stop()` awaited the Utility queue.
- The direct Node reproduction reported
  `{ mode: "legacy", signalAborted: false, stopSettled: false }` after stop.
  Releasing the held provider was necessary to finish. The new composed regression
  initially failed for Legacy and passed for Canonical Local.
- The parent now joins `tidy.stop()` with retention shutdown and permits an async
  subsystem stop. Both composed regression cases pass: the actual model abort
  signal fires, the operation returns `unfinished` with zero edits/steps, and stop
  finishes without waiting for the default batch timeout. The held model honors
  cancellation; actual compatible-HTTP cancellation has separate producer tests.

### Departed candidates could keep an operation chasing later Block changes

- Files: `packages/core/src/memory/tidy-pass.ts`,
  `packages/core/src/memory/tidy-reliability.test.ts`.
- Initial admission had two memories with cap one. During the first batch, an
  external policy edit hid the second memory. Valid user edits changed an oversized
  user-card during each batch. The hidden memory's identity stayed in `pending`,
  while fresh Block work kept `report.hasWork` true. Four accepted batches contained
  respectively one, zero, zero and zero memories; a deliberately injected fifth
  model failure was needed to bound the reproduction.
- Reproduction output:
  `{ calls: 5, visible: ["1","0","0","0","0"], reviewed: 1,
  remaining: 0, status: "failed", reason: "execution-failed" }`.
- The parent now intersects the admitted set with fresh eligible identities at
  each dispatch and exits a continuation before model invocation when that set is
  empty. Later Block revisions stay pending for later maintenance. The regression
  now completes with one model call, preserves the originally examined Block
  revision, and returns `nextAction: "continue"` for the later Block work.
- Home now also uses that next action when choosing its continuation button, so
  zero remaining memory rows does not hide remaining Block work.

## Verified source properties

- **Finite coverage:** only the first actual dispatch creates the admitted stable
  Bank/memory identity set. Later dispatches can shrink it, never add new identities.
  Each accepted nonempty batch removes a selected admitted identity; a departed
  set, refusal, timeout or failed batch exits. Full duplicate-group evidence may
  accompany a seed, but cannot add indefinite new seeds to the admitted operation.
- **Fresh revisions:** each batch captures a new Local view. Exact examined and
  own resulting revisions are checkpointed, while an unseen external revision or
  newly arriving memory remains eligible in the next operation. Final settlement
  queries live work and preserves `continued()` where required.
- **Queue fairness and usage:** the next batch calls the existing FIFO Utility
  owner again after the prior batch settles. Already queued work can run between
  them. Each slot callback returns only that batch's usage, while operation counts
  accumulate independently. Missing failed-call usage remains unknown.
- **Meaningful initial-input target:** selection prices complete record text,
  metadata, short references, Blocks, framing, instructions and actual tool schemas
  with the project's shared estimator. Complete duplicate groups are indivisible;
  an oversized first group or fixed input produces `input-too-large` without
  checkpointing unseen evidence. Runtime composition also caps the target at half
  the configured selected Utility/main context window.
- **Limits and lifecycle:** the 48-step/600-second limits are per batch from queue
  dispatch, and the signal combines batch timeout with tidy-owned stop. Authority
  and CAS checks remain in the existing captured tools/repository. Shutdown stops
  new admission and awaits the composed owners before database close.
- **Compatibility:** Legacy still executes one bounded report, with no fabricated
  Canonical coverage. Enlarged shared defaults also affect Legacy and are now
  explicitly documented in the Canonical runtime spec. Hindsight retains its
  separate curator path. No queue framework, dependency or migration was added by
  this optimization.

## Reviewer verification

- Before the Legacy fix: `tidy-shutdown.test.ts` — one failed Legacy assertion,
  one passed Canonical case. This independently reproduced the missing signal.
- After the fix: `pnpm --filter @taki/core exec vitest run
  src/memory/tidy-shutdown.test.ts --maxWorkers=1` — **2 passed**.
- After the finite-set fix: `pnpm --filter @taki/core exec vitest run
  src/memory/tidy-reliability.test.ts -t 'drops departed backlog identities'
  --maxWorkers=1` — **1 passed, 19 skipped**.
- `pnpm exec eslint packages/core/src/memory/tidy-shutdown.test.ts` — **pass**.
- The parent owns final package typechecks, combined focused tests, full workspace
  checks, real boot and the separately authorized isolated throughput observation.
  Those are not relabeled as independently executed by this reviewer.

## Limits and remaining work

No further confirmed defect remains in this bounded source review. The initial
token target is an estimate, not a proof that every later tool transcript or model
output fits every provider. Cancellation still requires a cooperative provider.
The reviewer used no paid model and did not mutate the live database. Semantic
quality, the final throughput result and human acceptance require their separate
evidence. No release, commit, push or archive was performed.
