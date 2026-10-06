# W5 Core validation repair checkpoint

Status: implementation and scoped checks complete; awaiting independent check. See `w5-core-validation-implementation.md` and `w5-core-validation-source-manifest.json`. This is not authorization for this agent to resume the real pair.

The saved 90 MB Character and 25 MB Global evidence validates and builds on an isolated SQLite copy. The original builder needed 288,501 ms; an elapsed-clock production lease guard rejected at 287,275 ms against 255,482 ms of available lease. Its historical bare catch did not preserve the original exception. The copy experiment proves the failure mechanism without claiming recovery of a historical stack.

The repair uses an explicit synchronous, boundary-local native evidence context. Every independent candidate, proof, publication and reconstruction entry starts fresh. Internal calls can reuse only the same database, live context and verified object identity. Reads compare the actual stored identity and full body bytes before reuse. Frozen JSON and copied Map/byte views prevent caller mutation of verified content. The context closes in a finally block; no process-global cache, cross-stage cache, lease extension or asynchronous transaction is introduced.

Current scope: candidate repository and construction/projection/pending/final mapping; W4 publication proof/reader/repository/local installation/representation; transition-only D77 replica publication; sanitized healthy execution diagnostics; focused tests and W3/W4/W5 guidance. Original preimages and the initial manifest remain unchanged; D77 has a separate supplemental preimage manifest.

Updated implementation checkpoint:

- Production wiring and closed-code/stage diagnostics are complete. A first Core typecheck passed. The 13 new context/diagnostic/publication-order tests pass with two workers after the ordering fix.
- New-copy builder timing: 40,213 ms versus the preserved old 288,501 ms. All four elapsed-clock production lease guards pass, with identical 2 Bank / 1,262 record / 722 Source / 1,262 SourceSet counts and the unchanged original source hash.
- First full W4 copy replay: builder 40,569 ms and proof 39,137 ms pass; publication rolls back at the unchanged `verifyInstalledLocal` comparator. A second private diagnostic shows all eight state components have identical content/counts. Only the four derived rows differ in sequence; their exact hash multiset is identical.
- Preimage comparison: the old and repaired builder copies have identical candidate ID, state hash (`c05adf7b6629df18329438b94ae1933013b97f73de2ec863205aacc32ecdaba8`), mapping hash (`fa57cbe4a071cd68c7e8b47cf27074f091226963ffee7c69d184696731faa00f`) and target epoch. The old comparator is byte-identical to the pre-ordering-fix comparator. This identifies a pre-existing publication ordering defect, separate from the lease starvation repair.
- A real mixed-derived fixture reproduces `MEMORY_TRANSITION_PROOF_INVALID` at the old comparator. Applying existing `sortState` to discovered outer arrays makes publication pass; changed derived payload still fails and rolls back. No stored evidence or nested payload order is changed.
- Both successful full W4 replays are complete. Final exact-manifest replay: builder 41,018 ms, proof 38,337 ms, atomic publication 60,324 ms, independent reconstruction 38,548 ms (178,251 ms total). All elapsed lease guards pass; original source hash unchanged. Final result: `w5-core-publication-clock-final-result.json`.
- Final Core typecheck and scoped lint exit 0; 27 test files / 178 tests pass with two workers. All 24 final source hashes and original/supplemental preimages were verified. No replay, test or real service process remains active in this subagent.

The real services stay stopped at 301/329 requests; this agent must not start a real RETURN. All old diagnostic output and preimage manifests remain preserved. The first installed-state diagnostic had a wrong diagnostic-only SQL column and exited before installation; its corrected v2 run contains the actual component comparison.
