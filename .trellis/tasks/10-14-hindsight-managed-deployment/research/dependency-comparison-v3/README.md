# Comparison-only metadata 2.5 profile

This directory cannot launch a container. It reads the already archived, hash-pinned complete
221-distribution inventory from token `e309a1b4-7047-44bb-a4af-cdd65b1a994a` and the frozen current
source pyproject. Both consumed Docker packets and their archives remain byte-identical.

Actual Hindsight METADATA declares version 2.5. The original comparator's explicit unsupported
result is retained in `c2b-dependencies-v2-comparison-original-01a180b6.json`. PyPA's current
[core metadata specification](https://packaging.python.org/en/latest/specifications/core-metadata/)
lists 2.5 as legal; Requires-Dist and Requires-Python retain the same dependency syntax. New import
name declarations do not change this task's Python requirement-closure comparison or establish
actual import compatibility. Official excerpts are retained in the sibling task evidence JSON.

This profile adds exactly 2.5 to the closed supported versions. Packaging 24.1 continues to parse
requirements/version specifiers/markers. Per the same specification, Provides-Extra values in
2.3/2.4/2.5 must already be normalized; older supported metadata may normalize legacy aliases.
Unknown formats, malformed/unvisited extras and incomplete metadata still refuse.

Run pinned `G:/anaconda3/python.exe -I -B -S` with only the absolute `compare.py` path after source
review and root release/source pin verification. Retain stdout separately. Exit 0 is comparison
completion, not compatibility: inspect `metadataCompatible` and all issues. No packages are installed,
requirements lowered, images built, or Hindsight/providers imported. `deploymentReady=false`.
