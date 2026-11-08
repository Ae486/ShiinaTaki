# C2b complete declared-dependency gate

**Accepted for the frozen current application's mandatory plus embedded-db Python dependency
constraints.** This is an input to offline application-image preparation, not installed application,
import, cache, API/PG, Host, receipt/setup or deployment readiness acceptance.

## Actual evidence

The V2 one-shot inventory captured all 221 installed distribution metadata records (2,433,618 bytes)
from the pinned base, using fixed network-none/read-only UID1000 Python with site/.pth disabled.
Result SHA-256: `51afb014ed47b811813880d0b0c6f8e16beaae9cb8db0aa9cee0cec5dc6bf71e`.
All 13 command records closed; original container was stopped/removed/absent, stage removed,
archive hashes rechecked, and eight original workloads unchanged. Total runtime/cleanup/archive:
4,247.9329 ms. Token `e309a1b4-7047-44bb-a4af-cdd65b1a994a` is consumed and cannot be rerun.

The independently reviewed V4 comparator ran against the **original immutable archive** with
the complete target Linux/Python marker environment, fixed current source pyproject and pinned
Host Python/packaging. Original input hashes before/after agree. Its results are:

- `comparisonComplete=true`
- `dependencyConstraintsSatisfied=true`
- `metadataConformant=false`
- 195 reachable distributions; 2,026 requirement evaluations; no dependency issues.
- `deploymentReady=false`; no ambiguous overall `metadataCompatible` PASS.

See [V4 independent review](c2b-dependency-comparison-v4-review-01a180b6.md), report SHA-256
`d235d49e2c68b79c1ba13073f6fed3d54acd1fad610c1635f066952c6cfc36c6`, and its matching evidence directory.
Source release: `38b3529030e7b7273a2f95e67df9f3e54dc75199962472eec96af5828dda3eed`.

## Explicit conformance difference

LiteLLM 1.93.0's METADATA 2.4 declares `extra_proxy`; its eight associated requirement markers
already use `extra-proxy`. Metadata SHA-256:
`2079a96229cf0dabfb2c2f87b5109a7b36108818fa790a2a1da86bd0db97a1ce`.
The name has valid legacy-name characters, standard normalization is unambiguous, and there is no
collision. No LiteLLM extra is requested anywhere in this complete selected closure.

PyPA's official specification requires normalized output for metadata >=2.3; the conformance
warning must remain visible. Standard name comparison uses PEP 503/685 normalization. Independent
maintenance review accepted reporting the two outcomes separately, retaining the frozen environment
without patching third-party metadata to satisfy a task checker. Invalid names, collisions, unknown
semantics, requested noncanonical extras and missing/version/Python constraints still refuse or fail.
No installed metadata, package version, code or dependency requirement was changed.

## Retained failures and next gate

The first inventory token `0ab89a2a-ccac-4350-a4ea-ed90ed7a3e6d` failed after 61 records because
the old collector refused legitimate metadata 2.5 before completing raw facts. Its failure and
cleanup evidence remain intact. V2 records all raw facts; V3's original conformance refusal and
the explicitly altered-input diagnostic are also retained. Only V4's original-input result supplies
the accepted constraint conclusion above.

Next: freeze the complete current application/package/metadata/bootstrap inputs, replace the whole
application tree in a separate offline derived image, preserve the base environment and this warning,
place the verified tokenizer cache in immutable image storage, and validate the actual installed
result before any application import. The original cached image still has the old compatibility
build/missing template modules; this gate does not repair or accept that application image.
