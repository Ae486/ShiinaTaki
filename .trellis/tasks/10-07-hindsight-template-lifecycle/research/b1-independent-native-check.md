# Independent B1 Native, Shared and compatibility review

Status: independent Native/Shared/compatibility scoped PASS. The current-source OpenAPI export and all 906
generated artifacts match the tested canonical bytes. Final source identity and fixture/process cleanup are
verified. Native/Shared/compatibility source ownership and the heavy-check slot are released with this report;
root owns combined B1 acceptance and all B2/B3 scheduling.

## Scope and source identity

- Taki `H:/TakiAgent`, main, HEAD `2e244d0fdee49fb2c582a4333a9ef1573fa9112a`.
- Native `H:/hindsight`, main, HEAD `eb6413a7f58c4f3f0adb88a33a99516f8707fef7`.
- Reviewed the released B1 Native/Shared producers, authenticated routes, storage/claim/provider boundaries,
  generated compatibility and Core adapters outside `template-lifecycle/`. Core composition/storage/058 stayed
  with the other checker. The root-verified release inventory was the starting source, not acceptance evidence.
- Root explicitly added real provider submission guards, Native administrative backup table inventory and
  existing transition auxiliary inventory to this B1 completeness repair. Managed B3 paired equality, backup
  request/receipt production and ownership reconstruction remain outside this slice.

## Findings (fixed)

### Lifecycle structural values diverged across languages

- Files: Native `engine/template_definitions.py`; Shared `hindsight-template-definition-schema.ts`,
  `hindsight-template-schema.ts`; the two schema tests and byte-identical structural fixtures.
- Issue: lifecycle input admitted invalid config values/response schemas/duplicate nested label values on Shared,
  and oversized/ambiguous nested tag groups, Python-only aliases or invalid excluded model IDs on Native. Invalid
  label descriptions could escape validation as `AttributeError` rather than the intended input refusal.
- Fix: align finite lifecycle-only structure and field semantics, reject ambiguous nested discriminators, validate
  label descriptions as strings, and retain complete supplied trigger spelling. The legacy Native DTOs are unchanged.
  Native's existing `croniter` still owns semantic cron compilation; Shared implements no cron interpreter/subset.
- Evidence: 36 shared static cases plus six accepted extended Native cron expressions; invalid cron is rejected by
  the actual HTTP validation layer before an engine/provider/SQL mutation handler can execute. The old prototype-key
  test now supplies a valid response schema while still checking the own `__proto__` property.

### Refresh authority was checked outside later provider waits

- Files: Native `engine/template_refresh.py`, new `engine/template_provider_guard.py`, `engine/llm_wrapper.py`,
  `engine/memory_engine.py`, `engine/reflect/agent.py`, `engine/retain/embedding_utils.py`.
- Issue: the original publishing guard was tied to one Task. Cutoff/config/retrieval waits, reflect's `wait_for`
  task, later delta/structured calls and provider retry/concurrency waits could start new external work after
  definition or claim loss. Ordinary provider-error handling could also swallow an ownership refusal.
- Fix: retain the original Task restriction for publication, and bind an optional inherited callback to the exact
  admitted claim for provider work. Recheck claim/payload/definition/revision plus the live transition writer lease
  after permit acquisition and before each upstream attempt. Check embedding admission before executor submission,
  preserve final SQL rollback guards, and bypass provider fallback on template ownership failures. Scope exit/cancel
  revokes copied child contexts; plain calls do no additional claim IO and existing cache deletion can finish.
- Evidence: real refresh preparation/cutoff/permit barriers; delta and structured follow-up refusal; actual OpenAI
  retry code with fake transport; tool-loop/cache behavior; inherited/concurrent/nested/cancelled context isolation;
  Worker A-B-A/content drift; definition A-B-A during embedding; final atomic publication and semantic-marker replay.
- The import smoke exposed a startup cycle through `template_models -> transfer -> MemoryEngine`. Runtime exception
  imports remove it without changing the protocol. Actual refresh argument names already matched the live signature;
  no speculative keyword/signature correction was made.

### Physical backup omitted all three B1 evidence tables

- File: Native `admin/cli.py`.
- Issue: `BACKUP_TABLES` omitted `memory_template_receipts`, `memory_template_children` and
  `memory_template_refresh_results`, so native administrative recovery could lose the original outcomes.
- Fix: add them in FK order. The existing archive version, compatibility checks, offline restore behavior and
  historical migration restrictions remain unchanged.
- Evidence: actual schema/table/FK parity; nonempty real receipts/children/results survive binary backup/restore;
  original request replay does not regenerate. Fresh/e40 upgrade and populated evidence downgrade refusal are covered.

### Complete transition witnesses omitted template history

- File: Native `engine/transition_snapshot.py`.
- Issue: the established auxiliary witness could ignore B1 evidence, including a no-op receipt that changes neither
  the Native nor application logical state.
- Fix: include exact PostgreSQL row JSON for all three tables. Their complete absence preserves old-schema
  behavior; partial availability refuses rather than issuing an incomplete witness. Empty new tables leave old
  witness hashes unchanged.
- Evidence: real nonempty table rows, a no-op receipt changing only the auxiliary/full witness, e40 compatibility,
  partial-table corruption refusal and the existing ordinary/optimized baseline equality path.

### Contract documentation and regression fixtures

- Files: `.trellis/spec/backend/hindsight-template-lifecycle.md`, Shared `src/index.md`, Native `TAKI_PATCHES.md`.
- Fix: document finite validation/Native cron ownership, actual provider admission, physical/auxiliary inventory
  and the B3 boundary. Incorporate the Core checker's verified all-resource proof progression and original-receipt
  journal rules; later current readback does not redefine the original receipt clock or demand exact event counts.
- Fixture corrections are recorded separately below; no production behavior was weakened to satisfy a test.

### Historical backup and compatibility fixtures no longer represented the current seams

- Files: Native `tests/native_results/test_transition_backup.py`, `tests/test_taki_extension_contract.py`.
- Issue: the d77 historical archive fixture excluded transition tables but still included the new B1 tables. The
  existing extension fixture initialized optional ST/torch providers, and its unsupported-store injection patched
  only `get_memories()` after the real read-only handshake had moved to `peek_memories()`.
- Fix: exclude both later table families from the d77 archive, retaining the original historical/restore assertions
  and explicitly proving the restored B1 tables are empty. Reuse the established offline Native memory fixture with
  the real DefaultTenant/API-key authentication paths, and inject the same unsupported store through both accessors.
  Original `lineage=None`, unsupported-manifest and HTTP 503 assertions remain intact. Root authorized these two
  existing-test corrections; no production refusal or migration protocol was relaxed.
- Evidence: the corrected 11-case fixture selection and the final complete 166-case matrix both pass.

## Findings (not fixed)

- Full-package Windows Native `ty` retains the previously recorded 27 optional dependency/platform diagnostics
  (`mlx`, `fcntl`, `signal`, `resource`, `os.uname`). Current changed production files pass the actual Native Linux
  target check. This is not a full-package Windows typecheck pass.
- B2/B3 runtime/label/Home/managed paired-backup producers remain deliberately outside B1. No original-data,
  installed/manual acceptance or billing-exactly-once claim is made. Provider work already submitted cannot be recalled.

## Verification

Every `b1-*-result.json` retains the exact command, cwd and real child exit; matching `.log` files retain the output.
Counts below overlap and must not be added as unique tests. Native SQL and even the provider-only pytest selections
ran through `run_isolated_hindsight.py`; they never loaded the real `.env` or called paid providers.

| Check | Current result | Evidence |
| --- | --- | --- |
| Final isolated Native matrix | 166 passed, exit 0; pytest 509.88s, full runner 579.768s | `b1-independent-native-matrix-03-result.json` |
| Corrected historical/authentication fixtures | 11 passed, exit 0; pytest 69.59s | `b1-independent-native-fixtures-02-result.json` |
| Native Ruff, 37 production/test files | Exit 0 | `b1-independent-native-ruff-04-result.json` |
| Native Linux-target ty, 25 production files | Exit 0 | `b1-independent-native-types-02-result.json` |
| Native real entrypoint/reflect imports | Exit 0 | `b1-independent-native-import-01-result.json` |
| Shared current schema/static cases | 2 files / 44 passed, exit 0; reused from Core checker | `b1-independent-core-shared-01-result.json` |
| Shared current typecheck | Exit 0 | `b1-independent-native-shared-types-02-result.json` |
| Core current composition/storage/migrations | 10 files / 80 passed; separate checker | `b1-independent-core-green-01-result.json` |
| Core current typecheck and root ESLint | Exit 0; separate checker, stable Shared source | `b1-independent-core-typecheck-01-result.json`, `b1-independent-core-lint-01-result.json` |
| Core compatibility adapters | 4 files / 26 passed, exit 0; at most two workers | `b1-independent-native-core-compatibility-01-result.json` |
| Re-derived OpenAPI | Export exit 0; identical canonical bytes | `b1-independent-native-openapi-01-result.json`, `b1-independent-native-openapi.json` |
| Current generated artifact hashes | 906 matched; no generated changes | `b1-independent-native-final-source.json` |
| Final source manifest and UTF-8 without BOM | 103 Taki / 215 Native files, unchanged HEADs; exit 0 and no post-freeze deltas | `b1-independent-native-source-01-result.json`, `b1-independent-native-final-source.json` |
| Scoped Taki/Native whitespace checks | Both exit 0 | `b1-independent-native-taki-hygiene-01-result.json`, `b1-independent-native-native-hygiene-01-result.json` |
| Owned fixture/process cleanup | 9 fixtures fully removed/stopped; no surviving check processes, exit 0 | `b1-independent-native-cleanup-02-result.json` |

### Retained failures and recovery

| Run | Actual result | Interpretation |
| --- | --- | --- |
| `independent-native-wire-red-01` | 11 failed / 31 passed, exit 1 | Native structural holes and description exception reproduced |
| `independent-native-shared-red-01` | 10 failed / 26 passed, exit 1 | Shared config/response-schema/label inconsistencies reproduced |
| `independent-native-shared-types-01` | Exit 2 | New prototype-key test needed an `object` assertion; corrected, types-02 exit 0 |
| `independent-native-provider-red-01` | 16 failed / 8 passed / 1 teardown error, exit 1 | 14 provider/inventory findings; two success fixtures wrongly expected one LLM turn; teardown had not restored a temporarily absent task backend |
| `independent-native-matrix-01` | Exit 4, zero tests | Collection startup import cycle; fixed by lazy domain imports, entrypoint smoke passes |
| `independent-native-boundaries-01` | 3 failed / 12 passed, exit 1 | All 11 provider-specific cases and physical restore passed; two auxiliary fixtures needed real application capture initialization, one full-refresh fixture needed a controlled final text response |
| `independent-native-auxiliary-red-01` | 2 failed, exit 1 | Correctly initialized fixtures reproduced missing evidence rows and partial-inventory acceptance |
| `independent-native-ruff-01` | Exit 1 | New test import ordering only; fixed and subsequent scoped checks passed |
| `independent-native-matrix-02` | 155 passed / 1 failed / 10 errors, exit 1 | Historical d77 table inventory and optional ST/torch fixture initialization; corrected without relaxing production behavior |
| `independent-native-fixtures-01` | 10 passed / 1 failed, exit 1 | Unsupported-store injection needed the actual `peek_memories()` accessor; original refusal assertions retained |
| `independent-native-cleanup-01` | Exit 1 | Audit counted its own two live Python wrapper ancestors; exclude the exact audit ancestor chain, retain all other process checks; cleanup-02 passes |

The earlier B1 implementation's 35-pass/2-fail matrix, targeted three-pass recovery and generator failures remain
in their original files. They are never relabeled as a full green matrix. Canonical/SDK evidence is reusable only
after comparing the current re-derived OpenAPI and every recorded generated byte identity.

The current export is byte-identical to `hindsight-docs/static/openapi.json`, SHA256
`8d49efa07c17b9694354259ac9e7795a8c0c824ec6a7b0119947d85f791b012f`. All 906 entries in
`b1-generated-after.json` match. The stable `rust-build/hindsight_client_generated.rs` inventory key resolves to
the single actual Cargo OUT_DIR output, following `pin-b1-generated.py`; it is not a repository-relative path.
An initial read-only comparison treated it as a physical path and raised `FileNotFoundError`; the source-manifest
helper now resolves it explicitly and still compares its bytes. No generated file was changed or omitted.

Reuse the prior successful `b1-canonical-04`, `b1-sdk-python-01`, `b1-sdk-typescript-01`,
`b1-sdk-typescript-build-01`, `b1-sdk-rust-01` and `b1-sdk-go-final-01` evidence. The retained
`b1-tested-generated-comparison.json` distinguishes the earlier Go-only postprocessing differences; its required
Go recheck is the actual final passing Go record. A source-equivalent export does not require another full SDK
generation/build. These are reused successful checks, not new executions by this reviewer.

## Fixtures, preservation and release

All nine fixture runs report `Stopped`, `DataRemoved` and `RegistryRemoved` true:
`9b1caf3bb472`, `26b13d415121`, `da81fad5d7e5`, `38311cdee71c`, `cf93163e37bf`,
`881b0fa8004f`, `8dd90b85eb50`, `5a4962484a6d`, `befa9df1db23`
(each prefixed `taki-hindsight-g1-`). Their original logs remain under `.trellis/.runtime/g1-validation/`.
Final cleanup-02 independently reread all ownership records and confirmed absent data, registries and original
PostgreSQL PIDs. The bounded process audit found no surviving check process apart from its excluded live audit
ancestor chain. All Native, Core compatibility and OpenAPI tool sessions have returned their real final exit codes.

No historical migration, v1 catalog, generated SDK source, Core checker-owned file, task binding, commit, push,
reset, rebase, finish or archive was changed by this checker. `b1-independent-native-final-source.json` freezes
the original B1 inventory plus this review's owned files: 103 Taki and 215 Native files, including explicit
owned/baseline-delta paths. Other Core checker changes are identified but retain their separate review/source
manifest. Read-back confirms no post-freeze byte change, matching shared/native structural fixtures and all 906
canonical/generated identities. Scoped `git diff --check` passes; Git's informational LF/CRLF notices do not
change the UTF-8 without BOM identity or indicate whitespace failures.

The Native/Shared/compatibility source scope and single heavy-check slot are released. No owned test, provider,
generator or PostgreSQL process remains. The root agent retains the combined B1 acceptance and B2 activation gate;
this report neither accepts the whole Stage 5B nor starts another implementation slice.
