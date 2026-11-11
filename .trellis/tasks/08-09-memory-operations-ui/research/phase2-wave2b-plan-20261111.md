# Phase 2 wave 2b - Home review visibility and publication convergence

## Authority and baseline

The owner approved proceeding with wave 2b on 2026-11-11 after the resource check.
Continue the existing task in `H:/TakiAgent`, branch `main`, HEAD `ba5be72`.
The inherited baseline contains 99 dirty paths (74 tracked and 25 untracked).
Preserve those changes. No commit, push, archive, original-data operation, credential
access or deployment is authorized by this increment.

The current schedule is `phase-plan-20261107.md`, with the later wave-1 and wave-2a
delivery records superseding the earlier worker proposal. No worker isolation has
been implemented. Wave 2a's idle-review replay does not prove concurrent usability.

## Requirements and boundaries

1. Show Core-produced policy-review state, remaining count, saved results awaiting
   publication, last completion and catch-up information in the existing Home memory
   authority surface. Missing information remains unknown, and zero is only a real
   producer value. Preserve ordinary sync, lifecycle and backup controls.
2. Keep the existing UI components and styling. Major visual design is phase 3.
   Review settings must use the existing configuration surface; first verify whether
   the four registered live knobs already render there.
3. Diagnose D105 before choosing a patch: distinguish actual immutable-body repeat
   downloads from new descriptors, and trace publication receipt to verified local
   application. Reuse the existing cache, writer, lease and complete event chain.
   Never publish an isolated artifact or advance a cursor from a receipt alone.
4. Preserve the phase-2a schedule/resume semantics. Add bounded deterministic or
   browser evidence now; real concurrent-review and provider-crash evidence remains
   required and must not be replaced by an idle-review replay.

## Execution and ownership

The owner reaffirmed on 2026-11-11 that performance and code complexity are part
of every delivery step. Reuse the recorded wave-1 and wave-2a findings and their
verified boundaries. Do not add redundant queries, decoding, hashing or validation
to per-item or frequent paths. A new check needs a demonstrated reachable gap,
an identified owner and an explicit execution cost; an existing guarantee must
not be re-proved in every downstream layer. Fixes should remove repeated work
and unnecessary abstractions where the same responsibility already exists.

Continuation session `01a1c958-fb20-7703-beca-49092263d594` recovered the original
session `01a1c942-a014-7da3-9978-a85006d6e931` and bound this existing task. The
inherited Home worker completed its slice after the original parent was interrupted;
reuse `phase2-wave2b-home-20261111.md` rather than dispatching that slice again.

The owner's later stop instruction limits this session to the current small stage:
Home review visibility, its Core invalidation producer and the already implemented
D105 receipt-target correction. Finish their necessary checks and records, then
stop. Do not continue the remaining wave-2 work or start a complete service replay.

- Leader: task binding, this plan, dispatch, evidence review, consolidated reporting.
- UI implementer: Home presentation/controllers and colocated tests/indexes; no
  Core/Shared edits without returning a concrete producer gap to the leader.
- D105 advisor: read-only analysis of the current publication/cache chain, a minimal
  evidence plan and implementation recommendation. No production mutation.
- At most two agents concurrently. Tests and runtime checks are serialized; one
  worker with a 1.5 GiB heap cap for test runs. Start no Core/Native/PostgreSQL stack
  while the available-memory snapshot is only about 4.5 GiB. Recheck before heavy
  validation; target about 6 GiB of available physical memory for one stack.
- Protect `template-lifecycle/**`, `base-prompt.ts`, `retain-tool.ts`, `prompt/**`
  and prompt text owners. No new dependencies or upstream model changes.

## Validation and delivery

- List important failure cases before implementation. Cover unknown versus idle,
  pending/running/paused/error, real zero counts, saved-awaiting-publication, old
  producers, stale/disconnected reads and catch-up visibility after reopen/reconnect.
- Use the existing controller generation and WS invalidation mechanism; no polling
  or authoritative frontend storage. Exercise actual browser rendering using a
  controlled provider where practical, keeping manual UX acceptance separate.
- Run affected Desktop/Shared/Core checks serially, then one consolidated review of
  the complete increment. Existing full-Core failures remain separately reported.
- D105 acceptance needs diagnostic evidence and exact publication/cursor integrity;
  no speculative new cache or unmeasured speedup claim.
- Update existing specs and the phase log with actual outcomes and remaining gates.

## Recovered evidence

The backup rerun prepared before interruption did run on 2026-11-10 at
23:39-23:42 Asia/Shanghai. `G:/taki-post-reentry-DUunfJ/replay-result.json` reports
PASS, backup 14,524 ms on the first attempt, successful verification and clean
teardown. Its captured source object equals replay 10's
`G:/taki-post-reentry-Wjro0M/replay-result.json` (13,970 ms backup).
The repeat confirms the observed duration; the capture-cost cause remains unknown.
The prior phase log ends before this rerun. This is recovered evidence, not a new
run or a claim that the slowdown was fixed.

## Completed small stage and owner-requested stop

The current small stage is complete and independently reviewed on 2026-11-11:

- [Home review visibility](phase2-wave2b-home-20261111.md): 57 Desktop tests,
  Desktop typecheck/scoped lint and 13 controlled Chromium scenarios passed.
- [Core invalidation producer](phase2-wave2b-notifications-20261111.md): the
  original 33-test group and final 16-test schedule suite passed, including actual
  registered loopback WebSocket reads, two clients and reconnect. Native/model
  dependencies in this test are controlled. These suite counts overlap.
- [D105 receipt convergence](phase2-wave2b-d105-20261111.md): 67 unique tests in
  six files passed; three adjusted return-boundary cases passed a focused rerun.
  Final combined Core typecheck and scoped lint passed after all code/test edits.
- Independent read-only `trellis-check` found no confirmed stage blocker. It
  checked final source, specifications and existing evidence without rerunning
  tests. Existing guards and full-page/exact-history proof remain in place.

Notification cost is an optional callback/fanout after successful persistence;
no status query, decode, hash or new validation is added to that producer. Some
unchanged-looking schedule saves still send best-effort hints; Home coalesces
reads and reconnects by rereading current Core state. D105 adds one target-identity
comparison and a cursor-pair comparison at page boundaries. Recovery already
applied locally avoids dispatch/refresh; an unapplied completed job can pay its
unsuccessful early proof and the required final proof. Complete-page overpull
(up to 128 manifests), large events and earlier Bank queues remain possible.
Unrelated binding stays with ordinary maintenance. No new live speedup is claimed.

Stop here per the owner. Real Native/model concurrent-use timing, provider-process
crash recovery, installed-build and owner/manual acceptance remain unperformed.
The last memory snapshot had about 3.8 GiB available, below the recorded full-stack
target. The remaining wave-2 work and parent acceptance are open. No further
implementation/test runner is scheduled, and no commit, push, finish or archive
was performed.
