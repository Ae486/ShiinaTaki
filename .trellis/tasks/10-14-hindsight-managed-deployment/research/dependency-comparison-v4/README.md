# Separate dependency constraints from metadata conformance

This read-only report consumes the original, immutable 221-distribution inventory and frozen
application metadata. It does not modify installed metadata or normalize the archive. The earlier
V3 refusal and explicitly modified-input diagnostic remain preserved as historical evidence.

Independent review found one upstream conformance defect: LiteLLM 1.93.0 declares `extra_proxy`
in metadata 2.4, although the associated eight requirement markers already use `extra-proxy`.
No LiteLLM extra is requested in the complete current dependency closure, the name uses valid
legacy-name characters, and no canonical-name collision exists. PyPA requires normalized output
for this metadata version, while name comparison uses standard PEP 503/685 normalization.

The original C2b gate is complete declared dependency constraints under the frozen environment.
An unused, unambiguous alias does not justify changing third-party metadata solely to satisfy a
task checker. This reviewed decision preserves that conformance failure explicitly:

- `dependencyConstraintsSatisfied`: all required versions/Python/extras/markers are satisfied.
- `metadataConformant`: the captured dependency metadata fields conform; false for this alias.
- `metadataWarnings`: original package/version/file/hash and raw/canonical names.
- `comparisonComplete`: a complete result was obtained, independently of those two outcomes.
- `deploymentReady`: always false. This is not installed application, import, API/PG or setup proof.

No ambiguous `metadataCompatible` overall PASS is emitted. Invalid names, canonical-name collisions,
unknown metadata semantics and malformed fields remain refusals; missing/version/Python constraints
remain unsatisfied. This exception cannot enable optional code: a requested noncanonical extra is
explicitly refused. Standard normalization is a derived comparison value, not a data rewrite.

Run the pinned Host Python with `-I -B -S` and only this directory's absolute `compare.py`, after
source/release hash verification and independent review. Capture stdout separately. All source,
parser and original result hashes remain pinned. No Docker or additional inventory run is needed.
