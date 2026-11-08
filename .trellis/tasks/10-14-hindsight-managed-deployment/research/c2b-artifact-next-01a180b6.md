# C2b next artifact checkpoint

Current outcome: the complete application/cache image was built once and its actual installed-file,
virtualenv/metadata and offline tokenizer check passed. See
[application artifact acceptance](c2b-application-artifact-acceptance-01a180b6.md).
The next implementation is the fixed Native API/owned-PostgreSQL producer in
`c2b-api-producer-source-01a180b6.md`. All older prerequisite instructions below are retained history;
do not replay their consumed tokens. Actual API/PG/Host receipts/setup remain unavailable.

Status: next admitted prerequisite after the relay diagnostic; no derived image, installed
application or API acceptance is established here. This records the concrete continuation of
the existing `c2b-plan.md` and `c2b-topology-delta-review-2026-10-27.md`, not a replacement scope.

Update: the [complete declared-dependency gate](c2b-dependency-gate-01a180b6.md) is accepted on
original raw metadata with an explicit unused LiteLLM extra-name conformance warning. All 221
distributions were captured; the 195-distribution required closure has no declared constraint gap.
No third-party metadata/version was changed. The next active slice is offline application-image
preparation under `docker-application-artifact/`; the older inventory instructions below describe
completed prerequisite work and must not replay consumed tokens.

## Established inputs

- The one-shot network-none relay passed Root's 2026-10-28 run and cleanup in 8.003 seconds;
  independent review is PASS_BOUNDED_TRANSPORT_DIAGNOSTIC. Its token is consumed and cannot be reused.
- The retained original slice-1 inventory is complete but FAIL: the cached image has the old
  `taki-memory-hindsight-0.9.0-batch0-v2` build and lacks five required template modules.
  Replacing this evidence with the new transport result would misstate the installed application.
- Current working-tree input identities are in `c2b-artifact-input-audit-01a180b6.json`:
  401 Native package files and 12 existing bootstrap files, 6,530,171 bytes in total, no symlinks.
  The actual package is `H:/hindsight/hindsight-api-slim/hindsight_api`; runtime import location
  proven by the original inventory is `/app/api/hindsight_api`.
- Root/package pyproject, root `uv.lock` and existing recipe hashes are recorded. The package
  declares 56 mandatory requirements plus optional profiles. The original nine-distribution
  sample cannot establish compatibility of the complete current application with the frozen base.
- Cached base: `sha256:ba5161f9e70f2811c17a90e40921b17240ae275d51a7a4001fcb75fcb61c10db`.
  Installed Python is 3.11.16, Linux/amd64, purelib `/app/api/.venv/lib/python3.11/site-packages`.
  Reconfirm these observations before a new runtime effect.

## Next bounded work

Prepare a source-reviewed, fixed metadata inventory packet before changing or building the image.
It reads the complete installed distribution names, versions, Python constraints, dependency
requirements and extras from the original purelib metadata, with file hashes and explicit bounds.
It does not import Hindsight/providers, load models/encoding, open SQL/listeners, install packages,
or use source business data. Unknown/malformed/missing/over-limit metadata is an incomplete result,
not an empty successful dependency set.

Run it once under the established fresh generated-data resource boundary: new token, one
network-none read-only UID/GID1000 container, no mounts/publication/custom network, no build/pull,
no capabilities, fixed tools/Engine/image and cleared CLI environment. Reuse the reviewed command
dispatch and evidence machinery without altering the consumed relay packet. Preserve one total
work/cleanup bound, original-ID ownership and exact archive readback; no name-only mutation after
an uncertain create reply. Root owns the runtime and waits for the single heavy slot.

Compare the complete observed dependency facts to the frozen current package requirements under
the actual Linux/Python marker environment, including the embedded-db profile used by this artifact
and recursively requested extras. Use an already installed standards-compliant requirement parser;
do not implement a partial version/marker language or silently ignore an unparsed requirement.
Retain source metadata and base installed metadata as distinct identities. Record all unmet or
unresolved requirements before deciding whether an offline application-only replacement is valid.
This comparison is metadata evidence; later actual import/startup remains required.

If the frozen environment supports the complete current package, prepare the reviewed offline
derived-image recipe: replace the entire application tree (including current untracked Stage 5
modules and package/migration data), preserve the locked base environment, and freeze the consumed
source/metadata/bootstrap/cache inputs. A merging COPY or a five-file patch must not leave stale
deleted application files behind. The existing `Dockerfile.c2a-fake` copies bootstrap only and cannot
produce the required application build.

The tokenizer cache must move into immutable image storage outside later writable mounts and be
checked before API import; use the accepted cl100k_base SHA-256
`223921b76ee99bde995b7ff738513eef100fb51d18c93597a113bcffe865b2a7`.
Missing/corrupt cache or wrong build must refuse without a download attempt. Reinventory the actual
result image and only then admit minimal ordinary API/PG/authentication/listener/checked-stop work.

## Boundaries and disposition

No dependency update, alternate base, network fallback, source credential/model invocation, broad
cleanup or shared-daemon change is implied. A genuine environment incompatibility must be retained
and resolved against the owner's existing constraints before expanding that boundary.

The source audit reads only package/bootstrap/configuration metadata. It did not copy application
files, create an image, initialize PostgreSQL or start an API. Its hashes are a recovery observation;
refresh and freeze final input bytes at the actual source handoff. D1-A checks and transport PASS
cannot satisfy this artifact gate, C2b setup/receipts or full D1/C4/D2/Stage 6 acceptance.
