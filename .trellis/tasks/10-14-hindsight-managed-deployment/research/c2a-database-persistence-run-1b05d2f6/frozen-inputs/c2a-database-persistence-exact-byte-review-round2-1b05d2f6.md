# C2a persistence: independent exact-byte review, round 2

Case: `1b05d2f6-494c-4a6d-a601-1e807eca1486`. Reviewer and execution owner: `/root`, independent of the submitted implementation.

**Phase A technical verdict: PASS.** Phase B execution remains subject to resolving the explicit preservation-order conflict below. No fixture, README, plan, accepted manifest, production source or Git metadata was changed.

## Verified current bytes

| File | Bytes | SHA-256 |
| --- | ---: | --- |
| `docker-database/run-persistence.ts` | 56502 | `c39fd6e465f922cefd198abe1e6d531d731359f8969b183ae9b5b4d2cf06ee27` |
| `docker-database/database-read.py` | 6084 | `4bd830c60a4ddecc4e8e7018d2b19eb08093c81fc5d7f3ee0a8ff380178e4271` |
| `docker-database/fake_child.py` | 44233 | `9d65b8875e5d798a024dff9b4a182d6cff7bf4b62646954e38cd0c2e12ce3819` |

## Per-check results

1. **PASS — hashes and substitutions.** Replacing only the current helper with the helper recorded in the round-1 review reconstructs the complete 56090-byte launcher at SHA-256 `b3736ef4cd510023434ea8f0864296f2970fec02892543af370a324595ec6f76`. Reversing only CASE then yields `c35ccae8cd1253845e06e9e37fd5a339b4d79a629da967fc5dd6f10b0ce68d53`. The two Python token reversals yield `0ad82eb436c9c4389852c07ddb7c28eed6e9b5cd59740fb71c1ebb42db243419` and `427bc9e824e4a1dacadf29acca4d0e57faed1800a41972eb4c7797fc5b974800`. Exactly one CASE occurrence and one differing token line per file: launcher 32, reader 18, child 23. Both Python files are otherwise unchanged.
2. **PASS — `engineTime`, lines 113–127.** Regex accepts UTC `Z` only with optional 1–9 fractional digits. Year, month, day, hour, minute and second round-trip through `Date.UTC` and UTC getters. Invalid dates/hours fail `requireFact`, whose default error is `C2A_CHECK_FAILED`. No host-clock fallback, `Date.parse`, catch, tolerance or retry. It returns the trimmed original string, preserving nanoseconds. The Docker call remains `info --format {{.SystemTime}}`, 10000 ms maximum, 4096 bytes maximum.
3. **PASS — independent seven-input Node execution.** The harness extracts the current helper and current `requireFact` from hash-verified source, strips TypeScript using the installed compiler, and executes them in a VM with a mock Docker exchange. It does not import or execute the launcher. Each case made exactly one mock exchange and requested the original budget. Actual Node v24.18.0 output is retained in `static-checks.json`, with structured results in `phase-a-byte-checks.json`.
4. **PASS — bounds and unchanged behavior.** `persistenceCase` derives `since` from `await engineTime()`. `inspectExecs` derives `until` once and passes the same since/until strings to both container and volume queries. The complete-file reconstruction proves all code outside the helper is unchanged from round 1, including existing assertions, thresholds, budgets, retries and failure codes.
5. **PASS — Native pins.** The Dockerfile and all eleven upstream managed_bootstrap modules match the self-check pins. Expected staging replaces only `fake_child.py`. The accepted source manifest itself still hashes to `f27379be3b4b5e61e1b2821c2eda2d87bf54e5c2983b034bdb637ee789961ae2`; all 109 live source entries match.
6. **PASS — static checks.** Single-entry TypeScript compiler `noEmit` check: exit 0, zero diagnostics. Scoped ESLint with `--no-ignore`: exit 0, no output. No dependencies installed or emitted source generated.

| Independent input | Actual result |
| --- | --- |
| `2026-10-15T12:49:45.123456789Z` | ACCEPTED; exact original returned |
| `2026-10-15T12:49:45Z` | ACCEPTED; exact original returned |
| `2026-02-30T00:00:00Z` | REJECTED: `C2A_CHECK_FAILED` |
| `2026-13-01T00:00:00Z` | REJECTED: `C2A_CHECK_FAILED` |
| `2026-10-15T24:00:00Z` | REJECTED: `C2A_CHECK_FAILED` |
| `2026-10-15T12:49:45.123456789+08:00` | REJECTED: `C2A_CHECK_FAILED` |
| `not-a-time` | REJECTED: `C2A_CHECK_FAILED` |

## Execution preservation-order conflict

The frozen launcher's final `finally` block calls `cleanup()` on both success and failure before it calls `writeEvidence()` or emits the launcher JSON. `cleanup()` removes the owned CID, volume, image tag and protected Windows root; S remains retained. Therefore `persistence.json` and the final launcher stdout cannot exist before that cleanup. This documented Stage 3 behavior conflicts with the new literal requirement to preserve all listed evidence before cleanup and preserve everything after failure. This finding does not invalidate the calendar fix, but execution cannot satisfy both contracts without clarification or a separately reviewed source change. The owner has been asked to choose between the existing Stage 3 cleanup with all S evidence retained, and stopping before execution to revise the lifecycle. No assertion is weakened and no source is patched by this reviewer.

Evidence directory: [c2a-persistence-review-round2-1b05d2f6](c2a-persistence-review-round2-1b05d2f6/). Prior round-1 and author self-check records remain intact.

## Phase B: read-only preflight, execution not started

The independent Phase A PASS was recorded before any Docker call. Read-only preflight at `2026-10-18T12:17:20Z` confirmed Docker access is available in this execution context, all three binary pins match, the explicit Engine ID/version and cached base match, and S, W and the result tag are absent. No new staging directory, context, image, container or volume was allocated. Build and launcher invocations are both **0**; the case token is unconsumed. There is no new image ID, launcher JSON, casePassed, event-count/submit/exec result, first/final stop validation or cleanup result to report.

The initial cardinality guard reported `SEVEN_EXISTING_CONTAINERS` because Docker returned **8** IDs. Read-only inspection established that all historical seven IDs remain present, plus the unrelated running `/taki-openbili-backend` (`1e389e0a2f95121ca804c186c20916196e9e46f67a7691c3d184404a7292deb8`, started `2026-10-18T05:55:39.597065125Z`). All eight must be protected by any future execution. No container was stopped, restarted, removed or mutated. This is a preflight observation, not a failed persistence-case assertion, and no case assertion was changed. Redis and arboris have newer start times than the historical October 15 snapshot; both current starts predate this review.

| Read-only measurement | Before | After | Difference |
| --- | ---: | ---: | ---: |
| G: free bytes | 138496225280 | 138496225280 | 0 |
| C: free bytes | 25589501952 | 25588674560 | -827392 |

Both satisfy G >= 20 GiB and C >= 1 GiB. These are whole-drive changes during the preflight, not experiment consumption. Engine time was `2026-10-18T12:17:20.098681161Z`, bracketed by Windows client timestamps `2026-10-18T12:17:20.476Z` and `2026-10-18T12:17:20.672Z`. This demonstrates the live clocks are distinct; no clock adjustment or tolerance was introduced.

No owned cleanup is required. S and W were rechecked absent, and the unique tag was absent in the preflight query. Existing prior-case evidence remains untouched. Full structured review, static outputs, exact read-only command arrays, eight-container inventory, historical comparison and free-space values are in [the round-2 JSON report](c2a-database-persistence-exact-byte-review-round2-1b05d2f6.json).

Execution is pending the owner's answer about the frozen launcher's cleanup ordering (`cleanup()` at line 815; `writeEvidence()` at line 819; stdout at line 821). Proceeding without that answer would either violate the explicit preservation requirement or modify the prohibited frozen launcher.
