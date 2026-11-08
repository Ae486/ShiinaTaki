# C2b V2 retained collection and V3 comparison independent review

Date: 2026-10-28. Root session: `01a180b6-1dac-7fc2-b365-15fcb34dd4b4`.
Reviewer: `/root/relay_review_recovered`.

## Verdict and actual outcomes

**PASS for the scoped V3 source and retained V2 collection/cleanup evidence.**
The unmodified comparison is **REFUSED**, and the separately authorized modified-input diagnostic
finds no declared dependency-constraint differences. These are distinct results:

| Evidence class | Actual outcome |
| --- | --- |
| V2 complete raw inventory and owned cleanup | PASS: 221 distributions, 2,433,618 metadata bytes, 13 closed commands, original container removed, stage removed, eight workload projections unchanged. |
| V3 comparison-only source | PASS_SOURCE_ONLY; exact reviewed release below. No Docker launcher is present. |
| Unmodified local comparison | Exit 2; comparisonComplete=false, metadataCompatible=false; noncanonical_distribution_extra. |
| Authorized in-memory alias diagnostic | comparisonComplete=true; modified projection reports metadataCompatible=true, 195 reachable distributions, 2,026 evaluated requirements, issues=[]. diagnosticOnly=true and originalMetadataAccepted=false remain explicit. |
| Actual artifact/import/deployment readiness | NOT ACCEPTED; deploymentReady=false. No image build, dependency mutation, API/SQL/provider/model execution, receipt or setup acceptance follows. |

V3 release SHA-256:
`af2026e941ee0515b7fed41a5dce8c66c4409b6d15e65ea1bf1902bf75b8ebc8`.

V2 token `e309a1b4-7047-44bb-a4af-cdd65b1a994a` is consumed and must not be rerun.
The comparison-only profile references its immutable evidence; it does not renew runtime authority.

## Findings (fixed)

- No defect was found in the reviewed V3 source delta or the retained V2 runtime evidence.
- File: review-only `diagnose-closure.py`. Initial scoped Ruff rejected its import ordering.
  The import block was corrected without changing diagnostic behavior; final Ruff and ty pass.
  Initial and repaired records are retained. No frozen source file was changed.

## Findings (not fixed)

The immutable inventory contains one publisher-conformance problem:

| Distribution | Metadata | Raw extra | Canonical spelling |
| --- | --- | --- | --- |
| litellm 1.93.0 | 2.4 | extra_proxy | extra-proxy |

File: `litellm-1.93.0.dist-info/METADATA`.
Original metadata SHA-256:
`2079a96229cf0dabfb2c2f87b5109a7b36108818fa790a2a1da86bd0db97a1ce`.

Every distribution was checked; this is the complete offending set, not merely the first failure.
The full original and transformed Provides-Extra arrays are retained in the diagnostic evidence.
No invalid name syntax or normalized-name collision was found. The eight related Requires-Dist
markers already spell the extra `extra-proxy`. Neither current source requirements nor any
archived requirement requests a LiteLLM extra; the ordinary LiteLLM dependency is selected.

The original source/archive/installed metadata was not repaired. The refused unmodified comparison
remains preserved; its failure does not establish a dependency-version mismatch.

## Retained V2 evidence reconstruction

The [read-only verifier](c2b-dependency-comparison-v3-review-01a180b6/verify-retained.py)
recomputes source/archive hashes, raw command byte counts/digests, projections, original effects,
timing and workload identity. Its [result](c2b-dependency-comparison-v3-review-01a180b6/retained-verification.json)
retains all 13 command indices/PIDs/exits/durations and archive hashes.

| Artifact under c2b-dependencies-run-e309a1b4-7047-44bb-a4af-cdd65b1a994a/ | SHA-256 |
| --- | --- |
| result.json | `51afb014ed47b811813880d0b0c6f8e16beaae9cb8db0aa9cee0cec5dc6bf71e` |
| commands.json | `9cb1b740e631e9b34a27bfedcbf2e951a1ade40c3fafeb0123aa60c7ee89d0fd` |
| disposition.json | `8372a153b8f7f807b083e65cce9206201bec60d68b574a2df4ecfaec493fb567` |
| release.json | `09cecd8d80419224d6b562c179ffee6044551c6ae00523b961bf16b435b1e789` |

The archive contains exactly the ten hash-listed staging files plus disposition.
All source/input pins equal the reviewed V2 packet; embedded release/input projections agree.
The marker contains exactly the consumed token, and staging-file sizes sum to **476,936 bytes**.
Archive readback is independently consistent and the original stage is absent at this review.

Command indices are zero-based. All stdout/stderr values were independently UTF-8 encoded,
counted and hashed. All thirteen children close with no timeout, overflow, spawn/persistence/
stream error, signal or kill. Only expected absent-name/CID inspections 2, 11 and 12 exit 1;
all others exit 0. Each command uses the pinned Docker path, fixed Engine and original stage config.

Command 3 performs the sole fixed create. Command 5 starts/attaches to the returned original CID,
receiving exactly **7,458 pinned collector bytes** on stdin. Its **154,109-byte stdout** decodes
exactly to result.inventory. The collector records **404 ms**, full Linux CPython **3.11.16** marker
environment, the fixed purelib/interpreter, **221 distinct sorted metadata paths**, per-file
hashes/sizes, and a reconciled **2,433,618-byte** read total. The sole unsupported version under
the original profile is:

`hindsight_api_slim-0.9.0.dist-info/METADATA: 2.5`.

This independently reconstructs the retained producer evidence; it does not reread those metadata
files from the now-removed container or turn per-file recorded digests into a new live observation.

Raw inspections 4/7/9 bind the same container:
`86c1fb0ff30b6f23a5456da5715c4c98d9c389a43745ce85ee9839cd635aae56`.
They retain exact image/name/labels, interpreter/argv, UID/GID 1000, no TTY, network none,
no mounts/publication, read-only root, 256 MiB/one CPU/16 PIDs, dropped capabilities,
no-new-privileges, log none, restart no and no OOM. The sequence is created -> exited -> exited,
with original StartedAt unchanged in both post-run reads and exit code 0.

The collector exits naturally; **no stop command or forced-shutdown branch ran**.
Command 10 removes the already exited original CID without force; 11/12 retain exact
no-such-container responses by CID and name. Root's original/pre/post raw workload records match
all eight IDs, images, names, state/running and StartedAt/FinishedAt fields; none is a runtime
mutation target. This equality is not a workload performance measurement.

Work took **2,776.8914 ms**, before-archive time was **4,090.8291 ms**, disposition time
**4,247.9329 ms**, and Root's process closed in **4,578 ms**. Host dispatch/close order is consistent;
the whole result stays below the original 60-second acceptance budget. Docker guest StartedAt
and Windows Host wall clocks are separate domains and are used for identity equality rather
than cross-domain duration arithmetic. Root stdout decodes to the exact archived disposition.

## V3 source and official contract

The complete [source delta](c2b-dependency-comparison-v3-review-01a180b6/comparison-delta.diff)
contains only: adding metadata 2.5, checking already-normalized extras for 2.3/2.4/2.5,
pinning the exact original result digest, and adding comparator/specification identity to output.
Frozen source pyproject equals V2 and the current Native package bytes. Host Python and all
fourteen packaging source pins were independently verified. The profile has only README,
release, compare.py and source-pyproject.toml; no effectful launcher is present.

The current [PyPA core metadata specification](https://packaging.python.org/en/latest/specifications/core-metadata/)
lists 2.5 as legal. Requires-Dist/Requires-Python retain standard requirement/specifier semantics;
new import declarations do not establish actual import compatibility. Current 2.3+ Provides-Extra
writing rules require normalized spelling. The retained Root excerpts were read, followed by an
independent fetch of the canonical page and [PEP 685](https://peps.python.org/pep-0685/) for the
subsequent maintenance question. Relevant exact text is retained in
[metadata-decision-sources.json](c2b-dependency-comparison-v3-review-01a180b6/metadata-decision-sources.json);
PEP 685 is historical rationale, and current PyPA text remains canonical.

## Actual comparison and explicitly modified-input diagnostic

The pinned command was executed once on the original archived input:

```powershell
& 'G:/anaconda3/python.exe' -I -B -S H:/TakiAgent/.trellis/tasks/10-14-hindsight-managed-deployment/research/dependency-comparison-v3/compare.py
```

[Exact stdout/exit](c2b-dependency-comparison-v3-review-01a180b6/comparison-execution.json):
exit **2**, empty stderr, comparisonComplete=false, metadataCompatible=false,
failure=`noncanonical_distribution_extra`. Record SHA-256:
`8e64200f501631d92649c9d47760bb803ecc56b99ed590137f1266e562502a19`.
The earlier unsupported-version refusal remains unchanged in Root's original comparison record.

Root then explicitly authorized an in-memory diagnostic to distinguish publisher conformance
from dependency constraints. The [diagnostic script](c2b-dependency-comparison-v3-review-01a180b6/diagnose-closure.py)
deep-copies the original inventory, validates every extra through the same pinned standard parser,
refuses invalid syntax/collisions, and changes only the one alias above in that copy. It invokes
the same reviewed comparator and verifies the original archive hash afterward.

[Full originals, transformation and result](c2b-dependency-comparison-v3-review-01a180b6/diagnostic-closure.json),
SHA-256 `355d844c0c9a018c6b7d07e74629391fb5b15d2174ef302ee8ca9847fac85c87`,
explicitly set **diagnosticOnly=true**, **originalMetadataAccepted=false** and
**deploymentReady=false**. The modified projection completes with 221 installed distributions,
**195 reachable distributions**, **2,026 evaluated requirements**, and **issues=[]**.

Thus no declared version/missing/Python/selected-extra constraint blocker was found under that
specific alias interpretation. This modified-input result is not acceptance of the original
metadata and does not prove binary ABI, native libraries, imports, tokenizer cache, or API/PG startup.

## Independent recommendation for the next artifact decision

**Do not modify third-party installed METADATA, libraries or versions merely to pass this new
strict conformance guard. Do not block the offline application-only derived image solely on this
one unrequested, syntactically valid, collision-free alias.**

The original C2b artifact prerequisite asks whether complete current declared dependency constraints
are supported by the frozen environment. It does not require repairing every publisher metadata
formatting defect. Changing third-party METADATA would create a new artifact divergence and require
additional identity/RECORD/reinventory reasoning without addressing an observed dependency or
application problem. Upgrading LiteLLM would broaden the dependency/runtime surface unnecessarily.

The current canonical spelling violation remains real and must remain visible. PEP 685 also makes
standard normalization the defined semantics for comparing extra names. Here the raw name has a
single valid canonical interpretation, no collision, already-canonical conditional references, and
no selection by the current roots or any archived requirement. Those concrete facts, together with
the complete successful diagnostic closure, support separating two questions.

A **new, explicitly reviewed result contract** should expose:

- `dependencyConstraintsSatisfied=true` for this exact complete selected closure and frozen
  source/target identity;
- `metadataConformant=false`, with the LiteLLM version, raw/canonical extra, original file hash
  and an explicit publisher-conformance warning;
- original facts, normalization policy and evidence references, without rewriting the installed
  metadata or relabeling the existing V3 refusal/diagnostic as an unconditional metadataCompatible PASS.

Invalid names such as bad???, canonical-name collisions, unrecognized schema semantics,
unparsed requirements, missing distributions/extras and unsatisfied version/Python constraints
must still produce explicit unresolved/refused/unsatisfied outcomes. No incomplete comparison
may claim constraints satisfied. This recommendation covers the current mandatory plus embedded-db
profile; changed extra selections or source/environment identities require their own actual
comparison. It does not authorize or prove the later image/import/API gates.

This is a reviewed decision recommendation only. No next-contract implementation or existing
source-gate relaxation was made by this reviewer.

## Verification and release

- **Lint: PASS.** Root's V3 Ruff record passes; all review-only scripts pass final scoped Ruff.
  The initial helper import-order failure and repaired output are both retained.
- **TypeCheck: PASS.** Root's V3 ty and all review-only scripts pass. No package/runtime typecheck
  or installed execution beyond the local metadata comparison is implied.
- **Tests/evidence: PASS within scope.** Root's ten generated metadata fixtures pass, including
  legal 2.5 and version-specific normalization. Independent retained-byte/resource checks and the
  authorized diagnostic pass. The real comparison refusal is a preserved factual result, not
  a test result changed to manufacture success.
- **Effects:** no Docker/WSL/launcher/build/API/SQL/provider/model, dependency/installed-metadata
  mutation, Git or agent operation. Local parser/comparison scripts and official documentation
  reads were performed. Existing source, archives, refusals and task metadata are unchanged.

Workspace was verified as H:/TakiAgent, refs/heads/main,
e260ff4b0bf663b5faa0187bc6ec701fd2f007cd. Root's explicit sibling C2b assignment supplied scope;
prior context was reused, and checkpoints were persisted before this final report.

**Ownership released to Root.** Only this report and its matching evidence directory were written.
