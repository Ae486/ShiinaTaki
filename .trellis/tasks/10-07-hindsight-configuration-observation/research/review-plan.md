# Stage 5A independent review plan

## Cadence and rationale

5A crosses Native authorization/runtime, Shared transport, Core identity/state and Home presentation.
It receives focused implementation tests at each contract boundary and one consolidated independent check
after the whole vertical slice. Do not merge its acceptance into the later template/deployment changes.
One implementer owns all shared registries/version changes. After the schema handoff, a second implementer
owns only Home/frontend files. One checker takes ownership after both releases.
Read-only 5B research may run concurrently without source writes or heavy verification.

## Required dimensions

| Dimension | Evidence required |
| --- | --- |
| Authorization | Actual authenticated route and Core dispatcher; default denial, exact schema/Bank grant, wrong credential/role/allowed Bank, validator denial and throwing/custom hooks. Unauthorized requests must not inspect profiles or Bank existence. |
| Confidentiality | Key/endpoint/path/header/prompt/error sentinels absent from all response, read-model, UI and diagnostic paths; ordinary config/health contracts unchanged; safe bounded identifier grammar enforced. |
| Genuine runtime and partial coverage | Bound constructor values win over conflicting environment text. Exact supported providers only; routed/custom/worker/embedding/reranker remain explicit unknowns. Engine session is stable for its lifetime and changes on replacement. |
| Zero side effects | Fail-on-call providers/initializers and read-only database fixtures reject model calls, Bank creation, identity initialization, config writes or authority adoption. Explicit health stays a separate action. |
| Wire and transport | Native/Shared strict schema parity, finite version/build support, nonce/Bank identity, malformed/oversized payload, bounded ordinary-read deadline and no raw exception projection. Review generated API/client changes. |
| Core lifecycle | Captured connection/config/secret/setup revision/epoch and pinned Bank identity are checked before publication; same-target coalescing, competing requests, runtime replacement, monotonic expiry, failure after success, eviction and restart are truthful. |
| Home truthfulness | Real client/controller mounting and refresh, desired vs observed distinction, partial/unknown/mismatch/denied/unavailable/stale/loading states, reconnect/remount and second observer; no browser-owned evidence or false readiness. |
| Compatibility/regression | Old Native without feature and new Native with denied grant remain usable; mandatory transition/source/application/result gates preserved; changed whole manifest rejects stale preview, fresh proof works; accepted W9 source remains intact. |
| Maintainability | Existing modules/registries reused, no duplicate types or operation ledger, clear responsibility/header/index/spec updates, no new platform coupling or unsolicited dependency. |

## Validation policy

Inspect actual scripts. Run focused Native tests plus affected contract-generation/lint/type checks; run relevant
Shared/Core/Desktop suites, workspace typecheck, root lint and Desktop build. Prefer one consolidated package
pass after integration rather than repeated complete suites per file. Existing failed logs remain evidence.
The final check covers the full 5A diff against the recorded pre-implementation baseline, not only the last patch.
Reuse exact-source passing results when the checker independently confirms their scope and identities; rerun
or broaden for a changed source, actual failure, missing dimension or unresolved integration concern.

No Rust production changes are planned; re-evaluate Rust checks if the real diff touches Shell or its bindings.
No original data, live grant/deployment, model calls, manual/installed WebView2 or fleet attestation is claimed.
No wall-clock test threshold increase without measured fixture evidence; never weaken functional assertions.

## Findings and handoff

Report findings by severity with source reference, trigger, consequence and regression. Checker directly fixes
bounded implementation/spec drift, then reruns affected checks; material design changes return to leader.
Record actual commands, exits, counts, source/generation identities and teardown. Mark each PRD criterion from
real evidence only. Remaining Stage 5/6 items stay separate. Do not commit, push, finish or archive.
