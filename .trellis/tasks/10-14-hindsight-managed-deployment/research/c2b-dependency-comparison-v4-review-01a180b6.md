# C2b dependency comparison V4 independent delta review

Date: 2026-10-28. Root session: `01a180b6-1dac-7fc2-b365-15fcb34dd4b4`.
Reviewer: `/root/relay_review_recovered`.

## Verdict and handoff result

**PASS_SOURCE_AND_ORIGINAL_INPUT_CONSTRAINT_REPORT.** V4 correctly implements the accepted
separation of declared dependency constraints from publisher metadata conformance. The exact
pinned local comparator was executed once against the **original, unmodified archive**.

Release SHA-256:
`38b3529030e7b7273a2f95e67df9f3e54dc75199962472eec96af5828dda3eed`.

| Actual output | Value |
| --- | --- |
| Process exit / stderr | 0 / empty |
| comparisonComplete | true |
| dependencyConstraintsSatisfied | true |
| metadataConformant | false |
| metadataConformanceScope | Captured dependency fields only; not a full distribution or import audit |
| Installed / reachable distributions | 221 / 195 |
| Evaluated requirements / issues | 2,026 / [] |
| metadataWarnings | One exact LiteLLM extra-name conformance warning below |
| deploymentReady | false |
| metadataCompatible | Field absent |

This satisfies the declared dependency-constraint prerequisite for the frozen current application
mandatory plus embedded-db profile under the recorded Linux/Python environment. It is a truthful
input to the next offline application-only image slice, not acceptance of an image, imports,
binary/native-library compatibility, tokenizer use, Host/API/authentication/PostgreSQL lifecycle,
receipts, setup or other product gates. No third-party metadata/library/version change is needed
merely to remove this warning.

## Findings (fixed)

No V4 packet defect was found.

Review-only `run-reviewed.py` initially produced a ty diagnostic because reading stdout through
a mixed-value record widened its inferred type. The verifier now parses the original subprocess
stdout bytes directly; behavior and retained execution are unchanged. Final scoped Ruff/ty pass,
and both initial and repaired check records are retained. The actual comparison was not rerun.

## Findings (not fixed)

The existing publisher conformance defect intentionally remains visible:

- Package/version: `litellm 1.93.0`; Metadata-Version `2.4`.
- File: `litellm-1.93.0.dist-info/METADATA`.
- Raw extra: `extra_proxy`; normalized comparison spelling: `extra-proxy`.
- Original metadata SHA-256:
  `2079a96229cf0dabfb2c2f87b5109a7b36108818fa790a2a1da86bd0db97a1ce`.

The result records all those facts. This unused, valid-name, collision-free alias does not become
a conformant publisher spelling. The observed constraint result does not claim optional code
behind that extra is usable.

## Independent source-delta review

The [retained delta](c2b-dependency-comparison-v4-review-01a180b6/source-delta.diff) was checked
against the previously reviewed V3 source. Changes are limited to:

1. Recording exact raw/canonical warning facts for noncanonical 2.3/2.4/2.5 extras, rather than
   stopping all comparison for an unused unambiguous alias.
2. Refusing a warning's canonical package/extra pair if traversal actually requests it.
3. Returning separately versioned comparison-complete, constraint-satisfied, conformance-scope/
   status and warnings fields; removing the ambiguous metadataCompatible flag.
4. Returning conformance unknown (null) on incomplete/refused comparisons, without claiming success.

Standard requirement/specifier/marker/name parsing, supported metadata versions, graph bounds,
source/application identity, pinned parser/executable and exact original result-hash checks remain
unchanged. Invalid name syntax, normalized collisions, unknown versions, malformed requirements
and incomplete metadata still refuse. Missing packages/extras, wrong versions/Python and unresolved
direct URLs still cannot report constraints satisfied.

Warning collection and canonical sets are local derived values; no supplied distribution or
Provides-Extra list is rewritten. The existing application-requirements substitution remains in
a separate local mapping and preserves the original installed application metadata. The requested-
alias guard runs before publishing any completed result. This is a read-only graph evaluation,
so it does not execute optional provider code while traversing.

Root's eleven retained fixtures cover unused warning versus requested refusal, collisions,
bad??? syntax, unknown versions, missing/version/Python requirements, marker/extras traversal,
source replacement and input immutability. Their targeted branches were read; no unchanged suite
or V2 runtime check was repeated.

## Exact execution and immutable-input evidence

The [reviewer runner](c2b-dependency-comparison-v4-review-01a180b6/run-reviewed.py) independently
checked the external release, both source pins, closed four-file packet, pinned Host executable,
all fourteen packaging Python files, and unchanged source/parser/archive bindings before dispatch.
It then invoked exactly:

```powershell
& 'G:/anaconda3/python.exe' -I -B -S H:/TakiAgent/.trellis/tasks/10-14-hindsight-managed-deployment/research/dependency-comparison-v4/compare.py
```

The exact argv, stdout/stderr, exit, timestamps, source/release identities and before/after hashes
are retained in [execution.json](c2b-dependency-comparison-v4-review-01a180b6/execution.json).
Execution-record SHA-256:
`3f361cf57652598fb7c6610088a1ea93b768c1d1b70e9c87d69187ef38501780`.

Original archived result SHA-256 **before and after execution**:
`51afb014ed47b811813880d0b0c6f8e16beaae9cb8db0aa9cee0cec5dc6bf71e`.

The comparator/source identity in the output matches its release:
`da38f88e658825331c0c84500131773d7b65a63a20ec7fdbf0a318a83bb5f139`.

Frozen source pyproject remains:
`6a1735ecb0d5e5f86662cb2138af8c616f36ec1ce071067f190887b4864f59b5`.

The runner rechecked source pins and preserved V3 release/source, its original exit-2 refusal
and the prior diagnostic result. Their hashes are recorded in execution.json and did not change.
There was no in-memory input rewrite in this V4 execution, no installed metadata edit and no
Docker/container/collector invocation. The earlier modified-input diagnostic remains separately
labeled historical evidence.

[Verification summary](c2b-dependency-comparison-v4-review-01a180b6/verification.json), SHA-256
`395564f911ce4015a056a9898ed25669c953b70e70e6d7031723468cbee8e7a1`,
checks all actual outcome fields, exact sole warning, counts, input identity and the absence of
metadataCompatible. The runner refuses to overwrite its existing execution record; retained
evidence can be inspected without repeating the comparison.

## Verification

- **Lint: PASS.** Root's V4 scoped Ruff record and the review-only runner's final Ruff pass.
- **TypeCheck: PASS.** Root's V4 ty record and the runner's final ty pass; the initial runner-only
  type finding remains in reviewer-checks.json.
- **Tests: PASS within scope.** Root retains eleven targeted fixtures, exit 0. The reviewer verified
  the new branches and performed the actual original-archive comparison with before/after hashes.
  V2 collection and unchanged prior suites were reused, not rerun.
- **Runtime boundary:** only the expressly authorized local metadata comparison ran. No Docker,
  API/SQL/provider/model, dependency/installed-metadata mutation, image build, Git or agent action.

Root validation records:
`c2b-dependency-comparison-v4-static/checks.json`.
Reviewer records:
`reviewer-checks.json`, `reviewer-checks-final.json`, `execution.json`, `verification.json`.

## Ownership

Workspace readback confirmed `H:/TakiAgent`, `refs/heads/main`,
`e260ff4b0bf663b5faa0187bc6ec701fd2f007cd`. Root explicitly assigned this sibling C2b
delta while its main task remains D1. Prior context/official-source review was reused.

**Ownership released to Root.** Only this report and its matching evidence directory were written.
All source packets, archived inputs, prior refusals/diagnostics and task metadata remain untouched.
