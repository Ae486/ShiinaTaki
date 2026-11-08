# Usable memory delivery — 2026-11-08

## What a user can do now

The phase-1 memory path works with local Core/Native/PostgreSQL services and with a compatible existing instance:
authenticated setup, Bank/template preparation, activation, ordinary Local and Hindsight retain/recall, automatic
and manual synchronization, Home reopen, and recovery of an original Pending write after Core restart. The isolated
journey also covers paired backup/verification, healthy Local return/re-entry, offline emergency takeover, Local
restart/recall and pre-writer paired restore. [run artifact first-use-runtime/results/2026-11-08T08-48-21.445Z/result.json]

- **Managed-local first use:** run the compatible Native/PostgreSQL instance locally with Core, then configure and
  activate memory through Home. This is the local-service memory path measured below. It is not acceptance of the
  packaged managed installer, installed Shell lifecycle or complete model/configuration application; those remain
  separate lifecycle requirements. [source ../implement.md:192]
- **Existing instance:** connect Home to an already running compatible authenticated endpoint, validate it, prepare
  Banks/templates and activate it. This does not install or administer that server. Local memory remains usable
  independently. [source usable-delivery-2026-11-04.md:435] [source acceptance-after-journey12-20261107.md:31]

These are bounded engineering results. Owner Tauri judgment, real-key/Windows ownership, original-data activation
and subjective quality remain UNKNOWN until the owner supplies them. Full parent C01-C16 acceptance is not closed.
[source ../implement.md:233] [source usable-delivery-2026-11-04.md:461]

## How to use it

Use the existing [Home operating guide](usable-delivery-2026-11-04.md#existing-instance-operating-guide), together
with the delivered [v3 application guide](prompt-grounding-20261107.md#applying-the-delivered-change). The latter is
the current v3 guidance under this research directory; no separate v3 guide file was found. It explains explicit
preview/application, overlay precedence and the effect on future extraction. The older v1/v2 setup steps remain
supported. Neither guide is rewritten here. [source prompt-grounding-20261107.md:156]

Wait for the actual operation result. A timeout or failed synchronization attempt does not establish that an
accepted write was lost or finished. Keep the matching Core/Native pair and credential custody for backup and follow
the existing isolated D91 restore procedure. The test restore adapter is not an operator restore feature.
[source usable-delivery-2026-11-04.md:449] [source usable-delivery-2026-11-04.md:453]

## Final evidence and build boundary

The leader verified J17 and final R on the final source. Replay 6 is final L because no production changes followed
it. This report consumes those supplied facts; it starts no journey, replay, model call or service. The checkout is
`H:/TakiAgent`, branch `main`, with the inherited uncommitted integration preserved. J17's `baseline` records Taki,
Native, Node and harness identity. This is an uncommitted-source result, not a released-build attestation or a
completed D97 build/allowlist decision. [run artifact first-use-runtime/results/2026-11-08T08-48-21.445Z/result.json]
[source phase-plan-20261107.md:42] [source ../../../../docs/deferred-decisions.md:16]

| Gate | Result | Evidence |
| --- | --- | --- |
| **C / J17, November 8** | All 24 steps passed on final source. Includes `sync-during-home` and `pending-restart`. | [result](first-use-runtime/results/2026-11-08T08-48-21.445Z/result.json); retained root `G:/taki-first-use-1xXR4a` |
| **R, final real-model sample** | All six turns passed. Leader review: correct Local retain/recall; Global retain by taki recalled by mika without promoting a one-off tip to a preference; correct Character recall grounded in current time. Two wording flaws remain below. | Content-free `G:/taki-real-memory-aKXack/result.json`; root `G:/taki-real-memory-aKXack` |
| **L / replay 6** | Final-source copied 1,690-source coarse replay passed. Backup first attempt succeeded in the observed maintenance sequence. | `G:/taki-post-reentry-w0f2fB/replay-result.json`; [phase-plan row](phase-plan-20261107.md#dispatch-log) |

Replay 5 → 6 measurements: chat **43.3 → 15.8 s**, acknowledgement **8.5 → 2.7 s**, post-chat fence hold
**74.6 → 30.6 s**, longest event-loop stall **23.1 → 6.4 s**. These are observed samples, not latency guarantees or
stress acceptance. [source phase-plan-20261107.md:126] [source phase-plan-20261107.md:129]

F3/A2's bounded concurrent-use check is evidenced: J13 held a sync running while Home interacted successfully;
J14 and final J17 also pass it. F4's original Pending → restart → automatic recovery check passes in J14 and J17;
J17 `pending-restart` took **383 s**. Full C07/C08/C10 remain **partial** for the uncovered subcases listed in the
[acceptance map](acceptance-map-20261107.md). [source phase-plan-20261107.md:122]
[source phase-plan-20261107.md:125] [run artifact first-use-runtime/results/2026-11-08T08-48-21.445Z/result.json]

## Known limits

| Limit | User-visible consequence / remaining work |
| --- | --- |
| **D103** | Native-accepted work still appears as failed sync with `HINDSIGHT_PENDING_REMAINS` and a rising failure count while it is waiting. Phase 3 presentation/contract work remains. |
| **D104** | A backup started while maintenance holds the fence can fail its first attempt and require an explicit retry. Replay 6's successful observed first attempt does not add bounded automatic retry. |
| **D105** | Curator publication can still cause Native re-downloads and wait for the next local refresh. Phase 2 optimization remains. |
| **D106** | Managed-local memory footprint remains substantial; sizing is below. |
| **D107 / J15 flake** | J15 failed at `pending`: Home's Hindsight API Key input stayed disabled for 5 s because the key-presence read did not return, immediately after curator and scheduled-sync failures. J16 passed that step; J17 passed all steps. The intermittent stall is still open. |

All five entries remain open in [Deferred Decisions](../../../../docs/deferred-decisions.md).
[source ../../../../docs/deferred-decisions.md:22] [source ../../../../docs/deferred-decisions.md:26]

J16 was stopped at step 13 by the system's low-memory reaper. It is an incomplete run, not a product failure or a
full pass. J17 step 12 took **387 s**, step 13 **520 s**; J12 was **309 / 462 s**, J14 **382 / 623 s**. The cause of
the 12/13 slowdown is **UNKNOWN**; replay's template-lookup improvement does not establish causation for these steps.
[source phase-plan-20261107.md:116] [source phase-plan-20261107.md:125]
[run artifact first-use-runtime/results/2026-11-08T08-48-21.445Z/result.json]
[source ../../../../docs/deferred-decisions.md:25]

Managed-local needs about **3.5-4 GB** for Native/PostgreSQL/Core before Shell and window. Existing-instance mode
needs about **1 GB for Core** on the local machine; Shell and the actual window are **unmeasured**, and server
resources are separate. These are workload observations, not measured minimums for every platform.
[source ../../../../docs/deferred-decisions.md:25] [source phase-plan-20261107.md:116]
[source ../../../../docs/DEPLOYMENT-RESOURCES.md:22]

Two existing tests also fail on the pre-phase-1 baseline: `hindsight-memory-consumer.test.ts:106` and
`hindsight-configuration-context.test.ts:56`. They are not phase-1 regressions, and this closeout claims no green
full suite. [source phase-plan-20261107.md:128]

Final R has two wording flaws reserved for the template owner: a confirmation says the user said “good night”
when the user said “good evening”; the last answer treats “408 is a second pass” as a user fact although it was an
unconfirmed assistant question. The target recall/scope results passed leader review; complete factual wording
accuracy is not established by that six-turn pass. [run artifact G:/taki-real-memory-aKXack/result.json]

The current-row/full-proof split detects historical body-only damage at the next full verification boundary,
not every ordinary guard. Full proof remains at construction/publication/recovery and consuming-read validation.
This is an existing owner-approved trade-off, not a new closeout decision.
[source phase-plan-20261107.md:128] [source ../../../spec/backend/memory-authority-validation.md:39]

## What remains for phases 2-4

- **Phase 2:** optimize with simplification; finish remaining F3-F9 costs, respecting already delivered F4 binding
  batches/own-body work and F9 curator changes. Address D105-D107, scheduler continuation and remaining post-chat
  stalls. Step 12/13 cause is still UNKNOWN. [source phase-plan-20261107.md:55]
- **Phase 3:** Home progress/error/recovery presentation and owner UX judgment, including D103/D104. Chinese
  retrieval quality and deployment model choice remain separately measured decisions. [source phase-plan-20261107.md:67]
  [source ../../../../docs/deferred-decisions.md:20]
- **Phase 4:** library growth, long-run stability, repeated transitions, remote HTTPS and interruption between pull
  and binding. Retain nonempty-transition-queue/restart, returning-old-provider exclusion, restored unfinished-work
  continuation and extended mutation/fault/platform subcases until their own evidence exists.
  [source phase-plan-20261107.md:72] [source acceptance-after-journey12-20261107.md:122]

Managed installation/full model application, candidate upgrades, D97 build identity and owner/original-data
acceptance also remain tracked requirements. This docs-only closeout neither schedules nor implements them.
[source ../implement.md:192] [source ../implement.md:207] [source phase-plan-20261107.md:52]
