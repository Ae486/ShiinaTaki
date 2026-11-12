# Native B3 live validation and B4 bridge continuation — 2026-10-13

Updated: 2026-10-15. Status: R7 passed all 12 native functional checks after the designated upstream recovered.
Probe 17 returned a usable completion in 0.812 seconds. The reviewed native implementation produced a valid
structured video result, local indexing and real retrieval Q&A; the unchanged production MCP bridge and Taki
client read the complete original result after restart without another analysis. Final source/evidence hashes,
native owner closure and actual process exit were verified. Human content quality, full Co-Watching, real
Heartbeat and deployment remain unaccepted. Earlier failures, R6 refusal and unknown remote outcomes are retained.
See the final R7 section for exact scope and accounting; the owner superseded the original four-request cap.

## Latest owner authorization — functional acceptance

The owner subsequently removed the fixed request-count and output-token restrictions and explicitly authorized
using real models, adjusting both according to observed behavior, to establish that the feature actually works.
This supersedes the earlier four-request boundary and the proposed two-request follow-up; no further budget
confirmation is required for this functional test. Historical counters and failed campaign evidence remain intact.

The next independent fixture starts with `max_tokens=32768`, records its actual setting and response-shape
metadata, and may be adjusted based on actual provider/native results. That value is a diagnostic starting point,
not a promise of success. A current authenticated, read-only provider `/models` query for the exact
`deepseek-flash` ID advertises `context_window=1048576` and `max_output_tokens=393216`; 32,768 is within that
advertised range. This metadata is recorded in `functional-review/provider-metadata.json` and does not itself
prove completion behavior. Calls remain metered and failures are reviewed instead
of blindly retried. Acceptance includes valid native structured analysis, exact complete-result reads through the
production MCP bridge and existing Taki client, real local indexing and a successful evidence-based Q&A call.
Full Co-Watching/Host/browser/Heartbeat acceptance remains a separate product path.

The owner explicitly authorized continued implementation and real-data/model testing
after the B3 independent review. The earlier prohibition on new live model tests is
superseded for this campaign. The no-Trellis-task choice remains; no commit, publication,
retained-database migration or production deployment is included.

## Original bounded campaign (historical)

- Input: the previously owner-selected public video
  `https://www.bilibili.com/video/BV1UEaq6qEZt?p=1`, approximately 300 seconds.
- Model: exact `deepseek-flash`, using the designated primary endpoint/credential source
  from `H:/TakiAgent/.env.local`. Credentials remain in memory in a local relay; they
  are not copied into the native provider database, source, prompts or evidence logs.
- Execution: byte-verified BiliNote source snapshot under
  `.runtime/media-implementation-20261013/live-native/backend/`, a fresh SQLite database,
  new config/output paths, and separately copied local Whisper/Chroma caches.
- Service topology: one native process on loopback, plus a loopback model relay. The
  original native checkout, prior validation DB/output and user configuration remain intact.
- Work: one keyed `media_v1` analysis with actual media acquisition, six-second frame
  sampling and 3x3 grids; duplicate/conflict/identity/result checks; then read-only restart
  verification. A real Q&A call is conditional on successful analysis and remaining budget.
- Limit: at most four physical upstream model requests, each with `max_tokens=8192`.
  Compatibility retries and Q&A rounds count toward the same retained budget. A timeout
  does not authorize a new request UUID or automatic resubmission.

The previous media files lack the new part-acquisition evidence. They can be retained
for comparison, but cannot be renamed into trusted caches or assigned fabricated
provenance. The actual transcript, frame count, request receipts, moments and complete
result descriptors must come from this run.

The [readiness review](../.runtime/media-implementation-20261013/live-readiness/readiness-review.md)
records installed dependency versions, verified input/model cache hashes, path side
effects, startup containment and the concrete test sequence. Current model availability
and output quality remain unverified until an actual request succeeds.

## Measurement and interpretation

Retain native request/service/job identity, observed transitions, status/result hashes,
model attempt counts, actual returned usage and explicit cost fields if supplied.
Unknown cost/usage remains unknown, especially after failed or timed-out requests.
Token limits are not a monetary-price guarantee. Do not publish secrets, signed media
URLs or raw provider errors.

Test instrumentation is separate from the byte-identical source snapshot. It adds the
output cap before native accepted-request receipt capture, disables SDK automatic retry,
and meters real forwarding without substituting model responses or native results.
Any instrumentation/path adaptation must be recorded with the result.

Native HTTP/model success would validate this bounded path only. Full Co-Watching,
real Heartbeat scheduling/delivery, browser/Host source binding, remote protected ingress,
OpenBili behavior and Linux deployment remain separate acceptance work.

## Independent bridge scope

The new `integrations/media-bridge/` package implements the actual BiliNote HTTP contracts
through standard MCP stdio. It imports no Taki Harness or native service internals and
adds no job database, execution queue, model loop or automatic restart replay. Its first
surface covers origin inspection, keyed submission/reconciliation, status and verified
result reads/resources. OpenBili operations are not advertised before implementation.

The [bridge plan](../.runtime/media-implementation-20261013/bridge-research/plan.md) records
official MCP SDK 1.26.0, existing lock provenance and the isolated environment. The owner
explicitly approved installation there. All 31 locked packages and wheel hashes were verified;
installation, SDK imports and `pip check` passed. The lock spells the retained PyJWT package as
`pyjwt[crypto]` to satisfy pip's hashed extras resolution; package versions/hashes were unchanged.
No Taki/BiliNote/OpenBili environment was upgraded.

## Results

### Original native attempt and diagnosis

The original request `8a341599-0503-4e93-9fd0-9f402e1a620e` belongs to service
`4b1eac63-7d9c-4c07-a8ec-6e3cd0f1fb08`, job `fae3eeb0-7005-4c31-baa2-f1ee2536ebbd`.
Actual acquisition, ASR and frame extraction completed: 246 transcript segments, 50 frames,
six 3x3 grid images including the partial tail. Shared upstream attempt 1 returned HTTP 400.
The job remains failed. Same-key reuse, changed-input conflict, wrong-instance refusal and
same-DB restart without replay passed over actual native HTTP. The owned processes closed.

An explicitly bounded diagnosis consumed shared attempt 2. It rebuilt the exact model body
(3,506,081 bytes; wire SHA-256 `0eecc0a860bf7e389ec488698b9d1aa27d1cef27741dc32ca4b6031ec7ec9237`)
and confirmed HTTP 400, `This response_format type is unavailable now`, `invalid_request_error`.
The diagnostic used a different HTTP transport/header envelope, which is recorded; body bytes
were identical. This establishes the format-hint rejection, not an image-count limit. Neither
response provided usage/cost. The diagnostic did not modify or promote the failed job.

Evidence: `.runtime/media-implementation-20261013/live-native/` and `live-diagnostic/`.
An initial controller launch had no job/model activity and is retained under
`live-native/attempts/first-startup/`. Its Windows venv launcher/interpreter PID mismatch was
fixed using launch-nonce-matched actual interpreter identity before the original task ran.

### Bridge gates

- HTTP checks: 21 passed in the original native environment, and 21 passed in the newly
  installed SDK environment. Four disposable SQLite/native ASGI integration checks passed.
  These use synthetic media/model producers. Their source hashes and differing environments
  are explicit; the native ASGI snapshot precedes the new compatibility patch.
- Actual stdio interoperability: unchanged Taki `defaultConnect`, `@ai-sdk/mcp` 2.0.10,
  Python MCP 1.26.0, Node 24.18.0, protocol `2025-11-25`; initialize, five tools/annotations,
  lookup/status, full-resource byte/hash checks, full tool view and errors passed.
- Lifecycle: Taki's existing abort-style close ended the actual interpreter without an orphan,
  but did not execute Python `finally`. A separate stdin-EOF gate proved cooperative HTTP
  transport/lifespan cleanup and exit. The first fixture's failed graceful-close assertion
  remains preserved rather than being relabeled a passing result.

Evidence: `bridge-final/package-manifest.json`, `bridge/sdk-installed-verification.json` and
`bridge-review/sdk-review.md` under the same runtime root. The bridge introduces no Taki
Agent/Harness source change; 21 related framework source hashes still match the prior review.

The final package capture contains 20 files. Actual patch application reconstructed every file byte-for-byte.
The current bridge production files match the SDK HTTP gate; the final capture preserves the original reports
and explicitly records older fixture/lock/native-source differences instead of assigning them current results.
See `bridge-final/hash-continuity.json` and `bridge-final/package-verification.json`.

### Corrected-code retest boundary

The native change keeps strict `media_v1` validation and the same messages/model/images;
only an explicitly rejected optional wire field may be removed within one summarize call.
Accepted receipts and checkpoint validation retain actual transmitted-payload identity.
Existing outer transient retry policy is preserved. This campaign separately limits the
outer retry to one and disables SDK retries.

The retest uses `.runtime/media-implementation-20261013/live-native-retest/`, its own fresh
DB/profile/output and a complete source snapshot checked against the original 171-file
snapshot plus the declared compatibility delta. The original failed DB/job/diagnostic files
remain unchanged; only the exact shared `live-native/budget-state.json` can advance.
The global budget remains four upstream requests, starting the retest at two used. No
failure permits an automatic new request UUID or a reset of the shared count.

After terminal settlement/restart, the test reads the actual native HTTP result through
the production bridge and existing Taki MCP client. That probe never calls the submission
tool and must consume zero additional model requests. Q&A is conditional on remaining
budget and is reported separately from successful analysis. Human output-quality acceptance,
formal Host/browser binding, full Co-Watching and real Heartbeat remain separate.

### Actual corrected-code retest — 2026-10-14

The final relay correction passed an independent seven-test offline gate. The parent preserved `review-4`,
froze the 20 reviewed script/bridge/client files as `review-5`, and ran the new campaign once. The prepared
172-file native source snapshot and 12 assets were verified before and after execution.

The new request is `16a3e54d-87a9-449e-9f09-17e0bf0e2fc2`, service
`868a491d-5747-440f-8ba8-299f8f86fa69`, job `4e7fcab9-9b05-4514-8f0c-31183870b563`.

| Observation | Actual result |
| --- | --- |
| Shared attempt 3 | Six images, `response_format` present, HTTP 400 with the observed optional-format refusal. |
| Shared attempt 4 | Same summarize operation, six images, `response_format` omitted, HTTP 200 in 53.093 seconds. |
| Native output | `invalid_structured_result`; the explicit incomplete/refused-response guard ran before JSON parsing. No confirmed result artifact was published. |
| Returned usage for attempt 4 | 18,551 prompt tokens, 8,191 completion tokens, 26,742 total; all 8,191 completion tokens reported as reasoning tokens. |
| Cost and earlier usage | Cost unknown; attempts 1–3 returned no usage. The reported token sum is partial campaign usage, not a complete billing total. |
| Real native controls | Immediate and terminal same-key reuse, conflicting-input refusal, wrong-instance refusal, retained identity across restart and no model replay all passed. |
| Real MCP path | Actual native HTTP → unchanged production bridge → existing Taki `defaultConnect`: five tools, original identity/status and unavailable-result error passed; no submission tool or model request was made. |
| Shutdown | Both native owners closed; both actual native interpreters and the MCP interpreter exited. No matching test listener/process remained at the final check. |
| Overall disposition | `partial_or_failed`, controller exit 1. Analysis, actual successful resource delivery, real Chroma indexing, Q&A and human quality acceptance did not pass. |

The immediate native guard rejects empty/whitespace content, a truthy refusal or `finish_reason == 'length'`.
The retained relay evidence did not capture these choice fields, so it cannot distinguish which condition fired.
The reasoning-token count near the 8,192 cap supports output-budget exhaustion as the leading hypothesis;
it does not prove a specific finish reason or invalid JSON. Checkpoint completion remains zero, with no accepted
partial result or receipt. No failure was promoted to success or silently reopened.

The shared budget is now **used 4, limit 4**. No further model call was made. A next experiment must use a
separate explicitly bounded campaign, preserve both failed jobs, and first capture only response metadata
(choice count, finish reason, content type/length/blank flag, refusal flag and usage), never reasoning text.
Increasing `max_tokens` to 16,384 for at most two further requests is a proposed diagnostic choice, not a verified
provider limit or a success guarantee. No vendor-specific thinking-disable parameter is assumed supported.

`next-native-campaign/response_metadata.py` now contains that text-free observer, with three passing offline
regressions covering the guard conditions, missing/null fields and non-disclosure of arbitrary provider text.
It has not been installed into the completed campaign or used for a new request. The next campaign remains a
proposal; no new model-call budget has been consumed or silently granted.

Evidence under `.runtime/media-implementation-20261013/`:

- `live-native-retest/campaign-state.json`, `model-usage.jsonl`, `usage-summary.json`, `bridge-live-results.json`.
- `recovery-20261014/independent-review.md`, `post-live-review.md`, `post-run-integrity.json`.
- `recovery-20261014/session-restore.md` records recovery from session `01a12fce-80d0-74e3-972c-ea23aa467eca`.

The final integrity check preserved all 13 original failed-job/diagnostic files and all 23 framework source/spec
files in the earlier decoupling manifest. This restoration introduced no Agent/Harness or native production edit.

## Functional continuation and numeric correction — 2026-10-15

The latest owner authorization above supersedes the historical fixed-count/8,192-token campaign and its proposed
two-request follow-up. Subsequent fixtures used `max_tokens=32768`, metered every physical forwarding and retained
each failed job and its evidence. These counters exclude the separate October 9 original validation.

| Fixture | Cumulative physical requests | Recorded outcome |
| --- | ---: | --- |
| `next-native-campaign` | 6 | `partial_or_failed`; no successful structured artifact. |
| `functional-schema-r2` | 8 | `partial_or_failed`; native temporal validation rejected the response. |
| `functional-time-r3` | 10 | `partial_or_failed`; five moments had unsupported endpoints, including citation mismatch and floating-point tails. |
| `functional-grounded-r4` | 12 | `partial_or_failed`; grounding guidance removed the larger mismatches, leaving one adjacent-float boundary failure. |

R4 returned 12 moments; its only unsupported endpoint was `147.08`, against a cited transcript end of
`147.07999999999998`. The difference is exactly one binary64 step, `2.842170943040401e-14` seconds. R4 remains failed:
its offline temporal replay does not publish a result or reopen its request. R4 reported 25,941 tokens for its one
HTTP 200 response; its other response supplied no usage and monetary cost remains unknown.

The correction changes only native `media_provenance.py` and `test_note_temporal_contract.py`. Proper transcript
intervals accept their original range plus one immediately adjacent representable value at either boundary.
It preserves source/model values and receipt hashes, with exact frame/point, duration, ordering, finite-value and
reference checks. Two-step unsupported values and meaningful gaps remain invalid. This deliberately admits a
single-representable-value gap near an edge and has no global physical-time bound at arbitrarily large magnitudes;
it is not rounding, clamping or a generic epsilon. The existing huge-duration prompt-formatter overflow is recorded
separately and was not changed.

The final native gate passed 68 tests, including checkpoint restore without another model request and native
schema/projection/persisted-result reads. The original red gate and the first green-attempt test-scope failure remain
retained. The actual baseline/current native predicates also checked all 24 retained R4 endpoints: the baseline
rejects moment 6, while the corrected predicate rejects none. That replay is temporal-only evidence.

R5 uses an independently copied 174-file source snapshot and 12 assets, with a 23-file script/bridge/client freeze.
The current 18-test harness gate and five-tool MCP startup/exit gate passed. All 365 historical and 23 framework
source/spec preservation hashes matched before launch. The source manifest is
`native-numeric-contract/functional-source-manifest.json` (SHA-256
`ac441a206516819b345f55192057275fb1466e1151a5703cac61fe210d08a790`).

Recovery and independent review are recorded under
`.runtime/media-implementation-20261013/recovery-20261015/`; numeric red/green/replay evidence is under
`native-numeric-contract/`. All available parent and child session records were processed; encrypted message bodies
and already-truncated historical output cannot be reconstructed. The owner still chose no Trellis task creation or
binding. The unrelated archived Avatar Lab pointer and historical OpenBili planning artifacts were left untouched.

R5 acceptance requires every one of the 12 named campaign checks, controller exit 0, final integrity verification,
native owner closure, empty observer failures and actual native/MCP interpreter exit. MCP failed-state reads alone
are insufficient. Human content quality, full Co-Watching, Host/browser binding, real Heartbeat, OpenBili behavior,
retained-store migration and VPS deployment remain separate gates.

### R5 actual outcome

R5 request `752ae8c9-4306-4835-bc2f-cd14b8c7d9a4`, native job
`cc834bf3-7ec8-4e86-b54f-54d885ed6116`, service instance
`1b202ac3-c2fe-4c66-93cb-65a9d731af6b` ran from 02:45:38 to 03:02:25 UTC on October 15.
It used the selected video, exact `deepseek-flash`, six image grids and `max_tokens=32768`.

| Observation | Actual result |
| --- | --- |
| Attempt 13 | HTTP 400 in 0.937 seconds; explicit optional `response_format` refusal. |
| Attempt 14 | Same summarize operation with that field omitted; HTTP 200 after 901.016 seconds, but `choices_is_list=false` and no usable completion or returned usage. |
| Native result | `invalid_structured_result`; no confirmed artifact and no call to the observed temporal validator. This run neither proves nor disproves the numeric correction on a live response. |
| Functional gate | Controller exit 1, `partial_or_failed`; analysis false and five dependent artifact/visual/index/Q&A checks absent. |
| HTTP/MCP controls | Same-key reuse, conflict/wrong-instance refusal, retained failure reads, exact-key MCP reconciliation and restart without model replay passed. Successful complete-result delivery was not exercised. |
| Shutdown/integrity | Both native owners closed with launch-matched PID/nonce evidence and empty observer-failure lists; both native interpreters, launchers and the MCP interpreter exited. Ports were free. All 174 source/12 asset, 23 frozen, 365 historical and 23 framework hashes matched. |
| Accounting | Two new requests, cumulative 14. Neither returned usage or monetary cost; unknown is not zero. |

The safe response observer cannot distinguish an absent `choices` key from null or another non-list value and did
not retain arbitrary upstream response bodies. The 901-second duration alone does not prove a particular gateway
timeout or vendor error. During the wait, an authenticated read-only `/models` probe returned HTTP 200 in 0.875
seconds and still advertised the exact model and the same limits; model listing does not establish inference health.

Evidence: `functional-numeric-r5/post-run-integrity.json`, `campaign-state.json`, `model-usage.jsonl`,
`bridge-live-results.json`, both `server-exit-*.json`, and `recovery-20261015/provider-models-probe.json` under the runtime
root. The separately recorded minimal endpoint-shape probe below does not reopen R5 or replace the native
functional acceptance gates.

### Minimal endpoint-shape probe and current continuation point

After a ten-test offline gate, a frozen one-shot diagnostic sent only `Reply with OK.` to the same exact model and
primary endpoint, with `max_tokens=1024`, no images/format hint, no redirects and no retries. It reserved ordinal 15
in its own durable ledger; R5's count of 14 and all historical evidence remained unchanged.

No response result was obtained before the parent stopped only the verified diagnostic launcher/interpreter after
268.714510 seconds. The configured 90-second socket timeout did not impose an absolute wall-clock deadline; no
specific reason for the prolonged wait is established. The local process was stopped, not a confirmed upstream
operation cancellation. The remote outcome, usage and cost remain unknown. The reservation and dispatch records
remain; there is no fabricated completion record, result or automatic retry.

`provider-shape-diagnostic/parent-stop-verification.json` verifies the actual process creation identities, their exit,
unchanged script/R5-counter hashes, the single local dispatch and available native ports. Its elapsed value parses
the original UTC timestamps directly; it explicitly corrects the erroneous PowerShell-derived elapsed field in the
preserved `parent-stop-observation.json`. All owned R5 and diagnostic processes are now closed.

This continuation made three new upstream request attempts (R5 ordinals 13–14 plus diagnostic 15), with no reported
usage or cost. `/models` availability, offline regression success and retained failed-state controls do not establish
working inference. The current unresolved prerequisite is a usable completion response from the designated
upstream. Before another real probe, use an independently verified absolute controller deadline and preserve
uncertain remote outcomes; before claiming the native feature works, repeat the full successful analysis/index/Q&A/
MCP-resource acceptance against a reviewed new fixture. R5 itself stays terminal and is never reopened implicitly.

## Approved deadline and controller continuation — 2026-10-15

The owner approved the proposed continuation: establish a verifiable total deadline, verify a usable upstream
completion, and then resume the complete native functional gate. The no-Trellis-task choice and existing
implementation/real-model authorization remain unchanged. All work in this continuation is test infrastructure and
documentation; native BiliNote, production MCP bridge and general Agent/Harness source were not changed.

### Total transfer deadline

The installed, hash-pinned `C:/Windows/System32/curl.exe` 8.21.0 receives configuration, credentials and original
request bytes through stdin. It disables user curl configuration, proxies, redirects and retries. `--max-time`
limits the entire transfer. A parent monotonic join also covers Windows' untimed stdin-write portion of
`Popen.communicate`; on deadline or a failure after process creation, only the exact owned curl handle is killed
and waited, with a separate shared two-second cleanup budget. Native storage owners are never force-killed by this
transport. Complete raw responses remain in memory; incomplete bodies cannot reach the native completion parser.
This is a test transport change from urllib to curl, not an assertion that the original HTTP/TLS envelope is identical.

The 19-test local gate uses real loopback HTTP/curl plus targeted failure injection. A 0.2-second socket timeout
was reproduced reading a continuing trickle for about 1.765 seconds. With a 0.45-second total budget, trickle and
post-header stalls ended in about 0.485/0.453 seconds with the owned process/communication exited. Tests also cover
curl's own transfer deadline, unchanged binary/UTF-8 request bytes, response size limits, redirect refusal, safe
metadata, thread-start failure cleanup, prior evidence preservation and single-use reservation. Budgets include
ordinary scheduling/cleanup overhead; they are not hard real-time OS guarantees.

### Actual ordinal 16

The independently reviewed one-shot probe reused exact `deepseek-flash`, the designated primary credential source,
`Reply with OK.`, `max_tokens=1024`, no images and no format hint. Its actual outcome was
`total_deadline_exceeded`: 90.015 seconds elapsed, including 0.015 seconds of cleanup. Curl PID 16364 and the
communication worker exited automatically. No complete response or usable shape was obtained; the remote outcome,
usage and cost remain unknown. The safe record's null HTTP status is not proof that no response headers ever arrived.

The ledger has exactly reservation, dispatch and terminal local observation for ordinal 16. No retry occurred.
R5's retained counter stays 14, ordinal 15 stays separately reserved with unknown remote outcome, and the cumulative
reserved request-attempt sequence is now 16. This continuation added only one upstream request attempt.

Evidence under `.runtime/media-implementation-20261015/provider-deadline/`: `script-freeze.json`,
`checked-results.json`, `reservation.json`, `probe-ledger.jsonl` and `result.json`. The independent review is in
the sibling `review/` directory. Historical October 13/15 failure and manual-stop records were preserved.

### R6 readiness and deliberate refusal

The new `functional-deadline-r6` harness passed 29 offline checks. Its success predicate now requires every one of
the 12 named functional checks; the previous missing-key false-positive was reproduced before the correction.
The relay preserves the exact accepted payload, actual upstream status and existing narrow optional-format refusal
semantics, and records transport completion separately from HTTP status. A deadline, oversize body, incomplete
cleanup or redirect cannot be mistaken for a format refusal or completed model output. Invalid usage/cost numbers
are excluded from diagnostics without altering the original completed model response. Billing response headers are
not collected by this transport and remain unobserved rather than inferred.

Preparation and campaign startup both verify the preserved R5/ordinal-15 lineage and require a completed, usable
ordinal-16 choice with no refusal/truncation and confirmed local cleanup. The actual `prepare.py` invocation refused
with `Probe 16 has not established a usable completion`, before creating a usage counter, native snapshot/database,
request UUID or service. The 35-file script/bridge/probe-proof freeze and 518-file historical preservation manifest
remain available. An independent SDK preflight confirmed the corrected cross-date path to the existing locked
bridge environment: five tools, no native/model request, and actual interpreter exit.

The initial future native per-request transfer budget is 300 seconds, separately recorded from the overall campaign
and cleanup. Earlier usable completion envelopes took 31.484–66.765 seconds at the same 32,768-token setting; this
does not guarantee future latency or native acceptance. R6 was not staged or run. Another experiment requires a
new reviewed probe/counter lineage after the upstream completion prerequisite changes; no terminal request is
silently reopened. At that historical stopping point, full native functional and human/Co-Watching/Heartbeat
acceptance remained open; the later R7 result below supersedes only its native functional status.

## Recovered upstream and successful R7 functional acceptance — 2026-10-15

This continuation restored sessions `01a13d61-e8a3-7a63-ba44-7c016e834e2f` and
`01a13f41-8d3e-7d22-9897-f681fed64af9`. The first supplied the approved deadline/controller work; the second
prepared and independently reviewed probe 17 and the R7 successor, including 12 probe and 27 controller tests.
Those recorded checks were reused after verifying their exact source and evidence hashes. No native, bridge,
Agent/Harness or dependency code changed in this continuation. The owner renewed real-model authorization;
the existing no-task choice and historical OpenBili planning status remain unchanged.

### Actual requests and accounting

The designated primary endpoint and exact `deepseek-flash` model were retained. Probe 17 had no prior reservation
or dispatch. Its single real request returned HTTP 200, nonblank content, `finish_reason=stop`, 48 reported tokens,
and confirmed curl/communication exit in 0.812 seconds. The successful terminal proof then admitted R7; earlier
ordinals 15 and 16 remain remote-outcome-unknown and R6 remains unexecuted.

| Attempt | Purpose | Observed result | Transfer seconds | Reported total tokens |
| --- | --- | --- | ---: | ---: |
| 17 | Minimal provider prerequisite | HTTP 200, usable completed choice | 0.812 | 48 |
| 18 | Video analysis with optional format hint | HTTP 400, explicit optional-format refusal | 1.781 | Unknown |
| 19 | Same native summarize operation with that hint omitted | HTTP 200, valid native structured result | 63.704 | 32,235 |
| 20 | Q&A initial retrieval decision | HTTP 200, tool calls | 2.469 | 1,749 |
| 21 | Q&A follow-up retrieval decision | HTTP 200, tool calls | 1.282 | 3,178 |
| 22 | Q&A final answer | HTTP 200, completed answer | 6.531 | 5,585 |

R7 used the already reviewed narrow optional-format compatibility behavior; it did not weaken native validation.
One Q&A endpoint call made three actual model requests through its retrieval/tool loop. This continuation added
six physical request attempts including the prerequisite; R7 itself added five. The cumulative retained sequence
is 22 and still includes the earlier unknown outcomes. Known returned usage totals 42,795 tokens for this
continuation, excluding unreported attempt 18; this is a subtotal, not complete billed usage. No monetary cost
was returned. Earlier counters and the separate October 9 validation are not rewritten into this accounting.

### Functional result

The controller ran from 11:38:19 to 11:42:15 UTC and exited 0 with `passed_functional_campaign`.
It used request `aec63c7c-979b-42e1-9976-d7f15ce68e4c`, job `ef9ff907-6703-4d85-8214-de69c38bdf4e`,
and service instance `8c6a923c-dae2-478d-a740-b3e74f0bbf7f` against the selected
`BV1UEaq6qEZt`, cid `42265479965`, page 1. Its independent database and output directory remain in R7.

All 12 required checks passed: immediate and terminal same-key reuse; changed-input conflict and wrong-instance
refusal; successful native analysis; original artifact identity and both digests; actual visual inputs; real local
Chroma indexing; live Q&A and retrieval sources; ordinary restart with original identity and no model replay;
and complete native-to-MCP reads through the unchanged Taki client.

The result contains 246 transcript segments, 50 sampled frames sent as six image grids, and nine grounded moments.
The selected downloaded media is 299.3 seconds; its last sampled frame is at 294 seconds. There are no reported
frame omissions. The original public UTF-8 result is 93,226 bytes, SHA-256
`06c65b0e23d4edebda8d6bb50830c5cef66378696213546e9a848dffe704f380`; the retained native envelope has its own
verified digest. Both the MCP resource and complete tool view matched the original result after restart.
Reading and exact-key reconciliation forwarded no model requests.

The Q&A returned a 1,320-character answer about Loader and page transitions with six retrieved sources, including
timed transcript excerpts. Parent inspection found a substantive answer that distinguishes retrieved transcript
from generated notes and explicitly discusses ASR spelling errors and a missing exact third-subtype timestamp.
This inspection is not owner quality acceptance or proof that every generated statement is correct; the retained
tiny ASR model produces noticeable terminology errors. Visual input delivery also does not by itself establish
human-rated visual interpretation quality.

### Final verification and next boundary

Post-run checks matched all 174 prepared native source files, 12 assets, 82 frozen script/dependency/proof files,
561 historical evidence entries and 23 framework source/spec files. Both native owners closed with matching
launch nonces and empty observer-failure lists. All recorded native launchers/interpreters, MCP interpreter and
curl processes were independently observed exited; both fixture ports were available. `processes.json` is a
startup snapshot, so its older `exited` fields are not the final liveness source. The final owner-exit records and
post-run PID observations supply that evidence. Existing abort-style MCP closure still does not prove Python
graceful-EOF/finally behavior; its previously separate lifecycle check is not expanded by R7.

Evidence root: `.runtime/media-implementation-20261015-resumed/`. Key artifacts are
`provider-recovery17/result.json`, `functional-recovery-r7/campaign-state.json`, `artifact-checks.json`,
`qa-result.json`, `bridge-live-results.json`, `usage-summary.json` and `post-run-integrity.json` under that campaign.
The [readable result preview](../.runtime/media-implementation-20261015-resumed/functional-recovery-r7/result-preview.md)
and [combined continuation record](../.runtime/media-implementation-20261015-resumed/continuation.md) support review.

The native successful-result gate is now passed for this isolated fixture. It does not close V1 for OpenBili or
the full product gates. The next integration boundary remains an authenticated selected Host/browser producer
and accepted source connected to the existing prepared-publication entry, followed by actual Co-Watching
interaction and real Heartbeat verification. Complete restart/Continue, OpenBili browsing/feedback, retained-store
migration and VPS deployment remain separate. Preserve the successful job and failed historical attempts;
re-analysis requires a new explicit request identity, never reopening their terminal state.
