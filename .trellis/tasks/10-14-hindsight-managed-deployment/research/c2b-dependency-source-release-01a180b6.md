# C2b dependency inventory source release

Status: source released for independent review; no runtime execution.

## Root source release

Packet: `docker-dependency-inventory/`. Final release SHA-256:
`5fd19647e62dc6791066eb5a216d3ee9eb7fe911a5e0c49d10a97374c61a77a1`.
Six pinned source/input files plus release and README are complete. Root owns these bytes until
independent review identifies a necessary correction; no other implementer retains write ownership.

Verification: Python Ruff E/F/I PASS, collector Linux-target ty PASS, comparator Host ty PASS,
three JavaScript syntax/ESLint recommended checks PASS, eight generated metadata/requirement tests
PASS. Python compilation stayed in memory. Initial import/type/lint failures and corrected records
are retained in `c2b-dependency-source-01a180b6-static/`, alongside full source/evidence hashes.
The JS warning concerned a throw inside the cleanup finally block; it is now an explicit ownership
guard within the existing caught cleanup path. No check suppression or changed acceptance was used.

The packet uses fixed `-S` in addition to isolated/no-bytecode Python flags, preventing site/.pth
initialization. Stdlib collection and standard Host packaging comparison remain separate. The
archive disposition PASS means collection plus cleanup only, while the separately retained
comparison must report its own `comparisonComplete` and `metadataCompatible` values.

Root will perform fresh preflight and one execution only after source review. Token remains
unconsumed. This source release does not establish installed metadata compatibility or API readiness.

## Independent R1 correction

The reviewer demonstrated that unknown metadata version 99.0 and a malformed extra in an unvisited
distribution could incorrectly report compatibility. Root verified the evidence and corrected this
single completeness-validation gap: collector and comparator now require the explicit supported
metadata versions 1.2/2.1/2.2/2.3/2.4, and the comparator validates every distribution's extra and
requirement field before traversing the selected graph. Legacy dependency-header versions refuse.
Valid 2.4 remains supported without enabling packaging 24.1's older whole-metadata validator.

Original eight-file packet/release is preserved byte-for-byte under static `released-before-review/`
(release `b83d9284e23ded4dbd18157a7ba3e1791661c867d8f11a0084051096d8c43a59`). The review's original
false-success cases remain in its evidence directory. Ruff and collector/comparator ty pass; the
expanded nine-case suite passes, including raw unknown-version headers and unvisited invalid extras.
Only Python collector/comparator and README/release changed; JavaScript/command/cleanup source is
unchanged. Independent delta acceptance is pending; token is still unconsumed.

## Checkpoint 1: scope and source inputs

- Verified `H:/TakiAgent`, branch `main`, HEAD `e260ff4`; all existing changes are preserved.
- Root confirmed the empty legacy task pointer is expected; session binding remains D1 and this
  explicitly delegated task-only packet belongs to the existing C2b sibling.
- Read the current artifact-next note, source audit metadata, topology review and accepted C2b
  image gate. The full installed dependency inventory precedes any derived image/API work.
- Reviewed the fixed `DockerCommands` and `EvidenceStore` interfaces from the consumed relay
  packet. Its source and runtime evidence will not be changed or reexecuted.
- Assigned token: `0ab89a2a-ccac-4350-a4ea-ed90ed7a3e6d`. No Docker, WSL, listener, build,
  SQL, API, provider, model, Git lifecycle or source-data effects have been performed.
- Next: freeze the current package pyproject bytes; verify an already-installed Host packaging
  parser; implement and statically exercise the bounded collector, comparison and Root runner.

This checkpoint is not installed dependency compatibility, artifact readiness or C2b acceptance.

## Checkpoint 2: Root implementation after upstream limits

The implementation child repeatedly hit the upstream token limit before creating source files.
Root explicitly interrupted it and took over the assigned packet directory. The child holds no
write ownership. Root created six source/input files plus a release manifest under
`docker-dependency-inventory/`; no runtime stage/archive/container exists from this work.

`collect.py` uses fixed Python `-I -B -S -` to avoid site/.pth execution and reads only complete
installed METADATA fields/hash/size under the fixed purelib. `compare.py` uses the existing Host
Python 3.12.7 and packaging 24.1; all 14 packaging Python files and the executable are pinned.
Current source pyproject bytes are frozen separately. `launch.mjs` owns only the fresh token's
metadata container and a shared 60-second work/cleanup/archive budget.

The command helper is copied byte-identically from the reviewed relay. The evidence-store copy
changes only its marker/disposition schema and the collection-complete acceptance field. Frozen
relay source/archive remain unchanged. Static lint/types/syntax and meaningful parser fixtures
are now in progress. Independent source review is still required before execution.
