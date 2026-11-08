## 1. Outcome

**Partial — harness changes completed; baseline run blocked before launch.**

Creating `G:/taki-hindsight-first-use-20261107` returned **“Access to the path … is denied.”** This session allows workspace writes but provides no approval escalation. **Journey runs: 0. New result directory: none.**

No Core, Native, PostgreSQL, or Chromium processes were started; none require cleanup.

## 2. Changes

Files below are relative to `.trellis/tasks/08-09-memory-operations-ui/research/first-use-runtime/`. Four files changed; `smoke-core.mjs` remains unchanged.

Every diff hunk is accounted for:

| Source | Purpose |
|---|---|
| [source native-smoke.mjs:10] | Import UUID generation for registered template application. |
| [source native-smoke.mjs:18] | Reuse existing durable-write, replica-record and template readers. |
| [source native-smoke.mjs:51] | Record step start time. |
| [source native-smoke.mjs:62] | Record step finish time alongside existing duration. |
| [source native-smoke.mjs:128] | Verify persisted retain call/result identity, original parent/child, one Source/fact, and every returned memory ID. |
| [source native-smoke.mjs:245] | Require executed, durable retain evidence for the first Hindsight chat. |
| [source native-smoke.mjs:262] | Verify its completed replica effect after synchronization. |
| [source native-smoke.mjs:289] | Add interval-trigger attribution, equivalent manual-only observation, configuration restoration and bounded lease observation. |
| [source native-smoke.mjs:442] | Observe the original outage Pending request, a failed sync, unchanged last success and rendered Home values. |
| [source native-smoke.mjs:495] | Verify recovery preserves Native identity, applies once and advances successful-sync evidence. |
| [source native-smoke.mjs:562] | Recheck the recovered write after Core restart. |
| [source native-smoke.mjs:597] | Register the scheduled/manual observation step. |
| [source native-smoke.mjs:605] | Apply latest v3 after v2 using registered preview/apply/status/detail operations and Native mission readback. |
| [source native-smoke.mjs:659] | Assert backup template attestations preserve the selected revision. |
| [source native-smoke.mjs:696] | Distinguish backup format v2 from selected template revision. |
| [source native-smoke.mjs:708] | Identify the selected revision in the re-entry step title. |
| [source native-smoke.mjs:718] | Assert re-entry preserves that revision. |
| [source native-smoke.mjs:749] | Assert verified paired restore preserves its template attestations. |
| [source native-smoke.mjs:891] | Disclose Native request-count attribution limits. |
| [source home-check.py:119] | Explicitly select v2 for the existing v1→v2 enrollment exercise. |
| [source home-check.py:263] | Check separate attempt/success/error values in RPC and DOM; retain screenshot/JSON and verify navigation. |
| [source home-browser.mjs:62] | Accept expected synchronization observations. |
| [source home-browser.mjs:80] | Pass observations to the browser checker. |
| [source smoke-native.mjs:230] | Add five request classes to existing per-step and aggregate access-log counts. |

## 3. Evidence and checks run

- `node --check` passed for all three changed JavaScript files.
- Python `ast.parse(...)` passed for `home-check.py`, including after its final edit.
- Direct byte checks confirmed UTF-8 without BOM and no trailing whitespace in all five assigned files.
- `git diff --check -- <assigned paths>` passed; these inherited files are untracked, so direct checks supplied the meaningful whitespace verification.
- Installed interfaces inspected: Node `v24.18.0`, `@types/node` `24.13.3`, Playwright `1.54.0`.
- Read-only helper validation against J17 passed: one original Source, one matching fixture fact, all **nine** returned memory IDs preserved; missing-parent and mismatched-document cases rejected. [run G:/taki-first-use-orER2N/core-data/taki.db]
- In-memory classifier checks passed for nine representative requests and byte-offset handling. Historical classification accounts for all **4,375** primary Native log entries. [run .trellis/tasks/08-09-memory-operations-ui/research/first-use-runtime/results/2026-11-05T18-51-25.420Z/native.log]

The initial helper check exposed my incorrect assumption that one retain returns one memory ID. I corrected it and reran successfully. This was **not a journey run or established product defect**.

**Duration comparison:** every current step is **NOT RUN**, with duration **UNKNOWN**. All J17 entries below passed. [run .trellis/tasks/08-09-memory-operations-ui/research/first-use-runtime/results/2026-11-05T18-51-25.420Z/result.json]

| Step | J17 seconds | Current |
|---|---:|---|
| 1 — Boot/empty | 0.024 | Not run / UNKNOWN |
| 2 — Local onboarding | 5.541 | Not run / UNKNOWN |
| 3 — Setup | 9.716 | Not run / UNKNOWN |
| 4 — Activation | 12.213 | Not run / UNKNOWN |
| 5 — Capture/sync | 21.763 | Not run / UNKNOWN |
| settings | 7.213 | Not run / UNKNOWN |
| schedule — added | — | Not run / UNKNOWN |
| 6 — New Character | 54.350 | Not run / UNKNOWN |
| 6b — Post-ingestion | 106.850 | Not run / UNKNOWN |
| pending — expanded | 75.395 | Not run / UNKNOWN |
| 7 — Revalidation | 0.316 | Not run / UNKNOWN |
| 8 — Restart | 3.923 | Not run / UNKNOWN |
| 9 — Home reopen | 3.422 | Not run / UNKNOWN |
| 10 — v2 handoff | 24.203 | Not run / UNKNOWN |
| 10b — v3 application, added | — | Not run / UNKNOWN |
| 11 — Backup | 9.255 | Not run / UNKNOWN |
| 12 — Return Local | 213.484 | Not run / UNKNOWN |
| 13 — Re-entry | 364.573 | Not run / UNKNOWN |
| 14 — Current backup | 51.487 | Not run / UNKNOWN |
| 15 — Emergency takeover | 47.554 | Not run / UNKNOWN |
| 16 — Emergency restart | 6.735 | Not run / UNKNOWN |
| 17 — Paired restore | 42.434 | Not run / UNKNOWN |
| **Step total** | **1,060.451** | **UNKNOWN** |
| Native boot, separately | 45.518 | UNKNOWN |

**Request-count summary:** current counts are **UNKNOWN**. Historical classifier validation produced:

| Class | J17 |
|---|---:|
| Operation polls | 21 |
| Application-state body/part GETs | 2,344 |
| Health/version/compatibility GETs | 378 |
| Commits/body writes | 778 |
| Other | 854 |
| **Total** | **4,375** |

## 4. Trade-offs

- Scheduled attribution reads durable scheduler state every 100 ms without dispatching work. This adds observer overhead and an automatic observation window plus at least 65 seconds of manual-only observation. [source native-smoke.mjs:289]
- Added scheduling, failure/Home checks and v3 application expand journey duration; totals cannot be directly treated as optimization deltas against J17. [inference]
- Exactly-once checking uses verified replica Source/fact records and original receipts. Multiple extracted units remain valid; every returned ID must survive. [source native-smoke.mjs:154]
- Request classes describe primary Native access-log completions within step offsets. They exclude the separately launched paired-restore Native log. [source native-smoke.mjs:891]

## 5. Open items / UNKNOWN

- Run the prescribed detached journey once in a session with writable G: access.
- Current integrated retain, scheduled/manual behavior, failure/recovery Home rendering, v3 transitions/restore, timings and cleanup evidence remain **UNKNOWN**.
- No fresh full-suite, real-model, Tauri/manual or original-data acceptance is claimed.
- Returning-old-provider refusal and interrupted activation preparation remain open and were not added.

## 6. Anything outside scope noticed

No new product defect was established. Production source, template/prompt files and leader-owned documents were not edited. No task lifecycle command, Git mutation or service cleanup action was performed.