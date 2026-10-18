# Stage 5A independent check

Verdict: **PASS for the bounded Stage 5A implementation and fixture acceptance.** Two concrete findings were
corrected during independent review, their final code was independently inspected, and their real regressions
passed when rerun by the checker after formal source/test ownership transfer. No unresolved implementation
finding remains. This is not complete Stage 5, installed-environment or owner/manual acceptance.

## Baseline and scope

- Taki: `H:/TakiAgent`, `main`, HEAD `2e244d0fdee49fb2c582a4333a9ef1573fa9112a`.
- Native: `H:/hindsight`, HEAD `eb6413a7f58c4f3f0adb88a33a99516f8707fef7`.
- Full-slice comparison starts at `pre-implementation-baseline-2026-10-07.json`. Existing W9/unrelated changes
  are preserved. The final `implementation-source-identities.json` supersedes the interim review-start inventory.
- Read task PRD/design/implementation/review plan, curated check context, local instructions and Home handoff.
  Applied `.agents/skills/trellis-check/SKILL.md`. Confirmed real source paths rather than accepting owner claims.

## Findings (fixed)

### R1 — Secret changes can evade observation invalidation (high)

- Files: `packages/core/src/memory/hindsight/hindsight-configuration-context.ts:58`,
  `hindsight-secret-refs.ts:22`, `packages/core/src/secrets/secret-catalog-service.ts:156`.
- Trigger: two successful connection-secret replacements receive the same millisecond `updatedAt`, or a
  changed credential is followed by restoring an earlier catalog envelope during an in-flight observation.
- Evidence: the existing secret marker hashes only health, presence, key version and timestamp. `setSecret`
  uses wall-clock `new Date().toISOString()`; `restoreEnvelope` restores old provenance. Original context identity
  used that marker without an independent secret-write generation; its test replaced a fake marker string.
- Consequence: changed secret identity can compare equal at publication and admit an obsolete response; a prior
  current result can also remain displayed after an undetected replacement. Violates PRD secret-change/race gate.
- Required correction: an internal monotonic catalog generation, incremented only after successful publication,
  including restore/key rotation, captured by observation only. Preserve existing persisted fingerprints and
  public secret metadata. Test real Catalog same-Date replacement and restore ABA, including response publication.
- Leader accepted; implementation owner added `SecretCatalogService.revision()` and advances it after successful
  set/nonempty-clear/rotate/restore publication. `hindsight-configuration-context` captures a separate `secretRevision`
  supplied by real boot composition. Original marker/fingerprint/public RPC shapes are unchanged. Catalog health
  changes only at construction; the spec explicitly binds future live health/reload changes to invalidation.
- Checker independently read the complete correction and real fixed-Date/in-flight tests. Before the correction,
  `core-secret-red-01.log` shows both replace and restore incorrectly publishing `observed` (2 failed). Afterward,
  `core-secret-green-01.log` reports 11 files / 78 passed in 15.27 seconds, including Catalog publication and 5A
  regressions. Checker reran the real Catalog and in-flight same-Date replacement/restore cases after release:
  **2 files / 17 tests passed, exit 0**, `independent-core-regression.log`. R1 is closed.

### R2 — Compatibility preflight can initialize the memory extension (medium)

- Files: `packages/core/src/memory/hindsight/hindsight-configuration-service.ts:150`,
  Native `hindsight-api-slim/hindsight_api/engine/memory_engine.py:1823`.
- Trigger: a Core observation first requests `/ext/taki-memory/version` while the installed memory store is absent.
- Evidence before correction: the observation route used `peek_memories()`, but its preceding compatibility route used
  `get_memories()`, whose missing-store path calls `create_memories()`. Direct observation tests trap only the
  second route, and the Core transport fixture synthesizes the first route's manifest.
- Consequence: the complete observation sequence does not establish the promised zero-initializer behavior.
- Proposed correction: make the compatibility read inspect the installed store without lazy initialization,
  preserving normal initialized behavior, and test the full version/observation HTTP sequence with a loader trap.
  Leader accepted. Implementation owner replaced only this handshake's `get_memories()` with `peek_memories()`;
  normal engine `init_memories()` still owns startup initialization. Checker independently read the correction and
  both actual `create_app` HTTP-chain cases. `native-chain-red-01.log` proves the missing-store case failed before
  the correction with `Extension initialized` (1 failed / 1 passed). `native-final-pg-01.log` then reports 43 passed
  in 64.47 seconds, including the migrated read-only PostgreSQL fixture and old capability/backup/OpenAPI cases.
  Owned fixture `taki-hindsight-g1-c2b0f54f4c1a` records stopped/data removed/registry removed. Checker independently
  reran the actual missing/installed-store HTTP chain after release: **2 tests passed, exit 0**,
  `independent-native-regression.log`. R2 is closed. No further checker production patch was necessary.

## Findings (not fixed)

None. The checker wrote only review evidence after final source handoff.

## Reviewed code paths

- Native: real Bearer context; auth-required check; exact schema/Bank grants; allowed Bank and Bank-read validator;
  fixed safe refusal envelope; no-store; existing schema-qualified Bank/replication/lineage SELECT JOIN; exact
  `LLMProvider` projection without router/custom forwarded property reads; constructor engine session; unknown
  workers/embedding/reranker and safe model alias grammar. Root and embedded env templates include the grant.
- Shared/Core: strict profile/observation/refusal/status schemas; 16 KiB bound; total ordinary-read deadline;
  operator dispatcher; scope mapping, pinned generation/lineage, setup/config write generation; coalescing,
  response sequence, process-session retirement, monotonic expiry and restart. R1/R2 corrections are verified above.
- Home: actual WsClient schema boundary, generation/scope guards, mount/reconnect/focus/visibility status reads,
  explicit observation, immediate clearing on refresh/error, one-shot expiry, no persistent evidence, desired versus
  observed/partial/unknown labels. Existing Operations entry and explicit health actions stay separate.
- Compatibility: exact old/new build additions are present in generic/application/transition/native-result gates;
  existing mandatory contracts remain required. Optional observation is not synthesized into old manifests.
  Source evidence retains its independent mandatory gate. Whole-manifest old-preview refusal and fresh actual
  transition proof are tested; persisted fingerprint constants were not changed.
- Generation: explicit existing-JAR selection verifies exact 7.10.0 before cleanup, keeps Docker default and flags,
  handles Git Bash Native Java/Python paths, and retains canonical postprocessors/maintained wrappers and module pins.
  Four-language model/transport regressions passed. Checker independently matched both generation snapshots and
  the actual current generated tree. Both deployment env examples and indexes/specs are synchronized. Shared's
  exact-path 550-line allowance covers 544 effective named-export lines; AST guards and implementation caps remain.

## Verification

### Independently executed after formal handoff

All commands ran from `H:/TakiAgent` except the Native whitespace check. Heavy checks ran serially; at most two
Vitest workers were used. Actual process exits were checked, and logs are retained under this research directory.

| Check | Actual command | Result / evidence |
| --- | --- | --- |
| Core R1/Catalog | `pnpm --filter @taki/core exec vitest run src/memory/hindsight/hindsight-configuration-secret.test.ts src/secrets/secret-catalog-service.test.ts --maxWorkers=2` | **17 passed in 2 files, exit 0**; `independent-core-regression.log` |
| Native R2 HTTP chain | `H:/hindsight/.venv/Scripts/python.exe .trellis/tasks/09-07-hindsight-recovery-evidence/research/validation/run_isolated_hindsight.py -- tests/test_configuration_observation.py::test_version_then_observation_never_initializes_a_store -q --tb=short` | **2 passed, exit 0**; `independent-native-regression.log` |
| Root lint | `pnpm lint` | **PASS, exit 0**; `independent-lint.log` |
| TypeCheck | `pnpm -r typecheck` | **All 5 workspaces PASS, exit 0**; `independent-typecheck.log` |
| Tracked whitespace | `git diff --check` in both repositories | **PASS, exit 0**; only existing Git EOL conversion notices |
| New-source text hygiene | Decode changed files as UTF-8; reject BOM and trailing whitespace in untracked source | **PASS**; `independent-source-verification.json` |

The Native runner was read before use. It whitelists platform variables, sets `PYTHON_DOTENV_DISABLED=1`, supplies
only a unique owned PostgreSQL URL, disables worker parallelism and installs the network guard. Checker fixture
`taki-hindsight-g1-83efe88ff850` records **Stopped/DataRemoved/RegistryRemoved = true**. The log shows an import-time
LiteLLM metadata download blocked by that guard and local fallback; no external model/network operation succeeded.
No actual repository `.env` or real credential was read by this check.

### Reused gates after independent source, code and evidence verification

Commands, final logs, scope, process exits and retained failures were read in `implementation.md`,
`gate-process-results.json` and `home-implementation.md`. Counts overlap and must not be summed.

| Gate | Accepted result |
| --- | --- |
| Shared full suite | 65 files / 557 passed |
| Core full suite before isolated R1 correction | 495 files / 3817 passed / 1 existing Windows skip |
| R1 affected suite after correction | 11 files / 78 passed |
| Desktop full suite / build | 123 files / 694 passed; build exit 0 |
| Home focused / actual Chromium | 26 focused/adjacent tests plus 1 actual browser/Core-WS test passed |
| Native HTTP, migrated read-only PostgreSQL, legacy compatibility/backup/OpenAPI | 43 passed; fixture stopped and removed |
| Native static checks | Ruff over 10 changed production modules and exact-interpreter ty over 9 boundary modules passed |
| Python SDK | 102 offline tests passed |
| TypeScript SDK | Build passed; 11 suites / 44 tests passed |
| Go SDK | Build/compile passed; 8 top-level offline contract cases passed |
| Rust SDK | 4 locked/offline contract binaries / 11 tests passed |
| Generator backend | 3 tests passed: missing JAR, wrong version, pinned installed version |
| Canonical generation | Both complete runs exit 0; 809 artifacts/maintained files byte-identical |
| Actual final Core boot | Real main, fresh owned SQLite, authenticated status/observe, zero prohibited calls, normal SIGTERM; exit 0 |
| Native docs build | Exit 0; pre-existing 0.5.5 blog anchor warnings retained |

The complete pre-R1 Core snapshot has 1298 files: **1292 remain identical**. Only six R1 files changed: 5A
boot/context/context test, Catalog source/test and Catalog runtime fixture. Those exact diffs were read; the
78-test affected suite, checker 17-test rerun, final types/lint and real boot cover that delta. The added R1 test
is also pinned in the final manifest. A repeat of the unchanged 15-minute full Core suite is not required.
The existing full-suite skip is the POSIX permission-bits check in `hindsight-backup-store.test.ts:123` on Windows;
the asset-backed Zstandard case ran on this host.
- Directly inspected retained Home screenshot `observed.png`: desired/actual columns, partial API coverage,
  explicit unknowns, disabled profile and red mismatch are readable; no secret, endpoint or raw error presentation.
  The retained browser result records two observers, reconnect, remount, expiry, denial, failure clearing and no
  page errors. This is fixture Chromium evidence, not installed WebView2 or owner acceptance.

## Final source and generation identities

- After independent checks, all **59 Taki / 66 Native changed files** match `implementation-source-identities.json`
  in size and SHA-256. Both repository HEADs remain those recorded above. All **10 Taki / 9 Native pre-5A dirty
  source paths** remain byte-identical; W9 is preserved. Full readback: `independent-source-verification.json`.
- Final source-manifest SHA-256:
  `5715247985b6609513a9daf931949a10b8bdf9633f0ecfd9c553f4d8e55e7857`.
- `independent-generation-verification.json` compares both canonical snapshots and current disk artifacts:
  **809 entries; zero key/byte/hash differences**. The Rust snapshot alias resolves to the sole actual
  `target/release/build/hindsight-client-*/out/hindsight_client_generated.rs` file.
- Existing local 7.10.0 generator JAR SHA-256 remains
  `615e014705af34861e789e0b2a11075d3c80db134f881e937265479a4a83996e`.
- Root/embedded environment templates both have SHA-256
  `af87d3985ad0afbebe4a0a9ca77ec485a67ac64795644fa6683c025ba1ef2c17`.

## Limits

Desktop retains its existing large-chunk warning; Native docs retains historical anchor warnings. Neither
requires a performance change. Rust Shell production was unchanged, so Shell-wide clippy/tests were not repeated;
Rust generated SDK contracts were checked separately. Native whole-repository live-service/model suites were not
run; relevant offline/isolated scopes are explicit above.

No original-instance data/grant/deployment change, real model call, standalone worker/fleet proof, installed
Tauri/WebView2/CSP validation, owner/manual acceptance, new dependency, Git commit/push/reset or finish/archive
occurred. Configured aliases do not prove upstream execution, health, setup or authority readiness. Stage 5B and
later Stage 5/6 work remain separate. Task status and PRD acceptance marking remain leader-owned.
