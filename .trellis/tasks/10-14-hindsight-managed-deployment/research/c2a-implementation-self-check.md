# C2a implementation self-check

Date: 2026-10-14. Implementer: `c2_implement`.

**Implementation self-check complete; independent SOURCE verdict pending.** This report prepares the
source/check-slot handoff to Root. It does not mark the PRD accepted or authorize actual Docker,
database, credentials, models, C2b receipts or installed-platform acceptance. Every C2 status retains
`deploymentReady: false`, and managed setup still refuses new managed receipts.

## Source boundary and changes

- Taki: `H:/TakiAgent`, `main`, HEAD `2e244d0fdee49fb2c582a4333a9ef1573fa9112a`.
- Native: `H:/hindsight`, `main`, HEAD `eb6413a7f58c4f3f0adb88a33a99516f8707fef7`.
- Session/task: `codex_01a1309f-e374-7241-ab38-4e50f040d985` /
  `.trellis/tasks/10-14-hindsight-managed-deployment`. The authorized session binding was retained;
  the empty legacy `.current-task` was not rewritten.
- [Final source manifest](c2a-implementation-source-manifest.json): **109 changed source files**,
  99 Taki and 10 Native; 45 modified and 64 added, with no source deletion. This compares the preserved
  per-file pre-C2a baseline, including prior dirty work, rather than attributing the whole Git diff to C2a.
- The retained baseline has 113 entries: 111 source candidates plus this report and its manifest. The
  two task artifacts are excluded from source counts. `hindsight-custody-boot.ts` is byte-identical to
  its baseline; the initially misplaced Core test is absent both before and after this work.
- Source tree fingerprint: `b0e7896be6c5e49c7d588fb59a537787c1614c6bc302cacda30372c001eca2f9`.
- Manifest SHA-256: `f27379be3b4b5e61e1b2821c2eda2d87bf54e5c2983b034bdb637ee789961ae2`.

| Scope | Main changed files / responsibility |
| --- | --- |
| Shared | `hindsight-deployment-schema.ts`, narrow package export, governance registry and 24 protocol fixtures: exact plan, independent effects, checkpoint/permit, registration and bounded status. |
| Core | `hindsight-deployment-owner.ts`, boot composition, Run idempotency lookup, operator/checkpoint methods, route/broker/checkpoint/outcome integration and C1's internal accepted-handle description. Core owns real Run/Attempt/Effect admission and remains the sole Catalog writer. |
| Rust Shell | Deployment protocol, resident owner, checkpoint relay, protected installation/state lock, actual Gate/classification/advertisement and current-session execution. C1's one-shot process lifetime remains separate. |
| Installed Host | `deployment-host.ts`, owner, registry, injection, registration, fixed Docker adapter/process and fixed-slot selection. `main.ts` makes the concrete owner reachable through the existing import-walking builder. |
| Native | Fixed owner/control protocol and fake consumer/child, the fixed socket-name extension, dedicated `Dockerfile.c2a-fake`, process fixtures/tests and README. The image recipe was not built. |
| Verification/docs | Core/Host/Native process regressions, fixed-adapter/registry tests, copied-install fixture and fake Docker executable; affected source indexes and Host/Native READMEs. The manifest lists every file and before/after hash. |

## Executed chain and substitution

The copied-install test runs a real operator RPC through **Core main and its real Run/Effect stores ->
Rust `taki-node` canonical Gate -> protected copied Node Host resident -> unchanged production
`FixedDockerAdapter` -> explicitly registered test fake Docker executable -> parent-owned Native owner
and real fixed child**. The fake executable forwards its fixed argv/private input through a fixture-owned
Windows named pipe. It never calls Docker. Core uses a new fake Catalog and a loopback dummy provider at
`127.0.0.1:9`; it does not load `.env.local` or call a model.

The narrower process matrix uses the actual Host owner in separate Node helpers, a real on-disk registry,
and the same real Native owner/child behind a bounded injected engine adapter. The parent keeps Native
alive across helper death. The Core matrix adds actual Run/Effect repositories and the canonical broker;
the installed test additionally exercises the real Rust/WS/payload path. Only the admitted happy/repeat
case is duplicated at this outer layer.

Latest installed proof:
`G:/Temp/taki-c2a-source-20261014-impl/taki-c2a-fixture-5010ba6e-0e22-406e-9da4-35fbc11e768c.json`.
Its SHA-256 is `57da9f007a9c03f3017cee97d2dd1077b93ec47b793c6fc7dc82e565c77b8eaf`.
It records a completed original Run `b8645c0b-689c-4a25-af6b-1a384bfd7020`, three admitted effects,
exactly one volume create/container create/start/grant/submit, 1,301 private submission bytes, original
startup `a706acfb-2267-419b-8821-67e14b0f6716`, and child PID 30068. Cleanup verified that PID exited.

| Executed artifact | SHA-256 |
| --- | --- |
| Copied Host payload manifest | `6862de6c33a7fb226fe4de16bda409640ada33a06860049cdeee5c5863a737e4` |
| Registered Node 24 runtime | `9a4eb5f1c29c6a2e93852ead46b999e284a6a5ca8bab4d4e241d587d025a52de` |
| Rebuilt `taki-node.exe` | `1ed31593324eaea703590e6dd12b348dfe99c38c7530207b12c89300e8a582c9` |
| Registered test fake Docker executable | `4d8503d8acfb1e2e96bf8df58e7f28b520119168476820d1b9752549e5d3fb63` |

The artifact evidence identifies the substituted engine explicitly. A running fake child, simulated
container metadata and a volume marker are not Docker, database or model readiness.

## PRD source-criterion evidence

These are implementer evidence mappings; independent acceptance remains with Root and the checker.

| C2a criterion | Exercised evidence |
| --- | --- |
| 1. Independent admission, private consumer and packaged reachability | `deployment-installed.test.ts:11` reaches the copied owner/adapter through actual Core/Rust; `deployment-core.test.ts:185` checks real Run/Attempt/Effect and one-use checkpoint; Native owner tests require an independent grant before the actual child starts. |
| 2. Durable original-resource recovery without replay | `deployment-owner.test.ts:60` kills the helper after volume create, container create, start, grant and submit. Reopening observes original facts with unchanged effect counts. `deployment-core.test.ts:201` reopens the actual Core DB and Host registry with fresh snapshot/custody unavailable; repeat, conflict and concurrent requests keep the original Run. Registry tests cover stale publication, external replacement and corrupt/missing ownership. |
| 3. Exact ownership and current authority | Fixed-adapter tests reject wrong engine/image/container/volume/user/network/ports/tmpfs and extra bind mounts. Core pending-checkpoint cases reject foreign Host/startup, Catalog ABA, config/Host/policy drift and cancellation. Native cases reject wrong startup/config/selection and expiry. Shared/Rust strict fixtures reject malformed/null/extra-field inputs and missing lifecycle identity. |
| 4. Containment and sole Catalog writer | The installed test scans public result, registry, argv, audit and captured Core/Node/Native logs for all generated values. Host tests additionally scan registration/state/child-marker files. Seven non-fake selected/inherited paths produce zero checkpoint/grant/submission bytes; Native checks fake-only input independently. No credential frame is sent over WS or Docker environment options. |
| 5. Observation, new startup and compatibility | Native tests observe the same child after admission expiry. Host and Core tests restart the real Native owner, retain original container/volume, and require fresh startup authority; `deployment-core.test.ts:224` pins the startup Run key, original parent Run, one new inject Effect and no duplicate replay. Read-only recovery has no create/delete path. The 42 Core broker/challenge/route/C1-custody/Catalog regressions pass. |
| 6. Quality, cleanup and independent review | Affected checks and actual copied-entry reachability pass below. Source/registry/process ownership and cleanup are recorded. The checker reviewed S1/S2 and the final S3 correction read-only; its final SOURCE verdict and Root's PRD acceptance are still pending. |

## Corrections retained in this implementation

- **Real snapshot mutation:** Run snapshot capture writes `interactive.runId`. Passing the same object into
  C2 admission polluted the separately owned C1 attempt identity in the actual installed chain. Both C2
  admissions now pass a top-level copy; the Core fixture reproduces the production mutation. This keeps
  C1's independently minted operation/attempt intact.
- **S1, final currency and unknown outcome:** broker currency and semantic C2 outcome are checked before
  Effect settlement. A current checkpoint/grant/submission fence prevents post-dispatch failure from
  becoming a definite refusal; a historical fence from another call does not relabel a new pre-dispatch
  refusal. Post-route currency drift suppresses accepted publication, and known original identities map
  the public result to `outcome-unknown`. Core/Host regressions preserve the actual child and forbid replay.
- **S2, actual Run settlement:** the owner consumes `RunStatusResult` and checks Run, active attempt and
  both outcomes. A successful non-throwing call that actually returns cancellation or another attempt
  cannot publish its earlier `running` payload.
- **S3, resident destruction order:** `DeploymentInstallation::drop` explicitly drops/takes the resident
  before installation guards or `deployment.lock` are released. `ResidentProcess::drop` closes its Job,
  waits for the helper and joins its pipe readers first. The independent readback confirmed
  `deployment.rs` SHA-256 `f1467d3b7e86781426f0cd799ec76a68bbc9d5ad9d0e37ff4dccab708b192dc6`.
  Strict Clippy, focused Rust tests, rebuilt Node and installed cleanup were rerun. This does not claim
  a dedicated contention stress test for the narrow destruction interval.
- **Native PID truth:** Windows venv redirection initially produced a different child marker PID from the
  supervised process. The fixed fake consumer uses the base executable plus `__PYVENV_LAUNCHER__` context;
  the actual leaf PID is now supervised, observed and absent after close.
- Fixed-adapter validation rejects extra mounts and duplicate tmpfs entries. Rust boxes the large effect
  enum arm. Registry creation remains explicit: only the provisioned vacant record can accept a first
  plan; missing/corrupt state never initializes, adopts or recreates anything.

## Checks and retained first failures

All checks were serial; Vitest used at most two workers, with one worker for the final suites. Rust reused
`apps/desktop/src-tauri/target`, with dev/test debug information 0, incremental `false` and debug assertions
retained. Runtime versions verified here are Node `v24.18.0` and Native Python `3.11.5`.

All exact programs, arguments, working directories, start times, exit codes and retained log hashes are
in the manifest's `checks` array and
`G:/Temp/taki-c2a-source-20261014-impl/checks.jsonl` (**54 records**, including failures).

| Check record(s) | Result / scope |
| --- | --- |
| `c2-installed-drop-order` | 1/1 actual installed chain, after S3 and rebuilt Node; 34.49 s Vitest duration. |
| `c2-installed-final-2` | 16/16 across installed + Core files, including the new real `resumeStartup` regression. Core production/test inputs are unchanged since this pass. |
| `c2-core-host-regression-3` | Host file 17/17, including all five helper-crash points and post-submit drift. This combined command had one Core public-state failure; the later Core runs below repaired and passed it. |
| `c2-core-adapter-regression-4` | 27/27: then-14 Core tests, 10 fixed-adapter tests and 3 registry tests. Final Core coverage is 15/15 above. |
| `core-c2-broker-compatibility-1` | 42/42 broker, challenge, route, C1 custody owner and Catalog custody cases. |
| `shared-c2-protocol-2` | 121/121 schema, golden fixture and governance cases. |
| `rust-c2-lib-tests-2` | 182 passed / 4 old C1 copied-install fixtures ignored before the final Box/Drop refinements; retained as broader prior evidence. |
| `rust-c2-focused-drop-order`, `rust-c2-wire-final` | Final affected Rust tests 10 passed / 4 old C1 fixtures ignored; latest protocol-shape change also passed the actual golden fixture test. |
| `rust-c2-clippy-drop-order`, `rust-c2-node-build-drop-order` | Strict all-target Clippy and rebuilt `taki-node` pass. The MSVC build emits its informational library/export linker message; no strict Clippy warning remains. |
| `core-types-3`, `shared-c2-types-2`, `host-c2-types-final-2` | Affected package type checks pass. |
| `c2-ts-lint-final-2` | 43 baseline-filtered TypeScript files pass scoped ESLint. |
| `native-c2-process-final` | 4/4 real Native owner/child, expiry, fake-only and strict-control tests. |
| `native-c2-ruff-2`, `native-c2-format-check-2`, `native-c2-ty-2` | Eight changed Python files pass scoped Ruff, format and ty. The Linux ty target is static checking of Linux-specific code, not Linux execution. |
| `taki-c2-diff-final`, `native-c2-diff-final`, `c2-source-text-final` | Tracked working-tree whitespace checks pass with line-ending notices; all 109 changed source files, including untracked additions, pass UTF-8/no-BOM, introduced-whitespace and preserved-baseline-hash checks. |

The legacy local check wrapper creates no log file when a command is completely silent. The manifest
explicitly records this for `fixture-key-build`, `c2-ts-lint-2`, `c2-ts-lint-final` and
`c2-ts-lint-final-2`; their original command/exit records remain. No missing raw log was fabricated.

First failures were retained, not overwritten:

- `core-types-1/2`, `host-types-1`: required broker/Run test stubs and the cross-package test placement;
  corrected without weakening public types. The Core integration test now belongs in Host's test scope.
- `shared-c2-protocol-1`: the factory inventory expectation still counted 32 cells; the four explicit C2
  cells and their posture/once-only contract are now reflected and validated.
- `native-c2-1`, `host-c2-process-1`: actual child/PID startup failure; repaired by the venv leaf-PID fix.
  `core-c2-process-1` also retained initial read-only observation integration failures; subsequent Core
  repeat/reopen/concurrency and original-process tests pass.
- `c2-installed-1/2`: actual snapshot mutation exposed the mixed C2 Run/C1 Attempt identity; the first
  installed success is `c2-installed-3`, followed by the final retained proofs.
- `c2-core-host-regression-3`: `reason: outcome-unknown` still had public `state: unavailable`; repaired
  mapping now passes both pre-settlement and post-route drift tests.
- `rust-c2-node-build-1`, `rust-c2-clippy-1`: invalid incremental environment spelling and large enum arm;
  subsequent builds use `false`, and the effect arm is boxed.
- `c2-ts-lint-1`, `native-c2-ruff-1`, `native-c2-ty-1`: responsibility/parameter limits, imports/format and
  platform/stream type narrowing; fixed with scoped code changes, Linux static target and the explicit
  blocking SocketIO-to-BinaryIO cast. No production warning suppression or runtime relaxation was added.
- `c2-installed-final`: all functional assertions passed, but diagnostic hashing used the strict
  single-link installation verifier on Cargo's hard-linked Node build. Diagnostic hashing now reads that
  test binary directly; production file verification is unchanged. `c2-installed-final-2` passes.

## Replay and resource disposition

The existing fake-key adapter, source baseline, input lists and wrapper remain under
`G:/Temp/taki-c2a-source-20261014-impl`. Their hashes are in the manifest. The current Node binary is built.
To replay only the actual installed chain, from PowerShell:

```powershell
Set-Location H:/TakiAgent
$env:TAKI_C2A_TEMP='G:/Temp/taki-c2a-source-20261014-impl'
$env:TAKI_C2A_INSTALLED_FIXTURE='1'
$env:TEMP='G:/Temp/taki-c2a-source-20261014-impl'
$env:TMP='G:/Temp/taki-c2a-source-20261014-impl'
& G:/Temp/taki-c2a-source-20261014-impl/run-check.ps1 `
  -Name c2a-independent-installed -Program G:/Roaming/npm/pnpm.cmd `
  -Arguments @('--filter','@taki/hindsight-host','exec','vitest','run',
    'src/deployment-installed.test.ts','--maxWorkers=1','--testTimeout=20000')
```

The fixture creates only a new marked `C:/taki-c2a-fixture-<uuid>` tree and changes that tree's own ACL.
G: staging cannot satisfy the strict immutable-install ancestor ACL checks, so no G: ancestor ACL was
changed and no verifier was weakened. The fake engine and runtime stay within this fixture; shutdown
waits for Core/Node/Native children before removing its marked root. This replay starts no real engine,
service, GUI or model. Other exact replay commands are retained in the check manifest.

`owned-resources-final.json` records no remaining `C:/taki-c2a-fixture-*` root and no matching helper,
Native-owner, fixed-child or fake-Docker process. The final installed evidence also asserts `ownedCleanup:true`.
Retain the G: baseline, fake adapter, logs and replay inputs for independent acceptance. The remaining
subdirectories are `baseline` (449,547 bytes), `node-compile-cache` (9,721,684 bytes), and
`c2a-debug-br7prqzg` (one 87-byte historical PID marker, no live PID and no fixture ownership marker).
Do not treat that small diagnostic marker as a deletion-authorized protected fixture.

At the recorded resource readback, C: had 27,771,817,984 bytes free, G: 146,004,840,448 bytes and H:
13,105,487,872 bytes. Root retains the baseline until it saves the exact C2a delta and finishes independent
acceptance; no shared Rust target, T4 evidence or unrelated work was cleaned.

## Remaining limits

- Independent final source/check review is pending this release. Root owns task/spec/AC/handoff updates.
- No actual Docker daemon/container execution, image pull/build, daemon restart, tmpfs/metadata scan or
  disposable database shutdown/persistence check occurred. The dedicated fake image recipe is source only.
- Windows pipes and current process tests do not establish the new Linux control-socket path. Prior C1
  evidence is reused only for unchanged contracts; C1 Ubuntu service/platform acceptance stays open.
- No original Catalog/keyring/data/models, real provider call, trusted deployment ledger consumer, C2b
  receipt, C3 model mapping or manual acceptance was enabled. No Git lifecycle action occurred.
- The fixed single-deployment registry remains bounded at 1 MiB / 64 attempts, requires an explicit vacant
  provisioned record, and claims process-crash recovery rather than Windows power-loss durability. Unknown
  original outcomes require observation; this slice adds no same-startup retry or resource deletion API.
