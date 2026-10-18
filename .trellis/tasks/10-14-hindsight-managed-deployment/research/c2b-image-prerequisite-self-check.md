# C2b image prerequisite self-check

Date: 2026-10-15. Author: /root/c2a_recovery_implement.
Status: **static checks passed; runtime not run**. Ready for independent exact-byte review.

Only the fixed [inventory packet](docker-native-api/inspect-image.py),
[execution manifest](docker-native-api/README.md) and this Markdown/JSON self-check are authored.
The [accepted plan](c2b-plan.md) and [R2 review](c2b-design-r2-review.md) remain unchanged.
Root owns all later resource allocation, execution, evidence and cleanup.

| Deliverable | Bytes | SHA-256 |
| --- | ---: | --- |
| docker-native-api/inspect-image.py | 16369 | f7e962da88188e1afb6bbcba9acb1101839f75d38296c603d776da25f44e1ae7 |
| docker-native-api/README.md | 7351 | e01f6f96c485817ddbb05c1d9d7129082fb36dc0dec3314f6dea8a45ed8f3dd2 |

## Checks and decisions

- Python 3.12.7 parsed the script with the Python 3.11 AST grammar and compiled it in memory.
  The target was not executed and no target pycache was produced.
- Installed Ruff 0.15.15: E/F/I, target py311, line length 100, and format check passed.
  The first lint pass reported three E501 strings; those were shortened and checked again.
  Exact commands, exit codes and output are in the [JSON record](c2b-image-prerequisite-self-check.json).
- UTF-8 without BOM and LF-only readback passed for both payload files; both README links resolve.
  The fixture directory contains only the script and README.
- The earlier fixed metadata-probe pattern is reused without its subprocess/version execution.
  PathFinder uses explicit parent roots and basenames to avoid importing namespace parents.
  Source AST/hash reads establish static locations and declarations, not successful imports.
- No encoder load is needed. The packet checks the actual installed reader's cache bindings,
  literal cl100k_base URL/hash and four exact cached files as UID 1000. It never calls tempfile
  discovery, reads cache-directory contents, dumps environment values or fetches missing bytes.
- Missing modules, changed/unconfirmed compatibility build, wrong cache/hash, limits and read
  failures produce an unresolved result with exit 2. Every output retains deploymentReady false.
- The pinned pg0 CLI hash is checked, but raw PG/extension availability is not inferred from it.
  Existing database evidence and the later API's own lifecycle proof remain separate.

## Release boundary

No Docker/WSL/application/build/install run, target-script execution, SQL, provider/network call,
original-data/key access or production/Shared/Host/consumer/task-metadata edit occurred.
No new sub-agent or generic probe framework was introduced.

Root must freeze fresh T/N/S and the exact bytes before execution after database acceptance.
A cached-base inventory can reveal missing/old inputs; it cannot certify the future producer image.
That image still needs actual installed build/modules and consumed PG assets, an explicit verified
cache pin with refusal before API import, ordinary API migrations/authentication/listener binding,
and checked API plus PostgreSQL shutdown and same-volume authorized restart.
