# C2a admitted database persistence design review

Date: 2026-10-15. Reviewer: `/root/c2_design_check`.

**PASS for implementation under the original plan and the two concrete bindings below.**
No design blocker or production change is required. Keep one fixed database child, one fixed
reader and one launcher; no additional probe, general supervisor or repeated acceptance matrix.
Root may dispatch implementation, followed by the already required exact-byte static review.
This is not a runtime acceptance result; `deploymentReady` remains false.

Reviewed [plan](c2a-database-persistence-plan.md): 26,961 bytes, SHA-256
`186f60061a4ecd7ac26443f90c079225c3bc9efb782f27227b50763ff0088e4c`.

## Findings (fixed)

None. Only this review report was added.

## Findings (not fixed)

None within the planned slice. Actual adopted-child supervision, committed-row persistence and
completion of the full stop/scan/report sequence within its deadline remain runtime criteria.

## Decisive contract checks

- Native `supervision.py:40-50` provides process-local subreaping for a non-PID1 wrapper.
  Its existing `OwnedChild.stop()` group budget is 30 seconds (`99-121`; `protocol.py:23`).
  The plan correctly requires actual descendant identities and distinct direct/adopted reaping,
  with stop, control-state collection, scan and report inside one unchanged 25-second deadline.
- `fake_consumer.py:54-99` validates fake inputs and accepts only the exact wrapper PID/startup
  running marker within five seconds. Publishing that liveness marker before separate SQL-ready
  evidence preserves the current contract. The boot-free package and existing image recipe
  support importing `enable_linux_reaping()` without production edits.
- The relay's request mutator precedes the later execute frame; its existing pause can therefore
  hold the exact inject before Host execution (`e2e/src/fixture/ws-relay.ts:116-150`).
  The capture timer limitation is resolved by Binding 1.
- Core's repeated initial key observes the original Run, and explicit resume admits a new
  startup only for the new waiting Native identity (`hindsight-deployment-owner.ts:39-92`).
  Host observation and consumed-start/inject fences preserve the original resource
  (`apps/hindsight-host/src/deployment-owner.ts:53-64,98-134`). The plan retains those paths.
- The reviewed first-start evidence establishes the exact PostgreSQL 18.1 tools, effective
  durability settings, detached postmaster behavior and checked raw shutdown. Its archive hash
  was independently matched: `82ba7698993d50f1295c8a7aa322044b6501f7cda16d102ed6cc1ead5aa09f26`.
  The later direct foreground launch and logged-row restart proof are correctly separate.

## Concrete implementation bindings

1. **Bound the held execute after capture.** `pauseNextExecute(timeoutMs)` clears its timer when
   it captures the frame (`ws-relay.ts:90-97,138-140`); that timer does not bound the hold.
   Apply the plan's separate ten-second deadline from capture through identity/no-DB verification
   and release. Forward the unchanged original frame once only after success. On mismatch,
   timeout or failed verification, fail and close the relay rather than forwarding late.
   Keep the existing authority deadline and do not persist the authorization/frame.
2. **Freeze first-stop evidence before resume.** The fixed reader must preserve the original
   UTF-8 `last-stop.json` bytes, not merely derived booleans. Save them and their SHA-256 as
   `S/first-stop.json` before invoking the second `resumeStartup`. Bind T, first startup and
   cluster and require the checked-stop/reap/complete-scan result first. The second generation
   may replace the in-volume report only after that preservation. Retain the plan's separate
   final-stop copy and Root scan of its actual bytes.

Add one small synthetic-file check of the actual streaming helper: no match, a whole-chunk match,
a match split across a chunk boundary, and no double count when overlap repeats a completed match.
This targets the new 73-byte-pattern/72-byte-overlap algorithm. It requires no Docker, database
startup, general test harness or broad suite. Root accepted these bindings and this limited check.

## Verification

- Plan bytes/hash and prerequisite archive SHA-256: matched.
- Relevant Native, relay, Core and Host source paths: read directly; unchanged contracts reused.
- Lint / TypeCheck / Tests: not run for this design-only assignment. Implementation retains its
  scoped Python/TypeScript checks plus the small scanner check above; accepted gates are not rerun.
- No Docker, target runtime, build, real data/key/model, production/spec/template or task-metadata
  operation was performed. Only this Markdown report was written.

Ownership is released to Root. No further design decision or user confirmation is required
before the scoped implementation.

