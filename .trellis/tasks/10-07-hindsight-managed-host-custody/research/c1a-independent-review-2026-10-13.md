# C1a independent source review — 2026-10-13

## Verdict and scope

**PASS for the C1a SOURCE gate after two findings were fixed.** No unresolved C1a source blocker remains.
This verdict permits Root to schedule the separately authorized C1b process work; it does not mark the overall
C1 task, manual acceptance, deployment, or Docker readiness complete. Public results retain
`deploymentReady: false`.

Reviewed workspace: `H:/TakiAgent`, `main`, HEAD
`2e244d0fdee49fb2c582a4333a9ef1573fa9112a`. The active task is session-bound; the empty global task pointer
was not changed. Root retained ownership of task metadata and the overall handoff. Existing Stage 5A/5B work
was preserved. No commit, push, reset, rebase, finish, or archive action ran.

The review loaded the PRD/design, all 19 curated context entries, current source-release handoff, implementation
evidence, and the Windows API correction. It traced Shared/Rust schemas, the boot-free TSC1 extraction,
Core Catalog snapshots, broker issued/final-accepted provenance, the owner WeakMap and post-await checks,
existing-instance compatibility, Shell execute/resume/cancellation, actual Windows verification/process
ownership, installed ESM packaging, and the Node/Linux release and enrollment paths.

## Findings fixed

### 1. The Windows registered Catalog lacked its own OS protection checks

Files: `apps/desktop/src-tauri/src/hindsight_windows/catalog.rs`, `objects.rs`, `invoke.rs`,
`tests.rs`, and the module declaration/indexes.

The Windows verifier protected installed artifacts, runtime, and adapter, but the actual registered
`coreDataDirectory/secret-catalog.bin` did not receive corresponding Windows owner/DACL/parent/reparse
verification. A real copied-install regression added an Everyone-write ACE to the newly created fake Catalog.
The production `VerifiedInstallation::open -> prepare` path still returned `Prepared`; the new test failed.

The fix verifies the registered Catalog directory and every ancestor, then inspects the actual leaf handle for
owner/DACL, local NTFS, final path, file ID, file kind, no reparse/hard link, and a bounded sealed-byte digest.
Only immutable path/identity/digest evidence survives the leaf read. The helper result is accepted only after
the protected parents and the freshly reopened current leaf pass their checks again. The execution deadline
is captured before this inspection so verification does not extend the fixed Host budget.

The mutable Catalog requires different sharing from immutable installed files:

- Retain list-access directory guards. The immediate Catalog directory permits READ|WRITE sharing and denies
  DELETE sharing. Open the replacement guard before releasing its restrictive predecessor.
- Close each temporary leaf read immediately after inspection. READ|WRITE|DELETE sharing on a retained leaf
  alone did not make Windows overwrite publication safe in the isolated probe.
- Keep immutable payload/runtime/adapter file locks unchanged.

Two intermediate positive-publication failures are retained. Closing only the leaf still left Windows error 32
because the destination-directory guard denied write sharing. A real `CreateFileW` probe with
`FILE_LIST_DIRECTORY | FILE_READ_ATTRIBUTES | READ_CONTROL` isolated the required combination:

| Directory sharing | Same-directory leaf overwrite | Guarded parent rename |
| --- | --- | --- |
| READ | Refused, error 32 | Refused, error 32 |
| READ + WRITE | Succeeded | Refused, error 32 |
| READ + DELETE | Refused, error 32 | Succeeded |
| READ + WRITE + DELETE | Succeeded | Succeeded |

The final production-path tests pass: normal fake Catalog preparation; unsafe Catalog leaf/parent DACL refusal;
real junction refusal; successful Core-style staged rename; stale detection even when replacement bytes are
identical; and continued parent-rename refusal. No retry layer, additional writer, alternate Catalog source,
permission repair, or Native effect was introduced.

The fixture script now creates its owned Catalog junction, and the README, touched indexes, and
`.trellis/spec/backend/hindsight-host-custody.md` document the actual mutable-directory/leaf contract.

### 2. Rust's C1 optional-field parsing diverged from Shared

File: `apps/desktop/src-tauri/src/hindsight_custody_protocol.rs`; fixtures under
`packages/shared/fixtures/protocol/hindsight-custody-invocation.*.json`.

A golden frame with explicit `authorization: null` failed the Rust rejection expectation: Serde converted
JSON null to `None`, while Shared permits absence only. The same issue applied to optional C1 nested control
fields. C1 parsing now rejects explicit null before deserialization for authorization, coreAttemptId, effectId,
and expiresAt. Each null field has its own golden regression.

C1 control UUID/digest/timestamp validation now uses the C1/Shared semantics, including valid nil UUIDs,
without changing the general Host parser. The fifth new golden is a positive nil-control-UUID frame.
The Rust golden test and all 91 Shared golden cases pass.

## Verification

The independent [command log](./c1a-independent-check-log.json) contains **18 completed records**, including
the original null and unsafe-Catalog reproductions, both intermediate Windows publication failures,
the minimized sharing probes, repaired checks, and cleanup. No failed record was discarded.
Heavy checks ran serially. Vitest used one worker. Cargo used the existing target, `--locked --offline`,
dev/test debug 0, and incremental 0; debug assertions were not disabled.

| Independently rerun check | Result |
| --- | --- |
| Windows C1 tests, including all four explicitly selected copied-install tests | 10 passed, 0 failed, 0 ignored; 172 unrelated tests filtered out |
| Rust protocol golden parse/reject/round-trip | 1 passed |
| Shared protocol golden fixtures | 91 passed |
| Shared and installed Host typecheck | Pass |
| Root `pnpm lint` | Pass |
| Rust `cargo clippy --all-targets --locked --offline -- -D warnings` | Pass |
| Tracked `git -c core.safecrlf=false diff --check` | Pass |
| Final copied-artifact, Catalog, sentinel, and process readback | Pass |
| Owned fixture cleanup and post-cleanup readback | Pass |

For unchanged areas, the review reused the implementation's
[37-record log](./c1a-check-log.json) and [handoff](./c1a-implementation-handoff.md):
Core custody/owner/broker 30 tests, codec/service/setup/recovery 34 tests, installed Host 22 tests,
the repaired Shared governance cases, non-invasive Rust coverage, real Core main/WS smoke, and the actual
Tauri resource-map build. Those suites were not rerun wholesale. Linux evidence remains build/syntax only.

The [independent source manifest](./c1a-independent-source-hashes.json) contains **128 inputs**:
the original 122, one new Catalog module, and five new golden fixtures. Eleven original inputs changed during
this review; their previous and final hashes are recorded. The final golden/type/lint check interval had
**zero changed inputs**. This manifest identifies reviewed inputs; it does not claim authorship of all
pre-existing changes. The tracked whitespace command does not cover untracked files; C1 source files were
covered by the applicable compiler/linter and source manifest.

## Actual fixture and cleanup evidence

The independent copied installation used only the newly created
`C:/taki-c1a-fixture-86700c396b3348a7addf83ffc8273674`, marked `C1A_FAKE_ONLY`.
Only owned fixture objects received fixture DACL changes. No existing installation/data ancestor was repaired.

[Artifact evidence](./c1a-independent-artifact-evidence.json) records:

- Real compiled ESM payload: 794 manifest entries plus the manifest; all hashes match.
- Manifest SHA-256: `6aaba2c416d0038c521c3d6a7d2042d5116dd1787bdf7a957e2473a1333607a4`.
- Copied Node v24.18.0 and a separately built fake-only get-key adapter; actual registered runtime/adapter
  digests match. The adapter never accesses Credential Manager.
- Actual locked copied dependency versions: sodium/wrappers 0.8.4, zod 4.4.3, ws 8.21.0, json-rpc-2.0 1.7.1.
- The fake encrypted Catalog digest is unchanged. The malicious-preload sentinel is absent, and the production
  test asserts no fake secret in the returned status. NODE_OPTIONS/NODE_PATH poisoning was scoped to the test
  command process.
- No process with an executable under the exact owned fixture root remained.

[Cleanup evidence](./c1a-independent-cleanup-evidence.json) confirms that the root path and ownership marker
were checked, its only junction was verified to target the same owned root and unlinked first, then the root
was removed. The fixture and its executable processes were absent afterwards. This also removed the isolated
leaf/directory-sharing probe files. The existing Cargo target was retained. H: free space after cleanup was
14,580,150,272 bytes. The implementation's already-cleaned older fixture was not touched again.

## Findings not fixed / remaining acceptance boundaries

No unresolved finding blocks this C1a SOURCE verdict. These previously separated gates remain unexecuted:

- Actual Ubuntu effective-user/systemd/credential-source execution.
- Final Windows MSI/NSIS installation and real OS credential round-trips.
- C1b Native private bootstrap/process/observer implementation and its independent acceptance.
- C2a real isolated Docker delivery, restart, tmpfs, and database shutdown/readiness evidence.

No Ubuntu/Docker service, real model, original credential, or original data was used. Windows logged-in-user
availability and Ubuntu explicitly installed service availability remain distinct. Source preparation and
fixture evidence do not grant deployment/injection authority or turn `deploymentReady` true.

The reviewer has completed its code/check work and will explicitly release SOURCE and CHECK SLOT to Root
with this report. Task status, overall handoff, downstream scheduling, and manual AC remain with Root.
