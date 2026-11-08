# C2b dependency inventory V2 independent delta review

Date: 2026-10-28. Root session: `01a180b6-1dac-7fc2-b365-15fcb34dd4b4`.
Reviewer: `/root/relay_review_recovered`.

## Verdict and release

**PASS_SOURCE_ONLY.** The raw-collection/semantic-comparison separation is correct within this
narrow prerequisite. No source defect was found after the delta and focused checks.

Final release SHA-256:
`09cecd8d80419224d6b562c179ffee6044551c6ae00523b961bf16b435b1e789`.

New token `e309a1b4-7047-44bb-a4af-cdd65b1a994a` is unconsumed. Its stage/archive were absent
on this review's read-only filesystem check. Root still owns fresh live preflight and the one
bounded collection. This review executed no Docker, WSL, launcher or real collector entrypoint.

`deploymentReady=false`. Raw collection completeness does not imply supported metadata,
comparison completion, compatibility, actual imports, installed artifact/Host readiness,
API/authentication/PostgreSQL lifecycle, receipts, setup or other product acceptance.

## Findings (fixed)

No V2 source defect required correction.

The previously consumed first run remains a failure; its unknown version value was not retained.
V2 addresses the resulting missing-information problem by retaining unsupported raw headers,
rather than guessing a broader semantic allowlist. The original source review remains PASS for
its own contract; it is not rewritten as runtime acceptance.

## Findings (not fixed)

None within this source-delta scope. Actual V2 image inventory/compatibility remains unexecuted.
The version encountered in the prior failure is unknown; neither this review nor the generated
`99.0` fixture identifies that real value.

## Independently verified delta

- All six source/input pins and all eight packet hashes match the external V2 release/integrity.
- `compare.py`, `docker-commands.mjs`, `evidence-store.mjs` and `source-pyproject.toml`
  are byte-identical to the previously accepted packet. `launch.mjs` is byte-identical after
  replacing only the old fixed token with the new one.
- Collector changes are limited to the token, removal of its semantic version refusal,
  addition of `metadataVersionSupported` for each captured distribution, and an
  `unsupportedMetadata` projection containing every unsupported record's file/version.
  The complete [collector delta](c2b-dependency-v2-independent-review-01a180b6/collector-delta.diff)
  is retained.
- Full enumeration, file/encoding/header validation, single-link/path checks and all byte/count/time
  limits remain unchanged. Structural/read/bound failures still return incomplete collection.
  `complete=true` is set only after the entire bounded directory enumeration and metadata-read
  loop finishes and the unsupported list is assembled.
- The unchanged comparator checks the actual `metadataVersion` against its unchanged
  1.2/2.1/2.2/2.3/2.4 set before traversal. It does not trust the new support flag.
  Every collected distribution's extras/dependencies are still validated; unsupported versions
  or malformed unused fields cannot become compatible.
- Collection disposition PASS now means complete raw facts plus proven cleanup, as the V2 README
  explicitly states. The separately invoked comparator retains its independent completion and
  compatibility flags. No supported-version decision is inferred from a collection exit code.

## Focused independent evidence

The [reviewer checker](c2b-dependency-v2-independent-review-01a180b6/verify-delta.py) uses a
three-distribution generated directory: valid 2.4, unsupported 99.0, then another valid 2.4 record.
Only the collector module's platform/UID/environment adapters are substituted; its actual
enumeration, metadata reads, parsing and aggregation operate on the generated files.

The [result](c2b-dependency-v2-independent-review-01a180b6/verification.json) proves:

1. Raw collection completes with all three names in sorted order, including the record after the
   unsupported version. Per-record flags are exactly true/false/true; unsupportedMetadata has
   the exact middle record's file and `99.0`; byte totals reconcile.
2. Passing that complete raw inventory to the unchanged comparator raises
   `metadata_version_unsupported`.
3. A separate generated supported-only 2.4 closure compares successfully.

These are deterministic source checks with a substituted environment, not Linux/container
execution or knowledge of the real base's unknown version.

Original accepted packet release remains
`5fd19647e62dc6791066eb5a216d3ee9eb7fe911a5e0c49d10a97374c61a77a1`; all its source pins
remain unchanged. The first failed run's retained result still hashes to
`54c5998b118e9f35ab42a12863fe7e3f5830296b1d549b639c2a4a32c3703c6b`.
This delta review verifies preservation; it does not perform a new runtime audit or repeat that run.

## Verification

- **Lint: PASS.** V2 retained Ruff and three-file ESLint records pass; the recorded JavaScript
  hashes match current sources. The independent checker also passed scoped Ruff.
- **TypeCheck: PASS.** V2 collector Linux-target ty passes. Comparator ty evidence is reused
  from the prior accepted review because its source is byte-identical. The independent checker
  passed scoped ty.
- **Tests: PASS within source scope.** Root's retained nine generated fixtures pass, including
  raw unknown-version preservation and unchanged unsupported-version/invalid-extra refusal.
  The independent three-record aggregation/comparison checks above pass. Unrelated suites and
  old runtime cases were not rerun.
- **Runtime: NOT RUN.** New stage/archive absent; exact live container-name absence, engine/image/
  workload state and actual cleanup remain Root's fresh preflight/runtime obligations.

Source records are in `c2b-dependency-v2-source-01a180b6-static/{checks,after-javascript,integrity}.json`.
Their current hashes, packet/old-result preservation and the generated outcome are retained in
the reviewer's verification file; reviewer lint/type records are in `reviewer-checks.json`.

Reproduce only the local generated-header/source check:

```powershell
& 'G:/anaconda3/python.exe' -I -B -S .trellis/tasks/10-14-hindsight-managed-deployment/research/c2b-dependency-v2-independent-review-01a180b6/verify-delta.py
```

## Handoff

Workspace readback confirmed `H:/TakiAgent`, `refs/heads/main`,
`e260ff4b0bf663b5faa0187bc6ec701fd2f007cd`. Root's explicit sibling assignment supplied
scope; the completed prior context/review was reused. Initial and findings checkpoints were
persisted before this final verdict.

**Ownership released to Root.** Only this report and its matching evidence directory were
written. All source packets, prior archives/reports, production source and task metadata remain
untouched. No runtime cleanup, dependencies, model/data/key, Git or agent operations were performed.
