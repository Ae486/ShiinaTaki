# B3 Core resumed diagnosis

This continuation owns Core/Shared source, Core joint fixture/entry and Core backup/Healthy acceptance only.
The root owns all check scheduling and cross-source freezes. No Stage 5C, original service/data, credentials,
model provider, dependency or Git/task lifecycle action is authorized.

## Recovered state

- Taki remains on main at `2e244d0fdee49fb2c582a4333a9ef1573fa9112a`; existing dirty work is preserved.
- Original root session: `01a12aa6-e8fc-72d3-a76a-03f2194d2752`. Original Core child:
  `01a12aaf-e826-7d62-8b56-09a5a568ba97` (`/root/b3_core_complete`). Accessible messages and retained
  artifacts establish the same unfinished REENTRY fixture boundary. Encrypted communication is not decoded.
- `b3-core-resume-smoke-02` passed three actual backup consumer positives (unselected/selected/removed).
  Both Healthy cases passed RETURN then failed REENTRY at candidate proof verification.
- `b3-native-joint-03` failed both scenarios in Core `copiedRefresh`, before pair capture/restore acceptance:
  the request did not claim the expected terminal semantic refresh marker. Native is diagnosing its real
  inline refresh failure independently; Core must not fabricate a marker or weaken the assertion.

## Ranked falsifiable hypotheses

1. `transitionFinalFixture` rebuilds ordinary auxiliary rows via `evidenceFromBundle`, losing the independent
   template receipt/result maps included in the initial RETURN fixture. Prediction: original REENTRY fails
   requested receipt membership before projection/current-target comparisons.
2. The synthetic observer cursor is pinned to initial evidence rather than post-delta state. Prediction:
   after complete auxiliary reconstruction, a higher final cursor must be reflected by the independent observer.
3. Joint refresh has no terminal semantic result when Core performs rollout readback. The initial scheduling
   hypothesis is superseded by Native source evidence that SyncTaskBackend awaits execution and the handler
   may have failed before completion; await the real exception/result probe rather than repeat the test.

## Bounded diagnostic evidence

`b3-core-resume-healthy-diagnostic-01` runs only the existing `removed=false` positive with one worker.
Exit 1, 51.238 seconds, one failed / 25 skipped, 1599 recorded inputs unchanged, empty owned TEMP removed.
The temporary test-only `[DEBUG-b3-reentry]` catch rethrows the original exception without changing settlement.
Its stack proves hypothesis 1's exact boundary:

`prepareHealthyTransitionCandidate -> associateTransitionTemplateEvidence -> sealTransitionNativeEvidence ->
verifyTransitionTemplateAssociation -> readTransitionTemplateAuxiliary -> verifyMembership`.

The failing comparison is `found.size !== wanted.size` at `transition-template-auxiliary.ts:54`.
Production refused the incomplete synthetic evidence correctly. After root releases the Native diagnostic
freeze, extend only the specialized Healthy transport fixture to carry independently held template auxiliary
rows into its post-delta W2 proof; keep the original proof domains, production membership and final W9 guards.
Remove the temporary probe before subsequent acceptance. New run suffixes preserve every earlier failure.

## Implemented bounded correction

`memory-transition-template-healthy-fixture.ts` now decorates its existing synthetic delta call. Before Native
proof observation, it reconstructs auxiliary template rows from the separately held Native maps using the
existing `withTemplateAuxiliary`, reseals through the original hash domains and updates the observer's cursor
to that actual post-delta fixture cursor. The ordinary delta transport and all production validators are
unchanged. Previously persisted Core evidence is never rewritten. The temporary test probe was removed.

The Native owner's actual inline refresh probe separately confirmed that four evidence-free `done` attempts
correctly reach real reflect's final text synthesis, which the joint fake provider incorrectly rejected.
The fake's failure produced a truthful failed/null result; Core's receipt-membership behavior was correct.
Native owns that deterministic final-synthesis fixture correction and its independent joint verification.

`b3-core-resume-healthy-positive-02` then completed with exit 1 in 119.912 seconds: the selected positive
passed the complete RETURN/REENTRY journey in 46.576 seconds; the removed positive hit its 60-second
test envelope at 60.568 seconds. It no longer reported the original membership failure, but timeout is
not completion evidence. One passed / one failed / 24 skipped, 1599 inputs unchanged, empty TEMP removed.
Core remains frozen for the independent Native joint run. No production lease/deadline or test budget was
changed. A separate phase-timed removed-case diagnostic is proposed before claiming its remaining behavior.

`b3-core-removed-phase-diagnostic-01` subsequently passed the original complete removed positive: exit 0,
133.700 seconds total, one passed / 25 skipped, 1599 inputs unchanged and empty TEMP removed. Monotonic
phase measurements were setup 3.373 seconds, RETURN 52.662, REENTRY 66.376 and close 0.012, totaling 122.423.
The diagnostic temporarily removed the test's explicit 60-second argument so the recorded CLI 180-second
measurement budget could apply. Original and instrumented source bytes are retained in separate text artifacts.

Root approved a measured 180-second local budget only for the removed positive and removed REENTRY cases
which first execute RETURN. Selected cases and individual removed RETURN cases remain 60 seconds. All 26
names and assertion bodies are preserved using parameter-row registration without duplicated test bodies.
Temporary diagnostics are removed; the healthy-driver spec records the evidence and unchanged production limits.

## Outstanding acceptance

Final-source Healthy positives and the complete selected/removed final-readback and W9 matrix, real consumer refusal tests,
D91 stopped-writer traps, 256/257 backup versus 1024/1025 Healthy admission, adjacent preserved regressions,
types/lint and independent review remain pending. Native joint physical restore remains separate evidence.
