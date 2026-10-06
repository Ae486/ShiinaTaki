# W5 native-view patch independent check

Review the complete delivery in `w5-native-view-optimization-implementation.md` against
`w5-native-view-optimization-brief.md`. This is the existing W5 task; later waves remain gated.
Do not re-run historical broad suites without a changed-code reason. Do not run real corpus/model/working-pair
or HTTP acceptance: the parent owns those. Fresh owned fixture PostgreSQL and offline tests are permitted.

## Scope and review

- Verify Taki/Native locations, branches, HEADs and the explicit active task; retain all pre-existing work.
- Compare both Native production files to original and resumed preimages. Verify that ordinary snapshot/hydrate,
  writer and publication paths remain fresh; only `_reuse_body_bytes=True` baseline callers borrow the source.
- Recheck SQL-key/head-envelope identity, duplicate and invalidated fallbacks, exact canonical payload hashing,
  body/version/Bank proof and independent original-text/parameters/availability Source evidence.
- Verify the same Bank/fence lock and write-free validation precondition and separate views for both admissions.
  The optimization must not carry source/head/body state across a write, next baseline or transaction.
- Inspect the fresh owned-PG differential coverage, plain/optimized full hashes and auxiliary state, default D77
  behavior, second-admission corruption/rollback/disposal tests. Select meaningful independent tests covering
  the changed behavior and missing concerns; preserve actual prior failures and distinguish repeated tests.
- Inspect NEW `w5-native-view-postpatch.py` / `w5_native_view_inventory.py` and tests. The inherited manifests,
  helpers and results must remain byte-identical. Verify exact required inventory union, missing/extra/duplicate
  refusal, six explicit authorized predecessor replacements, and unchanged hashes for all other inherited files.
- Confirm the real V2 entry/manifest-reset/nested rehearsal/V3 routing, exact Windows worker handshake and
  before/after parent+actual-worker SHA reports. Preserve no-op default, offline model settings, timers, process
  custody, clone-only network access, failure recording and owned-PG cleanup. Timing success is independent
  of diagnostic completion; no HTTP/authority success may be inferred.
- Run scoped lint/format/types and helper tests. Historical Optional UUID diagnostics and full-package quality
  are separate from the new scoped invocation; report exact commands rather than normalizing differing runs.

## Delivery

Write `w5-native-view-independent-check.md` with the actual verdict, exact commands/results/source identity,
any repairs and remaining parent gates. Independently validate the final source manifest. Report concrete
findings promptly. Fix scoped defects directly if found; preserve any already sealed inventory rather than
silently rewriting evidence, and coordinate a new final inventory with the parent when source changes require it.

An independent PASS permits a parent-owned fresh actual-model diagnostic. Full HTTP timing, working-pair
migration/recovery, per-Bank maintenance allowances and complete W5 acceptance are later gates. No commit,
push, archive, corpus reconversion, renewal, original-data authority replacement or owner/manual acceptance.
