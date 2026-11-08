# Dependency metadata V2 source release

The first dependency run consumed token `0ab89a2a-ccac-4350-a4ea-ed90ed7a3e6d` and failed after
61 records with `metadata_version_unsupported`. Result and exact cleanup are retained; no compatibility
comparison was run. The unknown version itself was not retained, so broadening a supported-version
allowlist now would be guessing.

Root therefore prepares a separate packet/token `e309a1b4-7047-44bb-a4af-cdd65b1a994a` under
`docker-dependency-inventory-v2/`. Its only behavioral delta is complete **raw** metadata collection
with per-distribution supported-version flags and a complete unsupported-version list. Structural,
file, encoding and resource bounds still fail; the unchanged Host semantic comparator still refuses
unknown/legacy versions and malformed extras anywhere. No unknown metadata can become compatible.
The runner's resource/ownership/cleanup implementation is unchanged except for the new fixed token.
Original consumed source, release, archive and failures are immutable.

No runtime has executed for this new token. Root will freeze hashes and obtain independent delta
review before a fresh preflight and one collection. Tests retain the unknown-version compatibility
refusal and now explicitly assert raw preservation with `metadataVersionSupported=false`.
