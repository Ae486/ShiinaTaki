# Offline application-source and tokenizer-cache prerequisite

This packet freezes current application files for a derived image. It is **not** the
`managed-api-initial-v1` producer: the default image entrypoint only checks files and a tokenizer.
`deploymentReady` remains false. Root owns actual effects through its separate execution wrapper.

Token: `ad8bf8b8-9577-4420-9fd9-212574bd4568`.
Tag: `taki-c2b-application:ad8bf8b8-9577-4420-9fd9-212574bd4568`.
Stage: `G:/TakiAgent-c2b-native-api/application-ad8bf8b8-9577-4420-9fd9-212574bd4568`.
The existing marked source stage has already been frozen once. **Do not rerun `--freeze`.**

## Source and prerequisites

`release.json` binds this closed packet, the full G: snapshot and retained static evidence.
`execution-plan.json` contains exact argv, bounds and resource identities for Root's wrapper.
Before any effect, verify the release hash against the source-release report, all file pins,
the stage marker/snapshot/context, and current source with the fixed read-only command:

```powershell
& 'G:/anaconda3/python.exe' -I -B -S 'H:/TakiAgent/.trellis/tasks/10-14-hindsight-managed-deployment/research/docker-application-artifact/prepare.py' --verify
```

The source snapshot includes every regular file and empty directory in current `hindsight_api`
and `managed_bootstrap`, including untracked Stage 5 modules and Alembic/package data. Only known
interpreter caches (`__pycache__`, `.pyc`, `.pyo`) are excluded. Symlink/reparse/special files,
unreadable files, drift or exceeded limits refuse. Root/package pyprojects and root uv.lock are
frozen separately. No Native source or installed distribution metadata is modified.

Original 221-distribution evidence and V4 comparison remain separate immutable inputs. V4 establishes
the selected 195-distribution closure / 2,026 requirements, with the existing unrequested, unambiguous
LiteLLM `extra_proxy` conformance warning retained. The frozen source pyproject hash must stay equal
to that V4 input. The package's original installed METADATA is deliberately preserved alongside the
new source metadata; they do not become one invented package identity.

Before build, Root must freshly prove the pinned Docker/Buildx bytes, Engine ID/version/Linux,
`default` builder's Docker driver/running state and endpoint, and local
`taki-hindsight-api:local` resolving to the original immutable base:
`sha256:ba5161f9e70f2811c17a90e40921b17240ae275d51a7a4001fcb75fcb61c10db`.
Require absent fresh tag/container/iidfile/build fence. Use the new explicit build config containing
only the pinned Docker plugin directory; no ambient CLI config, daemon changes, pull or network.

## Build and installed file gate

One build uses the frozen context and the previously proven `buildx build --builder default
--pull=false --network=none --load --progress=plain --iidfile ... --tag ... --file ...` pattern.
Exact arrays are in the execution plan. Cleared child environment contains only SystemRoot plus
TEMP/TMP pointing at the exact stage temporary directory. Hidden subprocess; no shell interpolation.
Build budget is 600 seconds, stdout/stderr each at most 1 MiB. Persist intent before dispatch and
retain complete bounded process result, streams, iidfile and elapsed time before deciding success.

The Dockerfile copies only frozen payload bytes. The standard-library installer:

1. Rechecks original 221 METADATA hashes, complete input trees, expected build and cached tokenizer.
2. Records the **entire virtualenv** file/tree digest, including all third-party code, metadata,
   scripts, directory modes/owners and symlink target text, plus the real Python executable hash.
3. Removes only the exact original `/app/api/hindsight_api` tree inside the new build layer and
   replaces it completely; no stale file survives a merging COPY.
4. Places the existing bootstrap/source metadata under `/opt/taki-c2b-application`, without adding
   an API consumer or injecting it into the unchanged virtualenv.
5. Copies the verified 1,681,126-byte cache into the root-owned immutable `tokenizer/` directory,
   rechecks it, and requires the complete virtualenv facts to remain unchanged.

Root must match successful iidfile, owned tag/label and actual result image; recheck the base tag,
and require the result RootFS layer list to have the exact original base layers as its prefix.
The iidfile alone is insufficient. A timeout/lost result is **unknown**, never a reason to rebuild,
adopt a tag or clean a merely name-matching resource. Preserve stage/logs/fence and inspect read-only.

## One actual result-image check

After image identity is established, create exactly one fresh container from the result ID.
Profile: UID/GID 1000, read-only root, network none, no mounts/publications, 256 MiB, one CPU,
16 PIDs, cap-drop ALL, no-new-privileges, log none, restart no, pull never, no TTY/interactive stdin.
Reinspect the original returned CID/settings before its sole start. Fixed argv:

```text
/app/api/.venv/bin/python -I -B -S /opt/taki-c2b-application/artifact-check.py
```

The `-S` flag prevents site/.pth startup. The checker first verifies exact complete application/
bootstrap trees (including absence of deleted files), source metadata, the complete protected
virtualenv, original 221 METADATA and seven previously inventoried tokenizer/PG0 tool files.
It reads the expected build constant with AST only and verifies cache identity/readability and
non-writability as effective UID 1000. Three **generated immutable fixture** cases exercise the
same gates for wrong build, missing cache and corrupt cache before any third-party import.
These are checker refusal proofs, not integration into an absent production producer.

Only after all file and refusal gates pass, the same process clears its environment, pins
TIKTOKEN_CACHE_DIR, explicitly exposes the preserved purelib and loads actual `tiktoken 0.12.0`
`cl100k_base`. It checks a generated-text round trip, exactly one cache read during load and a
post-load cache hash. An audit hook rejects socket/process effects and Hindsight/PG/download-library
imports. Loader/registry/openai_public source matches the original image hashes after line-ending
normalization of the read-only local library. `requests`/`blobfile` imports occur only in the remote
`read_file` branch; a valid explicit cache returns before that branch. No package code is rewritten.

Checker alarm/work budget is 180 seconds. Root's separate check/cleanup/archive deadline is
240 seconds, with at least 60 seconds reserved after work. Capture stdout <= 32 KiB, stderr <= 16 KiB;
accept one JSON result only with exit 0, empty stderr, all three gates and `complete: true`, exact
token/schema/build, `files.metadata.count: 221`, `tokenizer.loaded/roundtrip: true`,
`tokenizer.cacheReads: 1`, `tokenizer.forbiddenEffects: 0`, and `deploymentReady: false`.

## Retention and exact cleanup

Before any create/start/stop/remove, persist dispatch and original identities. On unknown create,
retain evidence; name-only observation grants no mutation authority. Never retry create/start.
After normal exit, recheck original CID/image/name/token/settings, exit 0 and unchanged start;
remove only that stopped original CID, then prove CID and name absence. If still running after
failure, reprove identity before one bounded `stop --time 3`; no forced or name-based removal.

Successful image/tag and source stage are intentionally retained as the next producer gate inputs.
Archive this release, snapshot/source-manifest, bounded command/result records, image identities,
before/after protected facts and exact hashes to Root's fresh token-specific evidence directory.
The substantial source snapshot stays on G: until ownership has transferred and archive readback
is proven. Stage deletion is a later Root action restricted to the original marker/path and known
leaves; retain it on any ambiguity. Failed image untagging, if needed, requires exact iidfile/image/
label/tag agreement, no unknown consumer and no foreign tag; use only the owned tag with
`image rm --no-prune`, never the base ID or broad prune. Unknown build state is retained.

Actual Linux build, UID readability, complete installed preservation and tokenizer execution remain
unverified until Root runs this packet. Raw PostgreSQL extraction/extensions, real API startup,
authentication/listener/checked shutdown/restart, installed Host identity, receipts and managed setup
remain later gates. No successful file or tokenizer result can claim those capabilities.
