# C2b offline application artifact source release

Status: source/static/snapshot release complete; Root accepted exact input readback. Build/runtime pending.

## Released source

- `release.json` SHA-256: `da13c5f1bceb17130c000657b40fad55cdc29de94b1c64a5ca85137e2cbf91d0`.
- Root verified all nine packet files, five evidence records, tool pins and the exact snapshot;
  the fresh fixed `prepare.py --verify` returned exit 0 with empty stderr and unchanged context.
  Evidence: `c2b-application-root-source-check-01a180b6.json`.
- Ruff, Linux-target ty, six generated tests and five Python AST parses pass. Initial failures
  and the closed-source-set rejection caused by a generated Ruff cache remain in static evidence.
- The Astra implementer hit an upstream rate limit after writing the complete release. Root
  recovered the exact files and took final report ownership; the implementation assignment is done.
- As requested by the owner, the combined delivery review follows completed work; no extra
  per-packet independent-review round is required before Root's already-authorized bounded build.
- Root's wrapper stores client configuration, iidfile and durable build/check fences in its separate
  marked `application-root-<token>` stage, preserving the frozen `application-<token>/context`.
  It uses the same base/context/tag/container/profile and retains the image plus source snapshot.
  Build output is capped more tightly at 256 KiB per stream; work/cleanup bounds are unchanged.
- Source/snapshot completion does not prove an installed application, offline tokenizer execution,
  API/PG lifecycle, Host receipt or managed setup. `deploymentReady=false` remains.

## Checkpoint 1: assignment and boundaries

- Root reassigned this agent to the new task-only `docker-application-artifact/` packet.
  Previous dependency/relay packets and evidence are read-only; Root owns all actual effects.
- Original base dependency comparison V4 establishes the selected requirement constraints,
  while preserving the explicit LiteLLM metadata-conformance warning. It does not establish
  installed current application contents, a managed API producer or deployment readiness.
- Prepare a full current working-tree application snapshot, existing bootstrap and source metadata,
  an offline whole-tree replacement/cache recipe, and bounded actual-result verification.
- No Docker, WSL, build, pull, listener, SQL, API, provider, model, original-data, Git lifecycle
  or unknown-resource cleanup actions are authorized to this agent.
- Next: read the accepted default-driver build recipe and actual tokenizer source; freeze
  a fresh artifact identity and exact source inputs; retain static checks before Root review.

`deploymentReady` remains false. Current source artifacts cannot satisfy API/PG lifecycle,
installed Host/service receipt or managed setup acceptance.

## Checkpoint 2: concrete source under construction

- New artifact token: `ad8bf8b8-9577-4420-9fd9-212574bd4568`.
- Added `artifact_io.py`, `prepare.py`, `Dockerfile` and `install-artifact.py` under the
  exclusively owned new packet directory. They have not been executed or released yet.
- The recipe uses the previously proven local `taki-hindsight-api:local` reference. Root must
  verify its exact immutable base and the default Docker-driver builder before one build.
- The installer replaces the entire application tree in the derived layer, puts existing
  bootstrap/source metadata outside the virtualenv, and copies the already verified cache.
  It captures and compares the complete virtualenv file-tree digest before/after replacement,
  preserving all metadata and code rather than repairing the LiteLLM warning.
- Read local `tiktoken` loader/registry/encoding source. Normalizing CRLF to LF reproduces all
  three original installed-source SHA-256 values exactly; no image/source package was executed.
  The cache reader's miss/corruption branch can download, so the fixed checker must refuse first.
- Next: finish fixed artifact checker and small generated fixtures; extract original base facts;
  freeze full current source in marked G: staging; retain static checks and a Root execution plan.
- Heavy execution slot remains unused by this agent. No Docker/build/runtime command was called.

## Checkpoint 3: checker and static contracts complete

- Added `artifact-check.py` and six generated-file tests. The checker performs complete application/
  bootstrap/source-metadata, all-virtualenv, original 221-METADATA and seven prior-tool comparisons.
- Its fixed negative fixtures refuse wrong build, missing cache and corrupt cache before third-party
  imports. Only after all gates pass does it load real installed tiktoken with the fixed immutable
  cache, an explicit purelib path, and a socket/process/download/application-import audit fence.
- `base-facts.json` was derived from the unchanged original dependency result, whose SHA-256 is
  `51afb014ed47b811813880d0b0c6f8e16beaae9cb8db0aa9cee0cec5dc6bf71e`; no comparator or collector reran.
- Retained initial formatting findings in `checks-initial.json`. Explicit Linux/Python 3.11 type
  context resolves the initial ambient Windows platform mismatch; no type rule was disabled.
- Final scoped Ruff, ty, six generated tests and five Python AST parses all exit 0 in
  `c2b-application-artifact-source-release-01a180b6-static/checks-final.json`.
- Root owns its separate execution wrapper; this packet adds no second effect scheduler.
  Next: freeze source/context once, verify readback, and publish exact Root argv and release hashes.
