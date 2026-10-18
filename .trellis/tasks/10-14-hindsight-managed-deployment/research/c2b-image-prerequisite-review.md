# C2b image prerequisite independent review

Date: 2026-10-15. Reviewer: /root/c2a_database_implement.
Scope: exact-byte static review only.

**PASS.** No blocking finding or source correction is required for this fixed cached-base
inventory packet and its execution manifest. This is not an actual inventory, final-image,
API/PG, trusted-reference/setup or C2b acceptance. Root has not run this packet as part of
this review.

## Reviewed inputs

The complete 484-line C2b plan was read directly in three untruncated blocks. The R2 design
review, Native producer readiness, current handoff, all 436 script lines, README and both
self-check files were read. All five file/source pins in the self-check match current bytes.
The listed source probe pin was hash-checked only; its accepted database behavior was not
reviewed again.

| File under research/ | Bytes | SHA-256 |
| --- | ---: | --- |
| c2b-plan.md | 41862 | 0e4bdf03c903d6bbdca4d0bbfc187de14bb6c9fd8119b816bbfa7e69db0cd803 |
| c2b-design-r2-review.md | 5360 | 19eb8c1c197604edcefbb977e35127a6be9fdef6d0f25b2593d9ff0809d53d1e |
| docker-native-api/inspect-image.py | 16369 | f7e962da88188e1afb6bbcba9acb1101839f75d38296c603d776da25f44e1ae7 |
| docker-native-api/README.md | 7351 | e01f6f96c485817ddbb05c1d9d7129082fb36dc0dec3314f6dea8a45ed8f3dd2 |
| c2b-image-prerequisite-self-check.md | 3106 | c9ad6770e9ace32c3547a916be8017806bf965e9b47195c4fe415d8da266440c |
| c2b-image-prerequisite-self-check.json | 7257 | b44ba84d7c41c747933bb1cbf716f8eed6e07d3cb6f7a5ebaf2ca519635b2b5f |

## Contract assessment

| Contract | Source evidence | Result |
| --- | --- | --- |
| Fixed read-only scope | inspect-image.py:20-73,102-192 fixes nine distributions, 23 modules, five retained source modules, four cache candidates and the known pg0 CLI. It uses regular-file reads, hashes and AST parsing; no target loader, subprocess, encoder, network or file-write call occurs. | PASS |
| Installed interpreter and module locations | :165-192,344-375 requires the exact Linux Python 3.11 venv, UID/GID 1000, isolated/no-bytecode stdin execution and bounded import roots. Basename PathFinder calls use explicit parent roots without importing dotted parents. Resolved paths/hashes are evidence of inspected bytes, not successful imports. | PASS |
| Offline cache discovery | :195-291 checks named reader/hash/BPE AST bindings and the literal cl100k_base definition, derives its SHA1 filename, then hashes only four fixed candidate files against the installed expected SHA-256. No tempfile discovery, cache walk, environment-value dump or encoding load occurs. | PASS |
| Missing inputs and bounded failures | :142-162,180-191,272-275,314-341,380-436 preserves missing/unreadable inputs, unconfirmed build/reader/cache/CLI, limits and exceptions as unresolved with exit 2. Exceptions expose fixed codes/class names; output remains bounded and deploymentReady is false. | PASS |
| Isolation and exact command inputs | README.md:23-67 pins the client hash, engine and base image, requires fresh token/name/marked stage, and uses no pull, network none, read-only root, UID/GID 1000, explicit stdin entry, no TTY flag, no volumes/mounts/ports and resource caps. Root verifies projected actual settings and empty mounts before start. | PASS |
| Deadlines and evidence | README.md:69-84 defines the 30-second packet alarm, file/read/output limits, 60-second outer execution budget, individual command/attach caps and bounded capture/stage growth. Failure does not authorize rerun, a larger search or a download. | PASS |
| Owned cleanup | README.md:86-101 requires a separate bounded cleanup, exact container ownership/image/settings readback, verified stop then non-force removal and absence. Lost create replies use only the original name; ambiguity is preserved. Evidence precedes exact marked-stage removal. Shared daemon, prune, base removal and unrelated resources remain excluded. | PASS |
| Prerequisite ordering | c2b-plan.md:81-106 and README.md:80-84,103-106 keep cached-base inventory separate from the final consumed image, real producer and broader lookup/setup. The pg0 CLI hash expressly does not establish raw PG/extension availability. | PASS |

The output's completion status applies only to the declared static inventory. AST assignment
and call-site observations are not a proof of executable control flow. Likewise, a verified
cache candidate is only a future pin candidate: final mounts, changed HOME and tmpfs must
not hide or replace the checked bytes. The final immutable image must still pass its own
consumed-file/cache checks before API import, then use that same cache for the later offline
encoding load.

## Actual checks

- Python 3.12.7: Python 3.11 AST parsing, in-memory compilation and import enumeration passed
  (exit 0, chunk 0094d4). The target was not executed and no target pycache was produced.
- Installed Ruff: E/F/I with isolated/no-cache, py311 and line length 100 passed
  (exit 0, chunk 09ad5e).
- Ruff format check with the same scope/settings passed
  (exit 0, chunk 5d9d79).
- Independent readback verified all five self-check pins and the six reviewed input hashes,
  UTF-8 without BOM, LF-only script/README, both README links and exactly two fixture-directory
  entries (exit 0, chunk f9c5d2).
- Exact check results and source bindings are retained in the companion JSON.

No Docker, WSL, API, SQL, provider, model/encoder, build, install or target-script execution
was performed. No runtime environment was started. No database fixture, reviewed file,
production source, task metadata or Git state was changed. Reviewer writes are limited to
this Markdown report and its companion JSON.

## Release and remaining work

No mandatory modification is requested. After the separate database acceptance, Root may
freeze fresh T/N/S and these exact script bytes, then run the reviewed manifest under the
existing authorization. The manifest still needs Root's bounded argv runner; no actual
invocation, resource allocation or cleanup result is attested here.

Preserve any unresolved, incomplete, timeout or OOM result and keep progression blocked.
Even a successful cached-base inventory does not verify the eventual producer image's raw
PG assets, cache pin, ordinary migrations/authentication/listener ownership, checked API/PG
shutdown or authorized same-volume restart. The separate database R2 review and manual
acceptance remain with their current owners.

