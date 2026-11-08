# C2b loopback relay independent review

Date: 2026-10-27. Reviewer: `/root/relay_check`. Root session:
`01a17d4f-80ca-7f53-8d2e-cefb89cd4908`.

## Verdict and release

**PASS_SOURCE_ONLY after the fixes below.** The complete packet is released to Root; the reviewer
has stopped editing. This is independent source acceptance for the bounded transport diagnostic,
not transport, installed Host, Native API, PostgreSQL, authentication, receipt or setup acceptance.
`deploymentReady` remains false. Root still owns fresh preflight, the sole runtime and cleanup.

Final `docker-loopback-relay/release.json` SHA-256:
`2d3f0c9ad86bcb5e5d956e9d4797edee4e1056b274958ae781b548b4d8cb954f`.

Workspace was verified as `H:/TakiAgent`, `main`, HEAD
`e260ff4b0bf663b5faa0187bc6ec701fd2f007cd`. The global task pointer is empty; Root explicitly
supplied this C2 task. The initial IN_PROGRESS checkpoint was persisted before packet review.
No task pointer, metadata, production source, dependency or concurrent D1 edit was changed.

Read the PRD, design, implementation/check manifests and their referenced contracts, current
continuation, topology delta, original release report/static evidence, README, release and all
eight scripts. Read all 484 lines of the oversized C2b plan directly in chunks and independently
matched SHA-256 `0e4bdf03c903d6bbdca4d0bbfc187de14bb6c9fd8119b816bbfa7e69db0cd803`.

The original ten-file packet is retained byte-for-byte under
`c2b-relay-independent-review-01a17d4f-static/released-before-review/`; all original eight source
pins and release hash `8b47311d6518ce9941cfce148d806826ea375466da24cf568acb51f5447703c4`
matched. Original author evidence and the failed slice-1 result are unchanged.

## Findings (fixed)

1. **File: `docker-loopback-relay/run-relay.mjs:12`.**
   Issue: the pinned cached image omits `Config.Volumes`; Docker's dot-field template fails before
   container creation with `map has no entry for key "Volumes"`. This is a reachable blocker,
   established by Root's retained first read-only preflight and independently read here.
   Fix: use `{{json (index .Config "Volumes")}}`, preserving the existing rejection of every
   nonempty declared-volume map. Root's second read-only preflight on the same image returned
   the exact pinned Linux/amd64 image and `null`; no absence or failure is recast as a valid image.
   Root separately evaluated all 30 container projection fields without exposing unrelated argv
   or environment; that check returned exit 0. Both failed and corrected preflight files remain.

2. **Files: `docker-loopback-relay/fixture-server.py`, `stream-relay.py`, `observe-reaping.py`.**
   Issue: scoped Ruff found three unsorted import blocks and unused `sys`; format checks failed
   for all three files. Linux-target ty rejected nullable `OSError.errno` as an integer map key.
   Fix: organize imports, remove unused `sys`, apply Ruff formatting and explicitly map a missing
   errno to the existing `UNKNOWN` refusal. The expected network-refusal classes remain closed.
   AST comparison proves the transfer/reaping algorithms are unchanged apart from that explicit
   None guard and import cleanup; no packet Python code was evaluated.

3. **File: `docker-loopback-relay/run-relay.mjs`, final stream evidence projection.**
   Issue: the destructuring omission of the `closed` Promise caused a scoped `no-unused-vars`
   failure. Fix: explicitly project the same safe stream facts, excluding the Promise and live
   command object. The transport, wait order and evidence meaning are unchanged.

`README.md` now points to this current independent release and explains the verified optional
image field. `release.json` has the final eight source pins and the original-release reference.
No production template/export/detection or `.trellis/spec/` update is needed: this packet remains
task-local diagnostic code and preserves the already documented topology and evidence boundary.

## Findings (not fixed)

None within the diagnostic source scope. Runtime assumptions listed below remain unexecuted
acceptance conditions, not source defects or claimed successes.

## Actual path review

| Requirement | Verified source behavior and limit |
| --- | --- |
| Fixed programs/arguments/environment | `launch.mjs` validates the actual Node path/version/hash and all eight source hashes, then imports the checked in-memory module bytes. Docker uses its fixed absolute executable/hash, explicit engine/config, `shell:false`, hidden windows and only SystemRoot. Python uses the fixed isolated interpreter, fixed code and marker. There is no caller-selected destination, program, environment map or TTY. |
| Loopback and isolation | Host binds only `127.0.0.1:58118` and must observe a second bind fail with EADDRINUSE. The one container uses network none, no publication/mount, read-only root, UID/GID 1000, fixed resource limits and dropped capabilities. Its trusted fixed fixture reports actual listener inode/process/UID/route facts; four IPv4/IPv6 probes accept only declared network-unreachable or unsupported-family classes. |
| Transfer and backpressure | Host admits at most two exec streams and counts 64 KiB per direction. Python has bounded pending buffers, selector read/write interests and cumulative transfer caps. The first client/server require actual request/response bytes and digests, fragmented reads/writes, stdin EOF, target half-close, response EOF and both socket/CLI close. No output truncation can pass. |
| Reset and reaping | The second client uses TCP reset only after its exact 512-byte acknowledgement; Host records abort without normal input EOF, ends the original exec stdin and permits one second before terminating that CLI. A separate fixed observer reads exact PID/start identities and marker absence, including zombies, while requiring the original PID-1 server unchanged. No observer signal/reap/replacement path exists. |
| Identity and effects | Every Docker dispatch snapshot is flushed before spawn. Exact image/name/labels/settings and returned 64-hex CID are checked before the sole start. Subsequent effects use that original CID; the observed initial StartedAt is preserved. There is no create/start/grant/data replay. |
| Lost replies and cleanup | Unknown create reply or unproven create settings retain the original inspect result, stage and failure; no name-only adoption/deletion follows. A known original CID can be checked/stopped/removed, with absence proved by CID and name. A lost stop/remove reply remains failure for Root reconciliation. CLI close and port release are separate required observations. |
| One total deadline | `run()` captures one monotonic 60-second deadline; work ends by 40 seconds and cleanup/archive share the original remaining budget. Cleanup never allocates another 60 seconds. Late work or preservation cannot produce a passing disposition. Per-command timeout/termination and client waits remain bounded by that clock. |
| Persistence and deletion | A create-only flushed pending snapshot plus atomic rename protects command dispatch/results. Interrupted pending writes block more effects. Archive copy/hash readback, exact ancestors/marker/closed file set and size bounds precede removal of only S; unproven cleanup retains S. The runtime archive and source are never recursive removal targets. |

The published release is an externally reviewed input, not a self-attesting trust root. Root must
verify its hash before launch. This diagnostic does not claim protection from malicious code
already controlling the same trusted Windows user or daemon.

## Verification

- **Lint: PASS.** Five `.mjs` sources: ESLint 10.6.0, `@eslint/js` recommended with the actual Node
  globals, no errors/warnings. Three `.py` sources: Ruff 0.14.9 E/F/I (E501 excluded), plus format.
  Root ESLint intentionally ignores `.trellis/**`, so a scoped checker parsed actual packet text;
  an ignored-file result was not counted as lint success. Production size rules/package suites
  were not applied to this fixed diagnostic. An initial checker omitted Node's URL global;
  the checker-only correction and its first output are retained, not reported as a packet defect.
- **TypeCheck: PASS.** ty 0.0.8, Linux platform, all three Python files. JavaScript has syntax/lint
  coverage; no TypeScript or production typecheck result is claimed.
- **Tests/static checks: PASS within scope.** Pinned Node 24.18.0 `--check` for five files;
  Python 3.12.7 `compile(..., 'exec', dont_inherit=True)` for three, without execution; AST semantic
  comparison against preserved originals; exact eight-file release pins, ten-file source set,
  strict UTF-8/no BOM/whitespace/64 KiB bounds, unchanged plan/topology/prior failure, tool hashes,
  no `__pycache__`, and currently absent runtime stage/archive. No protocol/runtime test was run.
- **Runtime: NOT RUN.** Zero Docker invocations, listeners, network calls, containers, package suites,
  builds, dependencies, original data/keys, model calls or Git lifecycle actions by this reviewer.
  Root's read-only preflight evidence is separately attributed and hashed in `final-integrity.json`.

Reproducible check commands from `H:/TakiAgent`:

```powershell
$r = '.trellis/tasks/10-14-hindsight-managed-deployment/research'
& 'C:/Program Files/nodejs/node.exe' "$r/c2b-relay-independent-review-01a17d4f-static/check-javascript.mjs" after
& 'H:/hindsight/.venv/Scripts/ruff.exe' check --no-cache --select E,F,I --ignore E501 "$r/docker-loopback-relay"
& 'H:/hindsight/.venv/Scripts/ruff.exe' format --check --no-cache "$r/docker-loopback-relay"
& 'H:/hindsight/.venv/Scripts/ty.exe' check --python-platform linux --output-format concise "$r/docker-loopback-relay"
& 'G:/anaconda3/python.exe' -I -B "$r/c2b-relay-independent-review-01a17d4f-static/check-python.py"
```

Evidence: [final integrity](c2b-relay-independent-review-01a17d4f-static/final-integrity.json),
`before/after-javascript.json`, `before/after-python.json`, `after-python-ast.json`, the original
packet directory and `original-source-hashes.json`. These checks read/parse packet code only.

## Final source identities

All paths in this table are under `docker-loopback-relay/`.

| File | SHA-256 |
| --- | --- |
| `launch.mjs` | `3f37cf4acfc285a19721b206edc6ce11786a54e860b55d12cb0724b18e19ab63` |
| `run-relay.mjs` | `72a5a5123840e3e4839fc96c1188802c5d9cf0f0838da073b92a39d9771af1c1` |
| `docker-commands.mjs` | `9e602b34f79adfe5c0cf2050846e8a72e263291cd647de2bbc92240ebabc3a73` |
| `host-transport.mjs` | `fd41bc99b6cd26f796412b078dde498aa6e222527d7fa379a5a2b0eae679eaa3` |
| `evidence-store.mjs` | `9f259d786721c0b6bbeeda8b6a3383c131a72d9949db60849aef01604f26d6e9` |
| `fixture-server.py` | `779c3eb26d0b0078b41bb9809231516ee173d2b3ff38a163108c440cb6fdc4be` |
| `stream-relay.py` | `fe6f865fe38c0656724fdbd7f64b775e926db5635ebfcbd8c0be6e46fb5968b0` |
| `observe-reaping.py` | `101ffca07459081a4ac85ebadfea63af5d8ae7782706bd02d608d4d1534f82f7` |
| `README.md` | `42937a1d68cdd5e3009d59b2aa430ef2ef15fd26550e04010bc45ec487ee810a` |
| `release.json` | `2d3f0c9ad86bcb5e5d956e9d4797edee4e1056b274958ae781b548b4d8cb954f` |

Changed packet files: `run-relay.mjs`, the three Python files, README and release. Added only this
report and its `c2b-relay-independent-review-01a17d4f-static/` evidence/checker directory.
The other four executable files are byte-identical. No source or report ownership remains held.

## Runtime preconditions and limits

Root must hold the sole runtime/heavy slot, independently verify the final release and tool hashes,
refresh exact Engine/image/workload/port/resource absence, then execute once using the README's
cleared-environment launcher. Token `9a276b18-7fa2-4421-869c-88f0d89aec01` remains unconsumed by
this review; any stage/archive creation consumes it and forbids replay.

Actual Windows/Docker stdin/EOF/reset/exclusive binding, Linux routes and errno classes, pidfd
observation, graceful fixture stop and completion/cleanup within 60 seconds remain required runtime
proof. The observer may reject unavailable `/proc`/pidfd behavior; it cannot substitute guessed
absence. Checks demonstrate source bounds, not forced saturation or production throughput.

Synchronous filesystem or OS hangs are not preemptible by the JavaScript clock. The independent
65-second outer watchdog is containment only and cannot extend the 60-second acceptance budget
or prove Docker effects absent. On interrupted evidence/unknown cleanup, preserve the original
stage, archive, dispatch and original resource identity for Root's bounded reconciliation; do not
rerun, adopt by name, broaden deletion or alter the shared daemon.

Even a later transport PASS does not satisfy the installed application/artifact gate, actual API/PG
lifecycle, authenticated service binding, trusted lookup, definition-only managed setup, C1 platform,
remaining C2a fault/daemon cases, C3/C4/D2 or owner acceptance. The original slice-1 FAIL remains intact.
