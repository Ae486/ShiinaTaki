# C2a database metadata probe: independent static review

Date: 2026-10-15. Reviewer: /root/c2_design_check.

**PASS for the metadata probe.** probe-runtime.py is unchanged; README now matches Root's prepared staging.
Root may run the single documented probe under the existing approval. This is not runtime or
database acceptance; actual cached-image inventory is still pending.

## Findings (fixed)

**DBP-D1 / documentation only:** aligned README to Root's existing
G:/TakiAgent-c2a-docker-acceptance/database-probe-T staging and .c2a-docker-owner marker, and recorded
prepared token 4f0d332f-d9d9-4c30-a847-36cfc02afb7d. Root continues from its retained preflight;
no second staging/runner is introduced. The original self-check remains unchanged.

No probe-code defect was found. The implementation conforms to the accepted design:

- Reads are limited to the two fixed distribution inventories, listed pg0 assets/relevant source
  and the fixed seed's immediate metadata. It imports no pg0, SQL client, Native API or provider,
  and performs no extraction, initialization, download, recursive cache/model scan or data-content read.
- Only a permitted package-listed regular executable ELF with one of the four fixed PG basenames
  reaches Popen, once per name and with exactly --version. Environment, cwd and closed stdin are fixed;
  combined output is bounded to 4 KiB. The pg0 CLI itself cannot execute.
- The 50-second alarm remains distinct from each three-second utility timeout; InterruptedError
  reaches outer incomplete-result handling. Root's 60-second create/start/attach budget and 60-second
  owned-cleanup budget remain required. Final JSON including newline is capped at 128 KiB; oversize
  output becomes an explicitly incomplete record. Hashing and package/source/asset enumeration are finite.
- Missing/extraction-only assets and version/loader failures remain unresolved prerequisites.
  Neither exit 0 nor a pg0 executable hash claims a usable database, loader completeness, SQL data
  location, postmaster ownership, graceful shutdown or persistence.
- README fixes the existing executable/engine/base, fresh token/name/staging, empty client config,
  no-pull/network-none/read-only container with no data mounts/ports, exact stdin bytes and EOF.
  Root records and inspects CID before starting; cleanup revalidates only that owned CID or the
  unique frozen name after an uncertain create. Unknown ownership never permits broad removal.

## Findings (not fixed)

No static blocker remains. Actual probe output must be retained and reviewed before a database
child or offline extraction/start is prepared. All broader recovery/database/C1 service/C2b/model
and manual acceptance boundaries remain unchanged; deploymentReady remains false.

## Verification

- Lint: PASS, reusing the hash-bound Ruff E/F/I and format results.
- Syntax: PASS, reusing AST and in-memory compile. This is not a Python type-check result.
- TypeCheck: not applicable to this standalone unannotated probe. Tests/runtime: not run.
- The original failed import-order/line-length/format checks remain in the unchanged self-check.
- No Docker/WSL/probe/app execution, build/install, production edit, project-suite rerun or Git action.

| Final input | SHA-256 |
| --- | --- |
| probe-runtime.py | 57d79748edba8100576eaf79f1090fecb6c2e227563d7522dadf22eead0afd13 |
| README.md | 92ccfd530cac3bd4110b66502555daf056c157272a11b5c18c9316c0339831f2 |
| c2a-database-probe-self-check.json (preserved) | 0d05ee756ae10bfd659be85f0ae4cb7febd99b225c1a7b16ea20d4277d1d7cde |

[Review evidence](c2a-database-probe-review.json) binds the inputs and reused commands/results.
Ownership of the probe, README and these review reports is released to Root.
