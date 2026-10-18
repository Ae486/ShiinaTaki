# C2a first Docker case: independent static review

**PASS for static preparation only. No Docker, WSL, build, application or behavior test was run.**
The accepted production source and its 182-case evidence remain frozen and were not rerun or edited.
Review scope: the five files in research/docker-acceptance/; three were changed. The historical
preparation-check.json is byte-for-byte unchanged.

## Findings (fixed)

- **F1 / P1 — run-first-case.ts:** the public Shell pin used the production single-link hasher.
  The retained Cargo executable has two links. Public tool pins now use byte SHA-256; installed-file
  trust checks and production source are unchanged.
- **F2 / P2 — run-first-case.ts:** tail=100 and scanning raw multiplex headers could miss earlier or
  frame-split log content. The fixed Engine GET now requests all logs under the 64 KiB cap, validates
  frames and scans reassembled stdout/stderr. Its pipe path uses the standard Windows literal.
- **F3 / P2 — run-first-case.ts:** final scan/cleanup failure now fails the case. Partial-result
  evidence retains the registry path and readable original names; unconfirmed IDs remain undeleted.
  Explicit Docker/Engine/RPC waits share the case deadline; cleanup has a separate five-minute budget.
- **F4 / P2 — container-scan.py:** marker reading now requires a regular file and a 1024-byte bound
  before JSON parsing, rather than reading it before the later scan limits.
- **F5 / P2 — README.md:** the tiny adapter's existing Rust/MSVC toolchain environment is explicitly
  distinguished from cleared Docker/application environments; no compiler wrapper or installation added.

## Findings (not fixed)

None within the static fixture scope. The cached base's internal compatibility is still unknown:
its fixed probe is the conditional first runtime gate, and a failed probe must stop preparation.

## Verification

- Node syntax: PASS; both Python ASTs: PASS without module execution.
- Scoped ESLint with --no-ignore: PASS.
- Single-entry no-emit TypeCheck using the existing base options: PASS, zero diagnostics.
- No unchanged source suite was run. Exact commands/results, before/after hashes and boundaries are in
  [the compact review evidence](c2a-docker-first-case-review.json).
- The actual registration, Core admission/checkpoint, Native module/Engine metadata shapes, duplicate
  observation, bounded scan claims, original-ID cleanup and no-download builder prerequisites were read.

| Final input | SHA-256 |
| --- | --- |
| README.md | a3ada14fe6cb928924b99936a63820a11af96dc3327f16ca0888c4f6d87ca92c |
| run-first-case.ts | 532f800475d8ed9bf14809865e247c805ac8e81dc3109c88b196e04d6bad013e |
| base-probe.py | a6d0548b53bf557157590cc87edb1f30ff190fa5813edf0a477a3ba399b6c021 |
| container-scan.py | cd5eab55311c699c7ef153c1dac036e18d961021028db2942b4a9b376a03a3c0 |
| preparation-check.json | 68f4c32dee404b13c9639f9ef859807048fc0eda47c606d0212c15becca6c09d |

Runtime remains gated on separate experiment approval, fresh fixed-engine/builder/cache checks,
a successful fixed base probe, one labelled local-only image build, the tiny fake-key adapter and
new marked roots/capacity records. Base internals and local-only build behavior have not been proved.
The three unrelated containers and daemon must remain untouched. Fault/restart/DB/C2b/C3 gates stay open.
Fixture directory, this report/evidence and check slot are released to Root.

