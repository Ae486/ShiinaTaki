# Complete installed dependency inventory

Source-only packet pending independent review. **`launch.mjs` executes Docker effects.**
Root verifies the externally reviewed release SHA-256 and all source/tool pins before launch.
No caller arguments, environment options, image selection or alternate resource names are accepted.

## Scope and identities

Token: `0ab89a2a-ccac-4350-a4ea-ed90ed7a3e6d`. Container: `taki-c2b-dependencies-<token>`.
Stage: `G:/TakiAgent-c2b-native-api/dependencies-<token>`; marker `.c2b-dependencies-owner` is exactly
the token. Archive: sibling `c2b-dependencies-run-<token>`. Creation of either path consumes the
token, even if container creation fails. Never rerun an attempted release.

Node, Docker, Engine, Host Python, packaging source and current application pyproject identities
are frozen in `release.json`. Base image is
`sha256:ba5161f9e70f2811c17a90e40921b17240ae275d51a7a4001fcb75fcb61c10db`.
This packet does not change that image or claim its old application is current.

One fresh container uses UID/GID1000, network none, read-only root, no mounts/tmpfs/publication,
256 MiB/one CPU/16 PIDs, all capabilities dropped, no-new-privileges, log none and no restart.
No pull/build/custom network, credentials, original data, SQL/API/model import or listener occurs.
The only container program is `/app/api/.venv/bin/python -I -B -S -` with pinned collector stdin.
`-S` intentionally prevents site/.pth startup; the collector explicitly reads the fixed purelib.

## Collection, comparison and limits

`collect.py` reads all `.dist-info/METADATA` files under
`/app/api/.venv/lib/python3.11/site-packages`, reporting name, version, metadata version,
Requires-Python, every Requires-Dist/Provides-Extra, original hash/size and the actual target marker
environment. Metadata descriptions are hashed but not copied into logs. Legacy egg metadata,
missing/malformed/changed/nonregular files and bounds produce explicit incomplete collection.

Supported dependency metadata versions are 1.2, 2.1, 2.2, 2.3 and 2.4. Older legacy `Requires`
formats and unknown versions refuse. The Host validates every distribution's dependency fields
and declared extras, including distributions outside the selected closure; malformed unvisited
metadata cannot be reported as compatible. Packaging 24.1 still handles requirement/version/marker
semantics, while the explicit header-version contract admits valid 2.4 fields used by this packet.

Bounds: 20-second collector alarm; 8,192 purelib entries, 1,024 distributions, 512 KiB per metadata
file, 32 MiB total metadata reads, 512 requirements/128 extras per distribution, 8 KiB per requirement,
1 MiB collector JSON. The Root runner has **one monotonic 60-second total** including cleanup/archive,
at most 40 seconds work, 25-second attached collection and bounded original-ID commands.
The reused command/evidence owners retain 48 commands, 2 MiB per JSON and 4 MiB total staging bounds.
A bound failure is preserved, never silently truncated into successful inventory.

`compare.py` runs on pinned Host Python with `-I -B -S`, verifies and explicitly loads existing
packaging 24.1, then evaluates the frozen current source's mandatory and embedded-db dependencies
and recursively requested extras using the **target** Linux/Python marker environment. It replaces
only the application's requirement metadata for this comparison while retaining the original base
metadata separately. Missing distributions/extras, version/Python incompatibility and unresolved
direct URLs prevent metadata compatibility. Duplicate/malformed metadata or incomplete target
environment prevents comparison completion. Graph bounds: 8,192 package/extra states and 65,536
requirement evaluations. Unselected optional packages are inventoried but are not claimed usable.

Collection success and comparison completion do not imply metadata compatibility. Compatibility
does not prove actual imports, complete application installation, tokenizer cache use, API/PG startup,
Host provenance, receipts or setup. `deploymentReady` always remains false.

## Root execution after independent source acceptance

1. Refresh hashes, exact Engine/image, original workload snapshot and absence of the new name/stage/
   archive; hold the sole heavy slot. Retain dispatch evidence before launch.
2. Start pinned Node with only the absolute `launch.mjs` path, `UseShellExecute=false`, hidden window,
   environment cleared to SystemRoot. Retain output/exit; apply an outer 65-second watchdog solely as
   containment. It cannot extend the 60-second acceptance budget or prove Docker effects absent.
3. Verify `result.json`, `commands.json`, `disposition.json` and exact archive hashes. Prove original
   workload identities unchanged. Collector PASS means only complete metadata plus owned cleanup.
4. Verify the source/release pins again, then run pinned Host Python `-I -B -S` with only the absolute
   `compare.py` path and retain stdout/exit in a separate new evidence file. Exit 0 means comparison
   completed; inspect `metadataCompatible` and every issue before deciding on the next artifact.

Unknown create/settings leave the original inspect/dispatch and stage retained; no name-only adoption
or cleanup follows. Known original CID is checked before stop/remove and absence by CID/name. Archive
readback and exact marked ancestor/file/size checks precede deletion of only the owned stage. The
archive and frozen source are retained. On interruption, inspect the original run instead of replaying.

Static source evidence lives in sibling `c2b-dependency-source-01a180b6-static/`. Nine generated
fixtures cover marker environment, transitive extras, changed source requirements, missing/version/
Python/URL/duplicate/malformed metadata and raw header parsing. No fixture executes the collector
entrypoint, Docker, Hindsight or a model. Source-only limits remain pending actual inventory execution.
