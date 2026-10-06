# Read-only W5 RETURN evidence progress inspection

Observed 2026-10-03 14:45-14:58 UTC while the parent's real test remained running unchanged.
No production/test/helper/spec changes, no new service/test/model execution, and no PG connection were made.
SQLite was opened briefly using URI `mode=ro`; only counts and sanitized proof metadata were printed.

## Current work and exact finite pagination

`transition-healthy-candidate.ts:28-42` handles Banks serially: fence -> verify (reuse a sealed proof) ->
complete evidence download/persistence, then the next Bank. Character proof is already proven; Global remains fenced.
`transition-native-session.ts:65-69` returns an existing proof without another model verification dispatch.

Latest persisted Character observation supplies this exact evidence inventory:

| Portion | Pages | Records |
| --- | ---: | ---: |
| Native snapshot | 1,559 | 1,559 (page size 1) |
| Application descriptor snapshot | 8 | 3,661 |
| Maintenance evidence | 767 | 98,150 |
| Auxiliary native evidence | 282 | Not counted in this read |

`transition-native-loader.ts:24-43` reads native pages, application pages, body closure, maintenance pages,
then auxiliary pages in that order. The native one-record page size originates at
`H:/hindsight/hindsight-api-slim/hindsight_api/engine/cutover_verification_runner.py:406`.
After the body phase there are exactly **1,049** maintenance/auxiliary page requests, before local validation/storage.

Excluding control requests and lower-level HTTP retries, the complete Character evidence request count is
**2,616 + B + sum(total_parts for the B unique reachable bodies)**.
The manifests fix the 2,616 page requests; downloaded immutable body descriptors fix their own finite part counts.

## Body reads are deduplicated within this invocation

`hindsight-application-bundle-loader.ts:83-114` seeds native/artifact body references from the eight pages,
deduplicates by body_id before enqueue, and expands only the two typed nested source-evidence relationships.
Conflicting descriptors for the same body_id refuse. An already-seen body is never enqueued again, including cycles.
There are at most eight body loads in flight (`BODY_READ_CONCURRENCY=8`, line 24).
`hindsight-application-body-transfer.ts:68-89` issues one descriptor/status GET followed by exactly total_parts part GETs.
The status GET does not contain the body bytes.

Sanitized current-run warning-route counts:

- At the 14:45:01 UTC progress observation: 3,864 body-status + 3,856 part routes, 7,720 unique URLs, **zero repeats**.
- At 14:52:52 UTC: 4,223 status + 4,223 part routes, 8,446 unique URLs, **zero repeats**;
  cumulative driver HTTP count 10,515; Character proof true / Global proof false; persisted Core evidence documents 0.

These warning routes are useful evidence of distinct reads, not a substitute for an HTTP success counter.
`w5-reused-driver.mjs:42-44,61` resumes the older driver's HTTP count, so this cumulative number must not be treated
as a count of requests in the current process. The saved result read during inspection had 201 requests;
the exact process-start baseline was not independently recovered here. The progress counter also includes
status/control/lease calls, not only evidence downloads. No completion percentage or ETA is established.

At 14:57:52 UTC the counter was 10,690. A sanitized search of `run-native.log`, `driver-node.log` and
`driver-failure.log` found **no logged maintenance/auxiliary page ordinals**; these logs cannot establish the latest
completed ordinal. A conservative lower bound is still possible: 2,616 fixed pages plus the already observed
4,223 unique body-status and 4,223 unique part URLs require at least 11,062 relevant evidence requests for this Bank.
Even charging all 10,690 cumulative requests to that work leaves **at least 372 further evidence requests** at that
timestamp. This deliberately understates remaining work because the counter includes earlier/control requests and
the observed body closure count is only a lower bound. It is not an exact remaining-page count or a completion ratio.

Native body status/part endpoints read only the selected descriptor/part:
`H:/hindsight/hindsight-api-slim/hindsight_api/engine/application_state/store.py:226,309`.
Application snapshot-page reads validate the selected page body's bytes (`application_state/snapshot.py:275-294`),
not the whole application corpus. No repeated whole-body HTTP download was found in this uninterrupted invocation.

## Proven repeated work and its limits

There is repeated **server-side plan validation** in the later maintenance-page phase:
`transition_api_service.py:59-74` reads/validates transition status and the complete stored maintenance plan for every
evidence page. `transition_maintenance_store.py:92-123` selects the plan row, parses its complete candidate and proof,
and recomputes the candidate hash; only then does `cutover_verification_store.py:507-545` select the single evidence page.
Thus a 767-page export repeats whole-candidate validation 767 times. It is finite and is not another model run or
another transfer of all body bytes, but its cost can make later request throughput much lower than body throughput.
No timing attribution to that validation has been measured here.

The transition loader does **not** pass the existing optional cachedBody/cacheBodies callbacks to loadBodies
(`transition-native-loader.ts:33-34`). The complete Bank document is persisted only after all downloads and checks
(`transition-healthy-candidate.ts:72-74`; `memory-transition-candidate-repo.ts:18-29`). Consequently, interruption before
that point may cause this whole Bank's evidence to be downloaded again on a later explicit recovery. Once the complete
document exists, the current exact-request/proof reuse branch (`transition-healthy-candidate.ts:58-69`) avoids downloads.
This is a restart efficiency limitation, not evidence of a live unbounded loop.

The parent may continue observing this unchanged run. These findings do not authorize stopping it, optimizing the
current code during execution, increasing model budget, skipping checks, or advancing manual acceptance.
