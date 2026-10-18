# C2a database extraction implementation review

Date: 2026-10-15. Reviewer: `/root/c2_design_check`.

**PASS after one local failure-recording fix.** The released fixture is ready for Root's documented
once-only execution. Runtime is **NOT RUN**, and `deploymentReady` remains false.

Reviewed against the accepted [extraction plan](c2a-database-extraction-plan.md)
(`9996da457893c5bc42505f3aad234ff3937e47c8ef0bd2c7ae84c14fa9b0aa1d`)
and [design review](c2a-database-extraction-review.md)
(`d013bdf26592630cabe80bc71e1774c62281c0dd653e9955e31a6d0a8089958c`).

## Findings (fixed)

- File: `docker-database/first-start.py:267`, `command()`
- Issue: An initial command exception was not recorded until control returned to main. The intervening
  `finally` can also throw during utility kill/reap or log collection, replacing the original cause.
- Fix: Record the original exception through the existing first-write-only `fail()` before entering
  that cleanup, then re-raise. The four-line addition changes no command, process lifetime, deadline,
  path, storage/output limit or startup/stop sequence.

The self-check now binds the corrected source and fresh checks. Its original failures, successful
implementer checks, old input hashes and readback are retained explicitly as pre-review evidence.

## Findings (not fixed)

None within the implementation. Actual bundled-tool availability and Linux startup/shutdown
behavior remain the intended runtime prerequisites, not facts established by static review.

## Contract review

| Contract | Verified implementation |
| --- | --- |
| Single offline startup | One fixed pg0 start dispatch, one SQL connection and one fixed SELECT. CLI hash/version/help precede startup. No wrapper import, alternate version/PATH, asset fetch, retry, Docker API or extra probe stage is added. |
| Environment and storage | Environment is cleared before psycopg2 import; all child environments and paths are literal allowlists. The script requires PID 1, UID/GID 1000 and an empty owned seed before creating only its prescribed directories. |
| Shared deadlines | Signal handlers precede preparation. Shared monotonic startup/operation/whole clocks and repeating SIGALRM cover the 60-second startup, command caps, async SQL and bounded file/hash work. Stop/reap/control evidence shares one 25-second clock; the payload retains its 180-second limit and Root's independent outer bounds. |
| Live identities and SQL | CLI proc facts are captured while live, before waiting for CLI exit. Async SQL keeps the backend connection open while matching backend parent, actual postmaster PID/start/executable, PID file, metadata, data directory, durability settings and cluster identity. |
| Raw tools | Four exact regular/resolved ELF paths receive bounded hashing/access checks and version calls. SQL and utility output must match PostgreSQL 18.1; the expected extraction directory remains 18.1.0. |
| Checked shutdown | Revalidate the original postmaster, call one raw pg_ctl fast stop, require actual clean wait/reap, absent PID file and no descendants, then require matching pg_controldata identifier and state `shut down`. The fixture does not equate CLI exit with readiness or pg_ctl return with complete process cleanup. |
| Failure and evidence | Original errors now precede utility cleanup errors in first-failure recording. Timeout/signal/bounds, forced utility cleanup, missing evidence or output omission remain failures. Output and volume monitoring stay bounded; Root owns exact container/volume/staging cleanup. |

Read-only inspection of PostgreSQL REL_18_1
[pg_ctl.c](https://github.com/postgres/postgres/blob/REL_18_1/src/bin/pg_ctl/pg_ctl.c#L713)
confirms that its stop wait accepts PID-file disappearance. The fixture additionally requires actual
zero-exit postmaster reaping; it does not assume that the utility reaps an adopted child. The source
text SHA-256 is `41cfc7187149b0c810524d644e80eb5c1ca41ab86fc99bca8833118ef0a5fea0`.
No PostgreSQL executable was run during this review.

## Verification

- AST and in-memory compile: **PASS**, fresh check after the repair, using installed Python 3.12.7.
- Lint: **PASS**, fresh Ruff E/F/I check with the existing isolated 100-column configuration.
- Format: **PASS**, fresh Ruff format check.
- TypeCheck: **not applicable** to this Python-only fixture; no static type-check result is claimed.
- Behavior tests / target Linux Python 3.11.16 / database / Docker / WSL / build: **NOT RUN**.

The three affected checks ran at `2026-10-15T10:39:57.692Z`; raw commands/results are retained in
[the updated self-check](c2a-database-extraction-self-check.json) and
[the machine-readable review](c2a-database-extraction-implementation-review.json).
No unchanged suite or metadata probe was repeated.

## Released inputs

| File | Bytes | SHA-256 |
| --- | ---: | --- |
| `docker-database/first-start.py` | 28600 | `7d1ee67f7b3027da781795e365b58a9cb93f847cdba7cc31425f05030d2f7ff6` |
| `docker-database/README.md` | 12772 | `c304db7acf32830bea23d98b00a45941ff19f0b76a9bde705ce6c1c9ba176e05` |
| `c2a-database-extraction-self-check.json` | 23269 | `1f4385ff6f14449f7f8822b586bf0b60dd99e22fe7f4eca006386a5640baf9da` |

Changes are limited to the four-line source repair, self-check evidence update and these two review
reports. README, the original metadata probe, recovery fixtures/R1 evidence, production, task metadata
and other owners' files are unchanged. No spec synchronization is needed for this task-only repair.

Ownership is released to Root. After recovery releases the execution slot, Root may freeze the new
UUID/container/volume/staging bindings and run the exact reviewed stdin payload once. A runtime PASS
still requires actual SQL/tool/process/control-state evidence and owned cleanup. Admitted database
startup, original-volume restart/persistence, C2b, Native API/provider, C1 service and manual acceptance
remain separate.

