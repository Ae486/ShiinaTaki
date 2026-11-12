# Initiative deterministic E2E stability diagnosis

## Result and scope

A reachable test-fixture transport defect is fixed: the host can allocate an ephemeral HTTP port that the Fetch
standard forbids. All three Fetch-facing E2E provider/relay fixtures now reject such an allocation before exposing
their endpoint. This changes no production Runtime, retry policy, request contents, assertion, timeout or host setting.

The original failed runs did not retain their provider ports or SQLite databases. Their exact historical cause
therefore remains unproven. A controlled production-Core reproduction matches both observed failure shapes, including
the silent Run's approximately six-second delay, zero provider requests and Attempt state version 8.

Work remained in `H:/TakiAgent-worktrees/t4`, branch `task/t4-skills-mcp-productization`, under the session-bound
`10-25-agent-delegation-conversations` task. The unrelated global task pointer was not changed. No credentials were
read, real model calls made, operating-system settings changed, or Git delivery performed by this diagnosis.

## Original evidence

Evidence paths below are relative to `target/agent-delegation-20261030-validation/` unless stated otherwise.

| Evidence | Observed facts | Limit |
| --- | --- | --- |
| `e2e-delivery-final.log` | 93 passed / 28 skipped / 1 failed; silent scenario failed with `initiative_decision_failed`; provider requests 0 and errors empty; Attempt ran for 6.119 seconds with about 60 seconds of validity | Provider port, original exception and DB were discarded |
| `initiative-silent-recheck.log` | Isolated silent rerun passed | Does not resolve an intermittent failure |
| `initiative-runtime-final.log` | 16 passed / 1 failed; held-crash scenario returned `settled` where `held` was expected | `settled` alone does not establish successful delivery |
| `initiative-stability/diagnosis-run-01.log` | Evidence-retaining control before the port fix: 17/17 passed, 118.99 seconds | A passing control is not a root-cause fix |

`packages/core/src/initiative/initiative-runtime.ts` catches the error from reasoning/delivery, settles the Run with
`initiative_decision_failed`, and returns `status: settled`. This explains why the old held assertion alone cannot
distinguish delivery completion from a pre-delivery failure. No production logging/instrumentation was added.

## Verified mechanism and controlled reproduction

- Live `netsh int ipv4 show dynamicport tcp`: start 1024, count 13977, hence 1024 through 15000 inclusive.
- Runtime: Node `v24.18.0`, bundled Undici `7.28.0`.
- The existing scripted provider called `server.listen(0, "127.0.0.1")` and returned any assigned port.
- A local HTTP server bound to 6000 successfully. Node Fetch rejected it with `TypeError: fetch failed`, cause
  `bad port`, before its request handler ran. An ephemeral port 13693 returned HTTP 200 and one request.
- The live Fetch specification's [bad-port table](https://fetch.spec.whatwg.org/#bad-port) includes 6000 and several
  other ports in the host's dynamic range. Its 83 entries are retained in `initiative-stability/whatwg-bad-ports.json`.
  The installed Undici table is separately retained in `installed-fetch-bad-ports.json`; it matches the relevant
  nonzero entries. No Node-private API is used by the delivered helper.

`initiative-stability/port-probe.mjs` changed only the parent diagnostic process's next scripted-provider bind to
6000, restored the built-in bind function before Core startup, and used the actual isolated production Core,
initiative composition, SDK and SQLite owners. It supplied a synthetic selected opportunity with 60-second validity.

| Forced 6000, before fix | Dispatch elapsed | HTTP requests | Run / Attempt facts |
| --- | --- | --- | --- |
| Silent | 6190 ms | 0 | `settled`, Run failed, Attempt state version 8, three failed model Effects with `provider_error` |
| Express with hold gate | 6193 ms | 0 | Same facts; fails before entering held presentation |

Raw evidence: `initiative-stability/port-probe.log`, `port-probe/silent/result.json`, and
`port-probe/express/result.json`, with each isolated database and process output retained.

After the fix, `port-probe-fixed.mjs` forced only the first allocation to 6000 and allowed ordinary allocation after
its rejection. This validates the real fixture integration, independently from the automated allocation stub.

| Forced first allocation, after fix | Actual allocations | Dispatch elapsed | Result |
| --- | --- | --- | --- |
| Silent | 6000, then 8556 | 393 ms | Completed, exactly one provider request |
| Express with hold gate | 6000, then 8583 | 337 ms | Held/waiting, exactly one provider request |
| Express after fixture-owned crash/reopen | Same accepted provider | Separate startup/recovery | Original Run failed truthfully; resume refused; request count remained one |

Evidence: `initiative-stability/port-probe-fixed.log`, `port-probe-fixed/{silent,express}/result.json`, and
`port-probe-fixed/express/restart.json`. The scripted responses omit usage as before, so their model Effects retain
`provider_usage_missing`; this is not a newly fabricated usage count or a new calibration observation.

## Delivered changes and tradeoffs

- `e2e/src/initiative-runtime.e2e.test.ts`: explicit `TAKI_E2E_EVIDENCE_DIR` retains each scenario's isolated data plus
  `before-teardown.json`, `process-output.json`, and `teardown.json`. The DB snapshot precedes shutdown and contains
  bounded Run/Attempt/Effect/event/delivery/opportunity rows. Process logs are bounded. Cleanup attempts every owned
  resource and preserves the original scenario failure. Without opt-in, owned temporary directories are still removed.
- `e2e/src/fixture/loopback-http.ts`: keeps the bound listener while checking the standard bad-port set, closes a
  rejected listener, and tries at most 16 ephemeral allocations. It sends no health or model probes. Bind errors and
  missing addresses fail explicitly; exhaustion leaves no listening server. The finite bound avoids an unbounded
  harness hang on an incompatible host allocation policy. The standard table is explicit and must be revisited if
  Fetch adds blocked ports.
- `scripted-provider.ts`, `real-provider-observer.ts`, and `agent-context-timing-relay.ts`: use the same binder. Their
  response bytes, request accounting, streaming, backpressure, cancellation, evidence and teardown owners are unchanged.
- `loopback-http.e2e.test.ts`: simulates an OS-reported 6000 allocation without requiring a globally free fixed port,
  verifies replacement and zero probe requests, then verifies an actual streaming request. Also covers 16 forbidden
  allocations, bind error propagation, missing address and closed failed listeners.
- Existing observer/timing relay local HTTP test upstreams use the binder too; fixture `index.md` documents it.

The source before each changed existing fixture is retained under `initiative-stability/preimages/`. No generic WS
port allocator or native component was changed. Similar port selection elsewhere is outside this verified HTTP scope.

## Checks and reproducible commands

Run from the worktree root. A dummy environment file prevents accidental real-provider configuration loading; the
selected suites use local scripted HTTP only. Clear inherited real-provider opt-in flags before any broader suite.

```powershell
$env:TAKI_E2E_REAL_ENV_FILE = 'H:/TakiAgent-worktrees/t4/target/agent-delegation-20261030-validation/no-real-provider.env'
$env:TAKI_E2E_EVIDENCE_DIR = 'H:/TakiAgent-worktrees/t4/target/agent-delegation-20261030-validation/initiative-stability/recheck'
pnpm --filter @taki/e2e test:e2e src/fixture/loopback-http.e2e.test.ts src/fixture/real-provider-observer.e2e.test.ts src/fixture/agent-context-timing-relay.e2e.test.ts
pnpm --filter @taki/e2e test:e2e src/initiative-runtime.e2e.test.ts
pnpm --filter @taki/e2e typecheck
```

- Scoped ESLint for the changed test/fixture TypeScript: PASS.
- E2E typecheck: PASS.
- Three local HTTP fixture suites: **19/19 PASS**, 15.65 seconds; `initiative-stability/fixture-regressions.log`.
- Controlled post-fix actual Core silent/held/crash-reopen probe: PASS as detailed above.
- Exact delivered bad-port table comparison against the fetched WHATWG table: PASS, 83 entries.
- Scoped `git diff --check`: PASS (existing CRLF normalization notice only).
- Full post-fix initiative file: **17/17 PASS**, 175.57 seconds; `initiative-stability/diagnosis-run-02-fixed.log`.
  All 17 scenario directories retain an available pre-teardown SQLite snapshot, final process output and teardown
  evidence. The final evidence audit found no cleanup errors or still-running recorded Core process.

The standalone before/after probe scripts record their original source state and fixed output directories. For a new
manual run, choose a fresh output directory; do not combine a new seed with their retained historical databases.

## Remaining limits

The old two failures cannot be conclusively assigned to port 6000 or any other discarded port. The fixed issue is
independently reachable and reproduced, rather than inferred from a passing retry. This focused work does not convert
the earlier full-suite failure into a full-suite pass, and does not establish real-model or human/native acceptance.
