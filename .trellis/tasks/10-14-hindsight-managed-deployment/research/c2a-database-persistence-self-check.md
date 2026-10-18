# C2a database persistence implementation self-check

Date: 2026-10-15. Implementer: `/root/c2a_database_implement`.

**Scoped static checks PASS. Runtime NOT RUN.** The implementation is released for independent
exact-byte review. Root retains all preparation/build/runtime/resource/metadata ownership.
`deploymentReady` remains false; this task fixture supplies no Native API or C2b ready receipt.

## Written files and bindings

| File under `research/` | Bytes | SHA-256 |
| --- | ---: | --- |
| `docker-database/fake_child.py` | 44233 | `4c1f401e9d1e43a8dcdc3c241cb74a05b892a53e57be958bd3096725a16c171c` |
| `docker-database/database-read.py` | 6084 | `b3dd31c1c527850d188a1f09213756cefef8cd511266275fb0c47d342b322c3f` |
| `docker-database/run-persistence.ts` | 51340 | `46a1b0b3f13816bbd56b46b1c279724ef7e52bdf75453d7addd8eda6cb01f7b0` |
| `docker-database/README.md` | 21343 | `e2ef5c3b316e15226fb56f091e06c728511a251824a5ad23420ff5d7ebe1b12f` |

Only those four files and this self-check Markdown/JSON were written in implementation. The
[JSON record](c2a-database-persistence-self-check.json) retains raw check commands/results,
first failures, repairs, preserved fixture hashes and all twelve original Native context entries.
All four files are UTF-8 without BOM or CRLF. Accepted `first-start.py` remains byte-identical
at SHA-256 `7d1ee67f7b3027da781795e365b58a9cb93f847cdba7cc31425f05030d2f7ff6`.
No production, shared fixture, template, dependency, task metadata or other owner's file changed.

The design inputs remain the [original plan](c2a-database-persistence-plan.md), SHA-256
`186f60061a4ecd7ac26443f90c079225c3bc9efb782f27227b50763ff0088e4c`, and
[independent design PASS](c2a-database-persistence-design-review.md), SHA-256
`bade2cab57318c88d19b5f66684f3a708fee2e3349f2c543874db3b2f1be628a`.

## Actual checks

| Check | Result / boundary |
| --- | --- |
| Python AST and in-memory compile | Both files PASS with existing Python 3.12.7; no target main runs. |
| Ruff E/F/I and format check | Both files PASS with isolated/no-cache checking; no bytecode/cache output. |
| Node `--check` | Launcher PASS; syntax only, no imports/application execution. |
| Scoped ESLint `--no-ignore` | Launcher PASS, no warnings. Exact task-only size directives preserve cohesive sequences; production limits are unchanged. |
| Single-entry TypeScript noEmit | PASS, diagnostics `[]`, incremental disabled; no build tree or emitted file. |
| Actual `stream_hits` helper | Four synthetic regular-file cases PASS: no match, whole-chunk match, split-boundary match and no overlap double count. |
| Frozen prerequisites | First-start source hash retained; reviewed plan/design hashes match. Fresh S/W are absent. |

The scanner check imports only the stdlib task module without calling main. Four small temporary
G: files (350, 223, 333 and 278 bytes) are automatically closed/removed; it executes no SQL,
process supervisor, Docker, application or fixture startup. It tests the real streaming function
with 128-byte chunks while production task scanning uses its fixed 1 MiB default.

First static results are retained: one Python SQL-literal line-width error, two optional argv
index errors, and one unused ESLint directive. These were corrected; a subsequent necessary
identity assertion raised the coherent restart function to 51 lines, so its existing task-only
size exemption now has an explicit ordering rationale. Final checks pass. No broad suite was run.

Package context discovery used the existing `G:/anaconda3/python.exe` after `python3` resolved
to the Windows Store alias. No interpreter install, PATH edit or dependency change was needed.

## Contract review

- **Reuse and isolation:** the wrapper adapts accepted first-start bounded operations and imports
  existing `enable_linux_reaping`; it does not add another ctypes helper or import Native API/
  provider modules. Only staged `fake_child.py` changes in the unchanged eleven-module recipe.
- **Input and timing:** independent fake/dotenv validation precedes the five-second liveness
  marker. DB descendants receive a fresh allowlist after fake references/environment are cleared.
  SQL verification has a separate 60-second clock. A stopped marker never proves SQL readiness.
- **Data:** first generation uses one pg0 dispatch, explicit SQL BEGIN/COMMIT and a fresh connection
  to verify a deterministic 4 KiB logged row. Second generation requires the original clean-stop
  manifest/source/tool/cluster facts, starts raw postgres once and uses SELECT only.
- **Supervision:** actual postmaster ancestry/start identities and logger are recorded. First
  postmaster is adopted; second uses its Popen wait. Generic adopted-child wait excludes known
  direct Popen handles. pg_ctl fast stop, reaping, pg_controldata, full stopped-volume scan and
  final publication share 25 seconds. The final 0.5 seconds is reserved inside that same budget
  for reporting; no external timeout is extended. First failures survive successful cleanup.
- **Admission and preservation:** the existing relay binds the unchanged request/control/Effect
  to its held execute (which has control, not another Effect body). A separate ten-second hold
  timer closes on failure. The original first-stop bytes/SHA are saved before second resume;
  final stop is read from the same stopped CID's exact small report path.
- **Cleanup:** protected files are fully scanned after the fixture processes/helper are reaped.
  Only exact original CID/V/new-tag resources are removed. Native PowerShell removes the verified
  W tree from S, avoiding an active working directory inside the deletion target. Root alone
  archives/removes S and compares unrelated workload state.

## Root handoff

Use [README Stage 3](docker-database/README.md) for exact preparation and command arrays. Token is
`20d996bf-64b6-47c7-908d-730ebdb371c4`; S is
`G:/TakiAgent-c2a-database/persistence-20d996bf-64b6-47c7-908d-730ebdb371c4`, W is
`C:/taki-c2a-db-persistence-20d996bf-64b6-47c7-908d-730ebdb371c4`, and tag is
`taki-c2a-db:20d996bf-64b6-47c7-908d-730ebdb371c4`. None was created by this agent.

The Stage 2 README now links actual accepted runtime/preservation evidence and marks old resources
unavailable for reuse. Its original static/runtime snapshots remain unchanged in the archive.

Independent review and actual execution remain required. Process adoption/reap timing, two real
SQL generations, original-volume persistence, complete stop/scan/report deadlines and Engine
facts have not been established by these static checks. No Docker/WSL, application, image/Host/
Rust build, old 182-case matrix, original data/key/model or Git lifecycle action ran here.
