# G1 Offline Validation Results

Date: 2026-09-08. Status: routine implementation, independent review and authorized actual-source Rust validation complete.
Validation baselines: `H:/TakiAgent` (`main`, `c3f8bc4`) and `H:/hindsight` (`main`, `7eca2056`).

Provider checkpoint: the owner approved a local Hindsight commit after verifying `origin` as
`https://github.com/Ae486/hindsight.git`. Commit `8ab65b4c2ea238223eeef84cbdcc012ca7601e86`
(`feat: add durable native-result recovery for Taki`) records the 434-file provider/SDK/test/ledger change on `main`.
All 455 generated files matched the validated parity manifest, and the staged whitespace gate passed before commit.
The handwritten-source inventory is 22 files, including the Python public-export module omitted from the earlier count.
The unrelated control-plane `bin/cli.js` bytes remain unchanged and were excluded. No push or Taki commit/archive ran;
the coordinated Taki consumer changes remain in its working tree.

## Acceptance boundary

The implemented routine contract completes Pending after exact native factual-result
proof and the matching actual SQLite checkpoint. Native derived maintenance remains
asynchronous. This report does not accept B4 activation, planned Hindsight-to-Local
switching, B6 full Local maintenance, model quality, current user-data migration or
live/manual operation.

The owner approved the exact [two-file dependency patch](validation/rust-runtime-dependency.patch)
on 2026-09-08. The actual Rust manifest now declares `regress = "=0.10.5"` as a runtime
dependency, and the lockfile adds only the root dependency edge. Parsed comparison
against `HEAD` proves all package versions/checksums are unchanged. Actual-source
`cargo build --release --locked --offline` and
`cargo test --release --locked --offline --test native_result_contract` passed in
`d31d069c8e07`; all four contracts passed and validation left the lockfile unchanged.
The independent checker reviewed that exact diff and execution evidence. The earlier
copied-crate result remains preparation history, superseded by this actual-source gate.

## Runtime and storage evidence

See [implementation record](g1-routine-implementation.md) for source ownership,
complete file inventory, exact Taki commands and the implementer's additional gates.

| Gate | Observed result | Evidence |
| --- | --- | --- |
| Final native G1 matrix and actual HTTP-to-Taki-to-SQLite | 69 passed, 144.22 s, including all review corrections | Owned fixture `c6b4ce7f991d` |
| Pre-review native G1 matrix | 39 passed, 82.13 s | Owned fixture `348e5ef69a97` |
| Final retain/result-seal/ANN-tail cleanup | 4 passed, 15.00 s | Owned fixture `4c88afdb6114` |
| Nonempty native receipt/part backup and restore with continuation | Passed actual admin backup/restore in an owned tenant schema | Fixture `de61e28a76bb`; included in the final native matrix |
| Existing mechanical allowlist | 544 passed, 99 skipped, one obsolete fake-pool failure | Fixture `ae339b46e96c`, 632.48 s |
| Corrected existing cancellation fixture | 1 passed, 3.60 s | Fixture `26775358cd7a` |
| Final affected Taki package suites | Shared 396; Core 2036 across 303 files, 39.42 s | Implementer final record; independent Core rerun session `95891` |
| Other Taki package suites before corrective review | CLI 47, Desktop 548 passed | These packages were unchanged by the corrective review |
| Taki type/lint and provider source formatting | Five TS typechecks; root-scoped and affected-file ESLint; scoped Ruff check and 23-file format gate passed | Implementer final record |

The first corrective Core full run passed 2035 of 2036 tests; the unchanged MCP HTTP
smoke test returned an undefined `remote_echo`. Its focused rerun passed in 1.65 s.
After the native PostgreSQL fixture stopped, an independent full Core rerun passed
all 2036 tests. No MCP source or assertion was changed. The cause of the first failure
was not established; do not turn the successful reruns into a root-cause claim.

The one mechanical failure was an existing test double with `pool.ops = None`.
The `HEAD` orchestrator already required its real capability in the zero-fact path;
the test now supplies `supports_taki_replication=False` and reaches its intended
consumer failure. Production capability checks were not relaxed. The 99 skips are
all parameterized migration-shape checks with no `CONCURRENTLY` DDL, not skipped
G1/replication behavior. No full-suite rerun is inferred from the narrow correction.

The native matrix covers actual PostgreSQL transactions, fixed input/part plans,
large text/JSON append and replacement, delta survivors and archived facts, zero and
rejected extraction, Batch API faults, stale attempts, cancellation/pruning, Bank
clear/retirement/recreation, result sealing and native post-write recovery. The HTTP
fixture uses the real initialized engine and wire serialization, actual typed Core
client, snapshot/journal projection and file-backed SQLite Pending/checkpoint paths.
It proves lost-ACK append, second-pull failure/reopen and mutation recovery; the
replace/append path used two POSTs and invoked the supplied derived port zero times.
Fixture policy/provenance bindings do not constitute a completed B4/B6 field adapter.

Every listed owned PostgreSQL instance was verified stopped and its data/registry
removed. Native fixtures use deterministic model implementations and the actual
character chunker. This proves storage/control flow, not extraction or recall quality.

## Canonical generation and SDK evidence

Logs are under `H:/TakiAgent/.trellis/.runtime/g1-codegen/<id>/`.
Generation uses the maintained source OpenAPI entry and exact pinned generator
options/postprocessors through [the Windows runner](validation/run_windows_codegen.py).
Portable tool versions/checksums and isolation rules are in [the harness record](validation/README.md).

| Gate | Observed result | Run |
| --- | --- | --- |
| Strict nullable OpenAPI regression | 6 passed; Ruff/format/typecheck passed | `d59847b48515`, `39c17ed6f5fa` |
| Canonical OpenAPI + Python/TypeScript/Go generation | All selected stages and Go tidy/build passed after final enum-title source fixes | `2b246431143d` |
| Final Python SDK offline suite | 74 passed, including wrapper/nullable/request-field-presence cases | `125703773c4a` |
| Final TypeScript offline suite and build | 34 passed; build passed | `125703773c4a` |
| Go test compilation and maintained/new contracts | Compile-only gate and disposition/native-null contracts passed | `59bc3ba65d24`, `125703773c4a` |
| Rust temporary proposal build and generated serde/hash/enum contracts | 4 passed; release/locked/offline build passed | `b84fb7cc7707` |
| Authorized actual-source Rust build and generated contracts | Release/locked/offline build passed; 4 tests passed, 0 skipped; lockfile unchanged by validation | `d31d069c8e07` |
| Final Python offline wheel and actual wheel import | Built with cached declared build requirements; imported both packages from the wheel and preserved nested PATCH omission/null semantics | `f366a21ec048` |
| OpenAPI backwards comparison to `HEAD` | No errors or removed schemas | `39c17ed6f5fa` |
| Final documentation build | Canonical checks and static build passed against final schema | `b3980b022669` |
| Exact repeat-generation parity | 455 files byte-identical; maintained Go manifests unchanged | `eaa13461ba61` |
| Source schema after all review corrections | Canonical entry generated 554,364 bytes identical to the frozen OpenAPI artifact | `be8fdedfcada` |
| Canonical shell syntax | `G:/Git/bin/bash.exe -n scripts/generate-clients.sh` passed | Leader command |

The additional full provider `ty check hindsight_api` was run on Windows in
`e7c997c2f00f` and failed with 28 diagnostics: 27 in unchanged optional MLX/Unix
modules and one newly visible timestamp boundary in moved `native_requests.py`.
The timestamp correction passed its native regressions, and all 14 changed provider
source files passed the scoped type gate in `ae79ccf0ac82`; final source, including
the typed restored-parent counters, passed again in `3dcd8e4b32f7`. The full rerun in
`a9ab16a901e3` reports exactly 27 diagnostics in seven files unchanged from `HEAD`;
no changed source remains in that diagnostic set. Do not report the full default
Windows provider typecheck as passed. The final canonical schema SHA-256 is
`5bfbd4dcabb88366811de0ffff48e3e86eaaec9975c102c3b60f3ab4cb004ef6`.

### Independent review corrections

- R1 entity-only curation was independently withdrawn: real SQL proves its `edited_at`
  update already changes the source witness. Keep the regression and existing witness.
- R2 missing historical append text and R4 changed-chunk-size first-slice coverage
  passed corrected native regressions (`9e418bb81520`, 4 cases), independently reviewed.
- R5 native validation now retains appropriate 422/403/429 outcomes; its ASGI and
  moved-request timestamp cases passed (`960009eeba6b`, 15 cases), independently reviewed.
- R3 reproduced the later row stuck at `awaiting_pull` in the actual SQLite runner.
  Per-row confirmation now reuses the existing guarded failure boundary. The row keeps
  proof/diagnostic, later work completes, and reopen does not redispatch. Three affected
  Core files passed 71 tests; the independent checker reran the new regression. Scoped
  ESLint and Core typecheck passed.
- R6 no longer fingerprints Unicode-version-dependent entity deduplication. Both
  runtimes hash the original wire list; native normalization stays in execution.
  Shared 4 and native hash/mutation 11 cases passed (`bc8e4a2beb92`). Independent
  source/log review and an independently executed Shared vector closed this finding.
- R7 explicit retry now restores only the original incomplete plan after queue pruning or incorrect parent roll-up.
  The private typed parent identity/request-hash marker rejects an untracked UUID takeover, even after its children
  were pruned. Missing native usage statistics remain unknown with an incomplete aggregate indicator.
- R8 native outbox callbacks now belong to each input's final factual transaction. The exact-final-batch crash case
  retains its event, and callback failure rolls back facts/proof. `7907f97a971c` passed all 11 R7/R8 cases in 53.07 s.
  Independent source/assertion/log review closed both findings. All seven confirmed findings are closed; R1 is withdrawn.

The three existing schemas extended by G1 are
`TakiCompatibilityContracts`, `TakiCompatibilitySupport` and `TakiMemoryErrorResponse`;
native public request/response component names remain present.

### Source fixes required by actual generated-client failures

1. Generator 7.10.0 skips nullable property normalization inside closed objects.
   The canonical OpenAPI generator moves complete nullable field schemas to named
   components and leaves the parent's `required` and `additionalProperties: false`
   intact. A real Pydantic regression proves reverse expansion is lossless,
   idempotence, unchanged non-target schemas and collision refusal. Raw generator
   source and the failed/pristine/successful probes are retained in the owned runtime.
2. Generated Python `from_dict` inserted every absent PATCH field as `None`.
   Actual reconstruction of `{"text": "fixture replacement"}` added nine unrelated
   null fields. The canonical AST postprocessor preserves generated conversions but
   passes only supplied wire keys to Pydantic; explicit null, defaults and aliases
   remain distinct. Tests exercise real `from_dict`/`from_json`, nested mutation
   bodies, required nullable fields and maintained sync/async wrapper forwarding.
3. Rust's OpenAPI 3.0 adapter lost nullable reference siblings. Its source conversion
   now uses `allOf: [$ref]` with outer `nullable: true`. Actual serde tests failed on
   null progress/mutation before the fix. Generic `Status`/`Reason` titles also
   selected unrelated existing enums; source-qualified Taki titles preserve all
   original values and old native type names. All nine G1 statuses, fourteen reasons,
   null round trips and SHA-256 rejection vectors now pass in both the temporary proposal
   and the authorized actual-source crate.
4. Windows CRLF checkouts made two documentation scripts misparse valid frontmatter
   or compare unequal generated pages. Input/check normalization fixes those checks;
   no document text or validation gate was removed. Existing missing integration
   tags and two frozen changelog anchor warnings remain nonfatal baseline warnings.

Stock SDKs are transport/model clients, not a replacement for the strict provider
and Shared proof validation. Compile success alone was not counted as wire behavior.

## Preservation and remaining work

- Unrelated Hindsight `hindsight-control-plane/bin/cli.js` still matches the recorded
  SHA-256 `ce3ccd97b3759b2a0848221a9487de67178ce640d1ddc324a3043f7507655ef2`.
- Taki migration `035-pending-memory.ts` is byte-identical to the reviewed B5 baseline.
  G1 uses additive JSON fields; old persisted intents/receipts remain on their old protocol.
- No protected backup traversal, current service/data access, real model call,
  Docker start, authority activation, push or archive was performed. The separately approved provider checkpoint
  is recorded above; validation itself did not change Git history.
- Independent source review closed all seven confirmed findings and withdrew R1. Final affected native/Shared/Core
  suites and scoped quality gates passed. All owned validation processes and PostgreSQL data/registry were cleaned up.
- The approved Rust runtime dependency, actual-source locked build and generated-model contracts passed.
  No G1 implementation or offline validation work remains. Deployment/real-model/Host/manual/cutover acceptance
  remains separate, as do B4, B6 and B7 implementation and overall parent closeout.
