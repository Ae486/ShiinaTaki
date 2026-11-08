# C2b complete dependency inventory independent source review

Date: 2026-10-28. Root session: `01a180b6-1dac-7fc2-b365-15fcb34dd4b4`.
Reviewer: `/root/relay_review_recovered`. Scope: sibling C2b dependency metadata prerequisite.

## Verdict and release

**PASS_SOURCE_ONLY after R1 correction.** Release SHA-256 independently verified:

`5fd19647e62dc6791066eb5a216d3ee9eb7fe911a5e0c49d10a97374c61a77a1`

Token `0ab89a2a-ccac-4350-a4ea-ed90ed7a3e6d` remains **unconsumed**. Its stage and archive
are absent on the final read-only filesystem check. Root may use this source verdict for the
separate fresh preflight and single bounded metadata collection. No runtime effect or comparison
against the actual installed image has occurred in this review.

Collection completeness, comparison completion, metadata compatibility, actual import/startup,
installed Host/artifact readiness and deployment acceptance remain separate outcomes.
`deploymentReady=false`; this verdict cannot close the Native API/authentication/PostgreSQL,
receipt/setup, C3/C4/D2, D1 runtime, Stage 6 or owner acceptance gates.

## Findings (fixed)

### R1 — unknown or malformed metadata could report complete compatibility

- Files: `docker-dependency-inventory/collect.py` and `compare.py`.
- Original release: `b83d9284e23ded4dbd18157a7ba3e1791661c867d8f11a0084051096d8c43a59`.
- Issue: collector only counted/read Metadata-Version, while the comparator ignored it.
  Provides-Extra validation occurred only when a distribution was reached by the selected graph.
  Raw `Metadata-Version: 99.0`, or an unvisited distribution with `Provides-Extra: bad???`,
  therefore reached `comparisonComplete=true`, `metadataCompatible=true`, with no issues.
- Evidence: [original generated challenges](c2b-dependency-independent-review-01a180b6/challenge-metadata.py)
  called actual `collect.metadata()` and `compare()` with the pinned Host parser. The retained
  [false-success result](c2b-dependency-independent-review-01a180b6/challenge-metadata.json) hashes to
  `fcef89545069de4ea47345b6d28bea7d0522f3663dcd7b829a056819b715f456` and remains unchanged.
- Root's fix: collector and comparator explicitly support metadata 1.2, 2.1, 2.2, 2.3 and 2.4.
  Unknown/legacy unsupported versions refuse. Before graph traversal, every distribution's
  requires/extras fields must be arrays; every declared extra is validated through pinned
  `canonicalize_name(validate=True)`, and normalized duplicates refuse. Existing Requirement,
  Version and SpecifierSet parsing is retained.
- This avoids blindly using packaging 24.1's full Metadata validator, which recognizes versions
  only through 2.3 and would also reject this packet's valid 2.4 metadata.
- Independent [R1 delta verification](c2b-dependency-independent-review-01a180b6/r1-verification.json)
  confirms raw unknown-version refusal, projected unknown-version refusal, unvisited invalid-extra
  refusal, and positive 2.4 compatibility. The reviewer did not modify the frozen packet.

Root preserved all eight pre-review packet files byte-for-byte under
`c2b-dependency-source-01a180b6-static/released-before-review/`; every old hash, including
the original release, was independently compared. Root added the targeted raw-version/unused-extra
regression to its nine-case fixture set and retained the corrected check records.

## Findings (not fixed)

None within the source-review scope. Unsupported metadata versions intentionally refuse; that
result must remain explicit if observed in the real base. Actual installed metadata compatibility
and runtime lifecycle behavior remain unexecuted acceptance conditions, not assumed successes.

## Verified source contracts

| Area | Verified path and acceptance limit |
| --- | --- |
| Complete collection | Fixed Linux Python `-I -B -S -` prevents site/.pth initialization. The collector imports standard-library modules only, enumerates every .dist-info directory in the fixed purelib and reads its METADATA. Legacy egg metadata, missing/nonregular/redirected/changed files, parse defects and unsupported versions refuse. Descriptions contribute to hashes but are not copied into output. |
| Bounds and failure evidence | 8,192 entries, 1,024 distributions, 512 KiB/file, 32 MiB total, 512 requirements/128 extras per distribution, 8 KiB requirement text, 1 MiB output and a 20-second alarm remain closed bounds. Failed or partial collection cannot set inventoryComplete; original stdout/stderr is retained in the command evidence even when the launcher refuses inventory publication. |
| Parser and target environment | Host Python runs with isolated/no-bytecode/no-site flags, checks its executable and all 14 pinned packaging Python files, then loads installed packaging 24.1. Requirement/version/marker semantics use that existing parser. All target environment keys come from the collector's Linux/Python 3.11 interpreter/kernel; Host Windows marker values do not substitute for them. |
| Source/base identities | Frozen source pyproject matches the current Native package bytes and remains separately hashed. The original installed application's metadata is returned separately; only its requirements are replaced in the candidate comparison. The installed application name/version must match the source identity. |
| Required graph | Initial states are mandatory application dependencies plus embedded-db. Base and requested-extra states are visited, markers use the complete target environment plus the active extra, and requirements with requested extras recursively add those states. Cycles are deduplicated; state/evaluation bounds are finite. Unselected optional packages are inventoried but not advertised as usable. |
| Comparison outcomes | Missing distributions/extras, incompatible versions/Python and unresolved direct URLs make metadataCompatible false. Malformed/unknown metadata refuses comparison completion. Issues are retained rather than replaced by an empty success. A completed comparison may be incompatible; exit 0 alone is not acceptance. |
| Fixed lifecycle | One new network-none, read-only UID/GID 1000 container; no mounts/publication/custom network/pull/build; fixed image/interpreter/collector stdin; 256 MiB/one CPU/16 PIDs, dropped capabilities, no-new-privileges, log none and restart no. No API, SQL, listener, provider or model import is introduced. |
| Original resource ownership | Dispatch persists before spawn. Exact returned CID and inspected image/name/labels/settings precede the sole attached start. Effects and later reads use the original CID. An unknown create reply or unverified settings retain observation/staging and cannot authorize name-based mutation. The normal collected startup identity is rechecked before cleanup. |
| Cleanup and time | One monotonic 60-second work/cleanup/archive bound, with work capped at 40 seconds and attached collection at 25 seconds. Known original state is checked/stopped/removed; absence requires both CID and name evidence. CLI close, archive hash readback, owned marker/ancestors/file set and size bounds precede staging removal. The outer 65-second watchdog is containment only. |
| Separate comparison | The Host comparator reads the frozen source plus the original archived inventory result and verifies its disposition-recorded hash/token. Root separately verifies collection disposition/cleanup and source pins before invoking it. Its output is metadata evidence, not a substitute for successful collection cleanup or later imports. |

`DockerCommands` is byte-identical to the independently reviewed relay helper.
`EvidenceStore` differs exactly in the owner-marker string, disposition schema and the
`result.inventoryComplete` acceptance field. The accepted relay packet/archive were neither
changed nor executed. During R1, `launch.mjs`, `docker-commands.mjs`, `evidence-store.mjs`
and `source-pyproject.toml` remained byte-identical to the preserved original packet.
The [retained delta](c2b-dependency-independent-review-01a180b6/r1-delta.diff) contains only
the reviewed Python validation and README changes.

## Verification

- **Lint: PASS.** Root's original JavaScript/ESLint and Python/Ruff records were read and their
  integrity hashes independently matched. Corrected R1 Ruff exits 0; both review-only evidence
  scripts also passed scoped Ruff. Runtime JavaScript is unchanged, so its source checks were reused.
- **TypeCheck: PASS.** Corrected collector Linux-target ty and comparator Host ty exit 0 in the
  verified R1 records. Both review-only scripts passed scoped ty. No production/package typecheck
  result or installed runtime behavior is implied.
- **Tests/static verification: PASS.** Root retains nine generated metadata/marker/extras fixtures,
  exit 0. The reviewer independently reproduced both original false-success scenarios and ran
  four targeted corrected-source checks, all passing their expected refusal/positive outcomes.
  No unchanged package suite was rerun.
- **Identity: PASS.** All six current source/input pins, eight final packet hashes, original
  eight-file snapshot, R1 evidence hashes and unchanged lifecycle files match. Node/Docker hashes
  match release pins. The actual comparator loader checked Host Python and all packaging files;
  the installed packaging source reports version 24.1. Frozen pyproject matched current source.
- **Runtime: NOT RUN.** Zero Docker/WSL/launcher/listener/build/API/SQL/provider/model operations
  by this reviewer. No dependencies, original data/keys, Git lifecycle, task metadata or agents
  were changed or created. Tiny generated metadata fixtures live only in the assigned review directory.

Evidence: Root's `c2b-dependency-source-01a180b6-static/{source-checks,r1-checks,r1-integrity}.json`;
reviewer's `challenge-metadata.json`, `r1-verification.json`, `r1-delta.diff` and
`reviewer-checks.json`. The original challenge script is historical and pins the rejected release;
do not rerun it against the corrected packet as though it were the current acceptance checker.

Reproduce the narrow current source verification only:

```powershell
& 'G:/anaconda3/python.exe' -I -B -S .trellis/tasks/10-14-hindsight-managed-deployment/research/c2b-dependency-independent-review-01a180b6/verify-r1.py
```

## Workspace and handoff

Read-only workspace verification confirmed `H:/TakiAgent`, `refs/heads/main`,
`e260ff4b0bf663b5faa0187bc6ec701fd2f007cd`. Root explicitly assigned this sibling C2b
review while its main session remains on D1; the earlier task/context and completed relay review
were reused without reopening them. Initial and intermediate checkpoints were persisted before
the final verdict.

**Ownership released to Root.** This reviewer wrote only this report and its matching static
evidence directory. The new source packet and all previous archives/reports/metadata remain owned
by their original writers. Root must refresh preflight and inspect the actual one-shot collection,
comparison and cleanup results before making any artifact-compatibility decision.
