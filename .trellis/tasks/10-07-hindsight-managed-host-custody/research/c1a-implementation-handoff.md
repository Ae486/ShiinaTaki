# C1a implementation and self-check handoff — 2026-10-13

## Handoff state

C1a source implementation and its bounded self-checks are complete. Independent C1a acceptance remains pending.
No C1b work, actual Native/Docker work, service/runtime installation, original credential read, model call or Git
lifecycle operation was performed. All public custody results still have `deploymentReady: false`.

Workspace: `H:/TakiAgent`, branch `main`, base HEAD
`2e244d0fdee49fb2c582a4333a9ef1573fa9112a`. Existing dirty Stage 5A/5B changes were preserved.
The initial dirty listing is [c1a-initial-dirty-status.txt](./c1a-initial-dirty-status.txt).
Root owns task metadata/PRD/design and the overall handoff; this report does not mark task or manual AC status.

## Files and responsibilities

The [final input manifest](./c1a-source-hashes.json) records 122 source/config/index/fixture paths and SHA-256
digests. It was captured before the final copied-install checks and re-read afterwards: **zero changed inputs**.
It is a C1a input manifest, not a claim that every pre-existing line in those files was authored by C1a.

| Area | Changes |
| --- | --- |
| Shared | Strict C1 prepare/invocation/result and installed manifest/registration/enrollment schemas; fixed seven slots/budgets; narrow package subpaths; boot-free canonical input; governance revision 2 and once-only `ask / ask / auto` C1 cell; 24 new golden fixtures. |
| Codec | New `packages/secret-catalog-codec` narrow extraction of unchanged TSC1; original Core codec file remains a compatibility re-export; locked sodium version preserved. |
| Core Catalog | Owner-backed Core boot/private successful-publication revision/sealed-digest/current-file snapshots, including load/publish/restore/rotation currency; no second writer. |
| Core Host admission | Code-owned issued/accepted broker observers around actual dispatch/final effect settlement; original Core/broker/Host/request mapping; WeakMap accepted handles; post-await current-state validation; operator-only preparation composition. Raw new managed receipts refuse; existing-instance setup and historical reads remain usable. |
| Rust Shell | Strict serde mirrors; non-deserializable post-gate invocation context; live execution retirement on cancellation/policy/disconnect; optional installed capability registration; actual SID/DACL/NTFS/final-path/file-ID checks and retained handles; sanitized Node startup with Job-owned adapter descendants. |
| Installed Host | Compiled command entry, complete installation verification, bounded read-only Catalog/key adapters, release Node pairing/control/catalog/session path and final once-only gate; no automatic replay after disconnect. |
| Packaging | Explicit ESM + complete locked dependency manifest builder, actual Tauri resource-map build wrapper, separate builtin Linux pre-import launcher/systemd unit, enrollment/registration documentation and fake-only fixture tools. |
| Navigation/contracts | Touched folder indexes, desktop build-script typecheck coverage, and `.trellis/spec/backend/hindsight-host-custody.md` plus its spec-index entry. |

No `H:/hindsight` file was modified. The only dependency graph changes were internal workspace importer edges
and features on the already locked Windows crate. No new third-party version was introduced.

## Checks and retained failures

The [command log](./c1a-check-log.json) contains **37** check/build records, including command, exit code and
available captured output. Every record has an exit code. One earlier tool-capture failure did not preserve its
result and is deliberately excluded from PASS evidence. Checks ran serially; Vitest used one worker. Every Cargo
command used `--locked --offline`, dev/test debug 0, incremental 0 and the existing
`apps/desktop/src-tauri/target`.

| Final relevant gate | Result |
| --- | --- |
| Offline frozen lock installation | Exit 0; 8 workspaces; no third-party lock drift. |
| Shared/codec/Host/Core typecheck | Exit 0. Final affected Host/Core/Desktop pass also covered new tests and the desktop packaging script. |
| Core custody/owner/broker tests | 3 files, **30 passed**. |
| Shared sweep + focused repair | Original sweep: 67 files / 628 tests passed, 1 file / 7 tests failed. The repaired `governance-evaluator.test.ts` alone then passed **7/7**. No second full sweep is claimed. |
| Installed Host tests | Final 4 files, **22 passed**, including opened-file replacement/hard-link cases and the actual paired Core WebSocket path. |
| Existing codec/service/setup/recovery | 4 files, **34 passed**; includes raw-receipt refusal, missing-helper existing-instance operation and readable managed status. |
| Rust non-invasive lib sweep + repair | Original result: **174 passed, 1 failed, 1 ignored, 3 filtered out**. The five Windows primitive tests then passed, including the actual failed directory rename case. |
| Final Rust golden parity | **1 passed** after internal enum renaming; serialized slot names unchanged. |
| Explicit copied-install tests | **2 passed**, 12.63 s, including all positive/negative artifact checks described below. These ignored tests were explicitly selected, not counted as passed from being ignored. |
| Real Node Core main/WS smoke | Exit 0; real `main.ts`, fresh owned DB/data directory, operator authentication and custody/status calls; **0 prohibited HTTP/model/socket calls**; graceful SIGTERM exit. |
| Desktop resource path | Real debug adapter/payload build passed; real Tauri `build.rs` consumed its generated resource map under `cargo check`, exit 0. All 795 mapped files matched the staged payload. |
| Linux distribution | Linux payload/launcher/unit distribution built offline; builtin launcher syntax check exit 0. This is build/syntax evidence only, not Linux execution. |
| Root lint | Final `pnpm lint` exit 0. |
| Strict Rust lint | Final `cargo clippy --all-targets --locked --offline -- -D warnings` exit 0; no suppression added for the C1 finding. |
| Whitespace | Final standalone `git -c core.safecrlf=false diff --check` exit 0. It covers tracked diffs; untracked C1 sources are included in lint/typecheck and the input hash manifest. |

First failures were used to repair the mechanism, not removed or counted as passing:

| First finding | Correction and subsequent evidence |
| --- | --- |
| Core fixture omitted the new Catalog snapshot methods | Fixture now explicitly refuses unsupported custody; affected typechecks passed. |
| Windows flags wrapper had no `BitOr` implementation | Construct the typed combined flag value; Cargo checks passed. |
| Shared test constants still assumed registry revision 1 | Use current revision and current-plus-one mismatch; all seven formerly failing tests passed. |
| Host canonical projection passed its `digest` into a strict payload-only schema | Project the four actual payload fields; 17 original Host cases and final 22-case suite passed. |
| Metadata-only directory handle permitted a real rename | Add `FILE_LIST_DIRECTORY` data access while withholding delete sharing. Actual directory rename is now blocked; all five primitive cases passed. |
| A valid late cancellation acknowledgement closed the Host after an unattended ask | Distinguish terminal response refusal from transport/current-authority failure; real ask/resume/auto/disconnect integration passed. |
| `transpileModule(NodeNext)` returned success but emitted CommonJS under an ESM package | Actual copied Node startup failed with `exports is not defined`. Emit explicit ESNext modules; the final installed production invocation passed. |
| Root lint found `routeCapability` at 51 lines | Remove its redundant single-use logger local; final root lint passed. |
| Clippy rejected common `ApiKey` Rust variant suffixes | Shorten only internal variant names and explicitly retain every original serde wire name; strict Clippy and golden parity passed. |

The three intentionally skipped lib tests sample the real clipboard, foreground window or process list.
They were outside this fake-only validation scope and are not claimed as passed.

## Actual process and artifact evidence

[Artifact evidence](./c1a-artifact-evidence.json) records exact paths, runtime/adapter/manifest digests, dependency
versions, copied-resource comparison and process readback.

The Windows fixture was a newly created dedicated directory:
`C:/taki-c1a-fixture-609ad25fef7f46b6a9c30b4b510b43f8`.
Only that new directory's DACL was protected for current user, SYSTEM and Administrators, with inheritance to its
new contents. Production parent-chain checks remained unchanged; unsafe H: or system Temp ancestors were never
made acceptable by relaxing the verifier or changing their permissions.

The explicit ignored tests exercised
`hindsight_windows::VerifiedInstallation::open -> verify_runtime -> prepare -> run_bounded`, the production
compiled `app/main.js`, actual TSC1 decode and the fixed get-only key frame. The adapter executable was built
from `apps/hindsight-host/test-fixtures/fake-key-adapter.rs`; it only emits a fixed **fake** key and never reads
Credential Manager. The runtime was a copy of the installed Node **v24.18.0**, not a PATH lookup or downloaded Node.

- Build identity: `taki-hindsight-host-c1-v1`, Windows x64; **794 manifest entries** plus the manifest.
- Final fake-payload manifest SHA-256:
  `41c76dd260a7cbb2b36318649e0ad0c24a6cb38540b0c1ae34bc95517d428cf1`.
- Runtime SHA-256: `9a4eb5f1c29c6a2e93852ead46b999e284a6a5ca8bab4d4e241d587d025a52de`.
- Locked copied versions: libsodium/wrappers 0.8.4, zod 4.4.3, ws 8.21.0, json-rpc-2.0 1.7.1.
- Missing and tampered manifest, main executable module, adapter, zod metadata and Node runtime all refused.
  A valid runtime with a false registered version also refused its actual version probe.
- The parent process supplied malicious `NODE_OPTIONS` and `NODE_PATH`; the preload sentinel file remained
  absent. The returned prepared status contained no fake secret sentinel; the encrypted fake Catalog was unchanged.
- Full-tree consumption verified local dependency closure outside the checkout. Windows owner/ACL/path/opened
  file protections were real OS primitives, not mocked boolean flags.

The [real Core smoke script](./c1a-core-boot-smoke.mjs) is separate from Vitest.
Its [result](./c1a-core-boot-result.json) records PID **33200**, owned port **12013**, a fresh
`core-boot-1Ja51D` data directory, `dotenvLoaded: false`, `verified: true`, exit 0 and no prohibited calls.
The Catalog opened locked with no key source. Missing installation returned the bounded unsupported status,
forged receipt parameters refused, and ordinary setup status was unchanged.

## Cleanup and remaining acceptance

[Cleanup evidence](./c1a-cleanup-evidence.json) records post-cleanup readback:

1. Removed the complete C: fake-only root, including copied runtime, fake adapter/Catalog, Linux distribution
   and fresh Core data.
2. Removed `apps/desktop/src-tauri/target/hindsight-resources-LdMCA6`.
3. Removed only its verified mapped `apps/desktop/src-tauri/target/debug/hindsight-host/payload` tree.
4. All three paths were absent afterwards. Exact fixture executable queries and the Core boot PID query returned
   no processes before/after cleanup. The existing Cargo target/cache remained in place.
5. No original data, credential, service or existing directory permissions were changed. H: free space after
   cleanup was **14,580,424,704 bytes**.

The independent C1a checker should review source, lineage and evidence before Root admits C1b.
Ubuntu effective-UID/systemd/credential execution, final Windows MSI/NSIS installation and live OS credential
round-trips remain unexecuted platform/manual gates. Windows logged-in-user availability and Ubuntu explicitly
installed same-UID service availability remain distinct. C1b Native bootstrap and C2a actual isolated Docker
delivery/restart/readiness are not implemented or accepted by this C1a handoff. Governance revision 2 requires
the matching updated Host enforcement path; legacy fixtures remain parseable without granting old authority.

Source and the sole heavy-check slot are ready for explicit release to Root. No further implementation,
regression expansion, task archival or Git lifecycle action is included.
