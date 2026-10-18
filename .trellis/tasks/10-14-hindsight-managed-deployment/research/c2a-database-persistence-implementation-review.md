# C2a database persistence implementation review

Date: 2026-10-15. Reviewer: /root/c2_design_check.

**PASS for the admitted task-only implementation. Runtime NOT RUN.** No issue requiring a source fix was found after the actual code-path review and scoped lint, type-check and scanner checks. Root may prepare once from the exact bytes below and proceed with the already authorized build/run sequence. This result does not establish real database persistence, shutdown timing or C2b readiness.

## Findings (fixed)

None. The four implementation files are unchanged from the implementer's release. Only this review and its JSON companion were written.

## Findings (not fixed)

None within this static review's scope. The runtime observations listed below remain acceptance work, not unresolved source findings.

## Exact implementation release

| File under research/ | Bytes | SHA-256 |
| --- | ---: | --- |
| docker-database/fake_child.py | 44233 | 4c1f401e9d1e43a8dcdc3c241cb74a05b892a53e57be958bd3096725a16c171c |
| docker-database/database-read.py | 6084 | b3dd31c1c527850d188a1f09213756cefef8cd511266275fb0c47d342b322c3f |
| docker-database/run-persistence.ts | 51340 | 46a1b0b3f13816bbd56b46b1c279724ef7e52bdf75453d7addd8eda6cb01f7b0 |
| docker-database/README.md | 21343 | e2ef5c3b316e15226fb56f091e06c728511a251824a5ad23420ff5d7ebe1b12f |

Reviewed plan: 26,961 bytes, SHA-256
`186f60061a4ecd7ac26443f90c079225c3bc9efb782f27227b50763ff0088e4c`.
Design PASS: 4,868 bytes, SHA-256
`bade2cab57318c88d19b5f66684f3a708fee2e3349f2c543874db3b2f1be628a`.

The unchanged self-check Markdown/JSON preserve the implementer's original failures, repairs and successful checks. Their hashes are respectively
`7591e5f503dffa5226350a2423f950ff02bbc74ba873202048e40ad36e405a36` and
`13706e83e2c733114a66e1246df20752acb42adffdc3376bbaf702c81598c72d`.

The [JSON companion](c2a-database-persistence-implementation-review.json) binds all twelve original Native recipe/module entries, the twelve-entry resulting build context with only fake_child.py substituted, the preserved task prerequisites, and the final fixture files. Those original Native bytes and preserved task files matched their self-check pins. The unchanged recipe is 555 bytes, SHA-256
`2be1279ef4621f5d42397879fab2e436d780224eb3c02d591180faf9e9a9fcff`.

The existing C2a production source manifest itself matched its launcher pin:
`f27379be3b4b5e61e1b2821c2eda2d87bf54e5c2983b034bdb637ee789961ae2`.
This review did not repeat the accepted source matrix or independently rehash that manifest's 109 production entries; the unchanged launcher checks those entries before provision. No new production source change is admitted by this task fixture.

## Decisive source checks

| Contract | Concrete implementation |
| --- | --- |
| Original two-generation data | fake_child.py:435-477 refuses partial initialization and binds the restart to the original manifest, intent, clean first stop, source/tools and cluster. :536-601 dispatches pg0 only for generation 1 and raw postgres only for generation 2. :730-797 commits one parameterized 4 KiB row in an ordinary logged table, verifies it from a new connection, and keeps generation 2 on SELECT-only verification. The launcher independently derives the expected payload digest at run-persistence.ts:357. |
| Input containment and liveness | fake_child.py:372-434 independently checks fake inputs, dotenv suppression, UID/root/startup and wrapper session. It imports the existing subreaper, publishes only the exact liveness marker, clears fake references/environment, and passes explicit nonsecret environments to DB descendants. The five-second consumer marker is separate from SQL readiness. No Native API/provider import or model use is introduced. |
| Actual direct/adopted ownership | fake_child.py:621-643 binds the live PID file, executable, parent and start ticks. :710-729 records backend/logger ancestry. :816-837 excludes direct Popen handles from generic adopted-child wait. :878-942 requires the original postmaster, raw fast stop, the correct direct/adopted wait, no owned remaining processes/logger/PID file, and clean control state matching SQL. Native supervision.py and fake_consumer.py were read to confirm the wrapper's session and subreaper seam. |
| Shared stop/scan/report clock | fake_child.py:220-247 and :849-857 retain a single monotonic shutdown origin and the original 25-second bound; the last half second is reserved inside it. :945-1037 performs the complete stopped-volume streaming scan, controlled installation file-link handling, stopped marker and bounded final publication. A timeout, unreadable/special entry, nonzero exit or incomplete scan remains failure. No forced cleanup result becomes a graceful PASS. |
| Held original execute | run-persistence.ts:434-489 matches request ID, complete control and the parsed original Effect before reading Native waiting state/no DB. It starts a separate ten-second capture-to-release timer, closes on failure and releases the unchanged held execute only once. The existing relay clears its own capture timer at capture, so the added timer fulfills the design binding. No authorization/frame is retained in evidence. |
| First-stop bytes and final fixed copy | run-persistence.ts:510-526 checks the first stopped container, starts the same CID waiting, checks the first stop, writes its original UTF-8 bytes exclusively, and reads their hash back before :536 resumes. database-read.py:146-159 returns that exact raw text/hash. run-persistence.ts:577-584 copies only the final fixed report from the stopped original CID, checks a regular <=128 KiB local file, scans it and joins it to generation 2. |
| Original resource and permission path | run-persistence.ts:527-558 proves observe/repeated original start cause no new attempt, then requires fresh startup/Run/Attempt/Effect/custody/checkpoint/authorization identities on the same deployment/config/container/volume. Repeated resume is observation-only. :295-334 and :565-588 correlate original resource events and two no-TTY private submitters; every public result keeps deploymentReady=false. |
| Exact cleanup and ownership | run-persistence.ts:635-684 closes/reaps the recorded fixture process trees and confirms captured helpers gone before scanning W. It revalidates the original registry/engine/resources, removes only stopped CID, unreferenced V and the uniquely tagged new image without force/prune. W is scanned, canonical/token checked and removed using native PowerShell from S. Root separately compares the original unrelated workloads and archives/removes S as README Stage 3 requires. |

The task-only file/function length allowances retain one cohesive admitted sequence and its cleanup; they do not relax production limits. Existing task README Stage 3 accurately carries the new fixture contract. No production schema/platform/template change or additional .trellis/spec update is needed for these task-local files.

## Verification

All commands were scoped to the three fixture sources; raw commands/results are retained in the JSON companion.

| Check | Result |
| --- | --- |
| Python AST and in-memory compile | PASS, Python 3.12.7; no target main or bytecode output |
| Ruff E/F/I | PASS, isolated/no-cache |
| Ruff format | PASS, isolated/no-cache/check |
| Node syntax | PASS; --check only |
| ESLint | PASS; --no-ignore and --max-warnings 0 |
| TypeCheck | PASS; one launcher entry, noEmit=true, incremental=false, diagnostics=[] |
| Actual stream_hits | PASS, four synthetic regular-file cases: no match, whole match, split boundary, no overlap double count |

The four temporary G: files were automatically closed and removed. They exercised only the actual streaming function with 128-byte chunks; production scanning retains its fixed 1 MiB chunks/72-byte overlap. No Docker, WSL, application, SQL, image/Host/Rust build, install, old 182-case suite or Git lifecycle command ran. The unavailable python3 Store alias was bypassed using the already installed interpreter, without changing PATH or dependencies.

## Runtime boundary and Root handoff

Retain T=`20d996bf-64b6-47c7-908d-730ebdb371c4`,
S=`G:/TakiAgent-c2a-database/persistence-20d996bf-64b6-47c7-908d-730ebdb371c4`,
W=`C:/taki-c2a-db-persistence-20d996bf-64b6-47c7-908d-730ebdb371c4`,
and the matching `taki-c2a-db:T` tag. This reviewer created none of them.

Root still must prove the actual pre-injection waiting/no-DB state, both SQL generations and logged-row persistence, subreaper ownership under Native, actual API-free PG shutdown, complete scan/report within the original deadline, exact Engine/resource counts and owned cleanup. Retain the first-stop raw bytes before resume and final-stop bytes after the last stop. The prior offline DB prerequisite cannot substitute for these observations.

No ready Native API, C2b trusted reference, inner Native ACK-loss case, shared-daemon restart or owner manual acceptance is established. No new confirmation is required for the already authorized Root sequence. Ownership of the unchanged fixture bytes is released to Root with this report.

