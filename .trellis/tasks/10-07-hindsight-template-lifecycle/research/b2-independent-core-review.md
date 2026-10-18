# B2 Core independent review

Verdict: **PASS for the dispatched B2 Core scope after one lifecycle fix.** Combined B2 acceptance, B3 and
whole-5B acceptance remain with root. Main HEAD is `2e244d0fdee49fb2c582a4333a9ef1573fa9112a`.

The review used the original 101-file release and its 1939 unique frozen check inputs. Entry evidence is
`b2-independent-core-source-before.json`; final changed-source/dependency identities are in
`b2-independent-core-final-source.json`. Native sources, generated clients and the seven accepted label files
remain outside this review's write scope. Root's later five B3 context references do not expand this B2 review.

## Finding fixed: detached Apply could outlive SQLite

`template-execution-service.ts` awaited the entire rollout directly. An already sent Apply that ignored abort
could therefore keep the old executor alive after W6 detached its generic operation. Following actual
`main.ts:570-588` shutdown order then closed SQLite before that Apply completed. The retained red observed
three late access attempts: publication SELECT, a checkpoint transaction, and the generic operation SELECT.

The executor now bounds that rollout wait with the existing `boundedTemplateWork` helper, allowing its existing
guarded settlement and operation adapter to finish before shutdown closes SQLite. Abort immediately clears the
heartbeat and deadline timers. The detached rollout consumes late rejection and checks cancellation before its
next database access. No generic adapter, lease duration, successful outcome, hold-release or W6 guard was relaxed.

`template-emergency.test.ts` reproduces actual W6 takeover, producer/runtime/owner shutdown and physical SQLite
close before releasing the old fake Apply. `template-lifecycle-service.test.ts` separately proves ordinary stop,
valid pre-stop lease renewal, immediate timer revocation, unknown outcome with active hold, and unchanged local
evidence after the fake Native side commits. Both now pass.

## Additional final-publication coverage

Six cases in `template-rollout.test.ts` inject configuration A-B-A, secret revision, authority marker, Bank
generation, scope and canonical identity changes inside the final publication readback. Injection is marked
successful only after its SQL/readback assertions complete. The generation fixture preserves its embedded
Native/application identity and document hash; the altered authority marker is actually stored and its original
activation proof subsequently refuses. These tests do not bypass either production validation path.

Every case preserves desired history and both remote receipts while rolling back selections, applied history,
defaults/history, runtime admission, publication, Bank setup and connection state, retaining the active hold.
The existing final lease-expiry and deferred-COMMIT rollback cases also pass. No production publication change
was needed. During test development, an extra assumption that the synthetic application synchronizer also
advanced the separate v1 checkpoint was removed; the fixture explicitly does not provide that integration proof.

## Verification

Exact argv, working directories and real exits are retained in the named result files. All executed checks used
the existing credential-free `run-b2-check.py`, an explicit owned TEMP/TMP root and at most two Vitest workers.
Tests, scoped lint and Core types ran serially.

| Evidence | Actual result |
| --- | --- |
| `b2-independent-core-stop-red-01-result.json` / `.log` | Exit 1; 1 failed, 4 skipped; original closed-SQLite regression. |
| `b2-independent-core-green-01-launch.json` / `-isolation.json` | Launcher exit 9009: Windows `python3` Store alias; Vitest never started. Retained separately from test results. |
| `b2-independent-core-green-02-result.json` / `-vitest.json` | Exit 1, 80.550 s; 87 passed, 6 new fixture failures. The unchanged nine passing files provide 80 current cases, including both stop regressions. |
| `b2-independent-core-green-03-result.json` / `-vitest.json` | Exit 0, 30.711 s; corrected rollout file, 13/13 passed. Its seven overlapping older cases are not added again. |
| `b2-independent-core-lint-01-result.json` | Exit 0, 8.703 s; all 87 published scoped ESLint files. |
| `b2-independent-core-typecheck-01-result.json` | Exit 0, 30.075 s; `pnpm typecheck` in `packages/core` (`tsc --noEmit`). |

The final affected scope is **93 passing cases: 80 unchanged-file cases plus 13 final rollout cases**. No full
Core-suite run is claimed. All test/lint/type isolation artifacts have equal before/after source hashes and
confirm removal of their owned temporary roots. Final `git diff --check` passes; its existing CRLF notices do
not indicate a whitespace failure. No matching owned Vitest, check-runner or TypeScript process remains.

The final static pass also checked boot/operation registration, production stop ordering, runtime hold admission,
and all nine template tables in the W6 inventory/Shared schema. Earlier review covered original-plan recovery,
post-publication binding-only repair, compatibility, provisioning, live reads and actual operator dispatch.

## Reused evidence and spec delta

The original compatibility/runtime, pure B1, migration, Shared/Desktop/CLI and isolated-main evidence remains
identified in `b2-core-implementation.md`, with its original scope and overlaps. The current executor change
required the affected execution tests and Core types above; it changes no public schema, consumer source, boot
wiring or migrations. Prior startup evidence is reused as startup evidence, not as a fresh shutdown or manual
acceptance run. Accepted Native/label producer evidence was not rerun or relabeled as this review's work.

Five owned files changed: the execution service, three tests and the lifecycle folder index. The only spec delta
is the added **B2 Core executor lifetime** section in `.trellis/spec/backend/hindsight-template-lifecycle.md`.
Removing that new section reproduces the exact pre-review spec hash, proving the earlier Native N1/N2 and Core
text is byte-preserved. All seven read-only label files, immutable v1 and historical production migrations remain
unchanged. The final manifest records the four changed frozen TypeScript inputs without duplicating their whole
1939-file inventory.

## Findings not fixed and ownership release

No unresolved finding remains within this dispatched Core scope. No original data, installed service, credentials,
paid provider, new dependency, Git lifecycle or task lifecycle action was used. The fake transport's eventual
remote commit remains deliberately unknown locally and still requires original-plan recovery.

All 101-file Core source ownership, necessary test/index/Core-spec ownership and the sole heavy-check slot are
returned to root with this report. This reviewer does not start B3 or mark combined B2/5B complete.
