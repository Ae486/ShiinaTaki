# W5 DNS-correct ordinary continuation and first-connection-failure latch

**Delivered; synthetic validation PASS.** No actual working-pair data, credentials, DNS, model, PostgreSQL
or HTTP service was accessed by this implementation. The existing5102 sealed files remain byte-identical.

## Confirmed mechanism and actual evidence boundary

The existing `real_hindsight_network.install_guard` resolves `api.deepseek.com` once and keeps those IPs
in a process-local set. A later successful DNS query for the same allowed hostname can return a new IP,
which its original `create_connection` guard immediately refuses. A zero-network synthetic test proved
this exact behavior. The latest actual failures' telemetry did not retain the underlying exception chain,
so that run's cause cannot be declared proven from the synthetic result alone.

Parent reported that the bounded A run ended at count484 after183 attempts:24 HTTP200 with usage and159
without a response. Its original completed work and sources were preserved, Core recorded unknown through
the ordinary driver, and owned services are stopped. This wrapper does not change those counters, results,
completed actions or prior evidence, and grants no new allowance.

## New entry and unchanged execution ownership

`w5-working-network-continuation.py` delegates to the sealed `w5-working-recovery.py` entry. It retains
the original migration proof, working-root/credential custody, source verification, same admitted transition,
exact per-Bank approval, finite cap, original driver and cleanup. Its only CLI arguments are the existing
entry's arguments. No root, DSN, stage, renewal, TLS or proxy override is added.

Default invocation is inert:

```powershell
& H:/hindsight/.venv/Scripts/python.exe -B -s .trellis/tasks/09-29-hindsight-transitions-emergency/research/w5-working-network-continuation.py
```

For a later separately authorized continuation, verify the delivered successor-manifest SHA256, use a fresh
Python process and add `--run-reviewed-working-copy --maintenance-approval <exact-parent-review-file>
--submission-cap <approved-finite-cumulative-cap>`. This is syntax guidance, not approval for a new cap.
The already exhausted nonempty Bank approval/cap484 now refuses **before service startup**. An explicit
`banks=[]` approval retains the existing no-model plan-observation path, still validated by the sealed gate.
A missing approval retains the old cap301/no-model semantics. A prior NEW connection-failure latch also refuses startup, even if its file
is incomplete. There is no automatic latch-clear or counter-reset option.

## Narrow network correction

- Wrap the actual `socket.getaddrinfo` call. Only successful results for exactly `api.deepseek.com:443`,
  with model access already enabled by the old guard, may update that guard's returned address **set in place**.
- Accept only matching IPv4/IPv6 TCP stream answers on443 whose addresses are public, unicast and specified.
  Preserve both canonical and resolver spellings of an accepted address. Never allow failed DNS, another
  domain/port, a raw-IP lookup, private/loopback/link-local/multicast result or an unapproved model run to
  add addresses. Original known addresses remain available for in-flight connections.
- The original audit callback and `create_connection` guard still make the allow/refuse decision. Observe
  actual refusals without replacing their semantics. Per-Bank gate rejection of raw-IP HTTP requests and
  foreign transitions remains intact. Existing owned PG/HTTP loopback access remains intact.
- Do not rewrite any HTTP request or transport; normal hostname/SNI, certificate verification and the old
  clean-environment/no-proxy rules remain in force. There is no external connectivity/model probe.

## Content-free evidence and conservative failure stop

Each actual supervisor attempt writes NEW
`working-network-evidence/<supervisorAttempt>/events.jsonl`. The old `run-result.json` additionally references
that file under `networkContinuation`, with the new source-manifest hash and diagnostic completeness count.

Events include initial allowed addresses, successful model DNS answers/new addresses, addresses the original
snapshot would have refused, and actual connection attempts to newly allowed addresses. Thus a
`rotated-model-address-connect` event proves that an actual selected destination would have been refused by
the old set; a DNS-only event does not claim that the new address was selected. Actual guard refusals retain
only event/host/port/fixed refusal code.

Original HTTP send failures record a bounded cause/context/exception-group chain with an explicit whitelist
of exception type names and known source stack locations. Messages, args, payloads, headers, authorization,
credentials, provider response bodies and traceback locals are never serialized. Unknown/custom types map
to `other`. Diagnostic failure preserves the original raised exception and blocks further model work.

On the first transport/OSError/actual guard-refusal failure, persist NEW
`working-model-connection-failure.json` with the owning attempt and already reserved submission number.
Further model sends are refused **before both the per-Bank reservation and cumulative budget increment**.
Existing reservations/in-flight requests remain conservatively counted; nothing is decremented. Non-model
owned loopback requests continue. HTTP status responses remain original responses and do not become a fake
connection failure or billing refusal. Cancellation is not misclassified as a connection failure.

The Native SDK/consolidation's existing finite exception/retry/split behavior is unchanged. This prevents
additional network calls and reservations after failure but does not claim immediate Native attempt
termination. No artificial billing error, task cancellation, fabricated maintenance state or alternate
transition outcome is introduced. Normal parent-owned cleanup remains the existing driver's responsibility.

## Concentrated verification

- Ruff E/F/I (Python3.11), format and ty: PASS for the two NEW Python files.
- Eleven synthetic tests PASS: inert/unchanged CLI; real old-guard DNS rotation; unchanged TLS inputs;
  domain/port/proxy refusal; owned loopback preservation; raw-IP lookup refusal to refresh; failed/private DNS
  answers; no-model DNS denial; first-failure persistence before both reservations; unchanged original
  exception and redaction; no-approval/raw-IP/foreign-transition gate rejection; exhausted/latching startup
  refusal; bounded grouped exceptions and cancellation classification. The final affected compatibility
  test also passes: exhausted nonempty approval refuses startup, while empty-Bank observation still delegates
  the unchanged arguments to the sealed entry. No second full suite is needed for this narrow branch.
- DNS and connect delegates are synthetic. The old guard callbacks and production budget/gate are exercised
  against temporary test files only. No real model/network request, new PostgreSQL, HTTP/performance suite,
  corpus conversion or actual working-root read occurred.

Machine evidence is `w5-working-network-checks.json`. The successor inventory preserves all5102 prior entries
and adds only this implementation/report/test/check evidence and the predecessor manifest itself. No production
spec update, task-pointer change, commit, push or archive is part of this task-only correction.
