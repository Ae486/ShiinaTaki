# W5 head prefetch registration repair: independent check

Review the complete `w5-head-prefetch-implementation.md` delivery against `w5-head-prefetch-repair-brief.md`
and the reproduced regression in `w5-native-view-postpatch-analysis.md`. Existing W5, no new task or later wave.

## Scope

- Verify both checkouts and explicit task; compare the three production files to fresh preimages. Preserve all
  unrelated work. The shared protected parser must preserve the original parse/error/order behavior, and both
  ordinary heads and keyed locked view must reach the reader's registration exactly once without another query.
- Confirm no external `_pending` mutation, extra SQL, changed cache/prefetch budget, private scope bypass,
  decoded-object reuse, altered expiry/timeout/model configuration, or carried state across a validation pass.
- Examine actual bundler/reader scheduling regression coverage: sufficient heads/artifacts and source dependencies
  across batches, ordinary body-query count evidence, complete domain correctness where claimed, and matching
  full locked-PG baseline/component/auxiliary hashes. Distinguish synthetic byte-transport proof from domain/PG proof.
- Preserve exact raw SQL-key/envelope validation, duplicate/invalidated fallbacks, non-null head registration,
  malformed-row refusal, immutable-body/hash/Bank proof and fresh Source evidence. Select meaningful independent
  changed-path cases, including independent admissions, corruption and disposal/rollback; do not rerun old broad suites.
- Inspect the NEW additive verifier/entry. Pin the prior checked382-entry manifest itself to
  `e0ec8c9e8b10706411e1f1bc2c43d1d0022a2b010471ef3bc976e4bea8331f4c`. The exact inherited union and declared
  additions must be enforced; only approved production/test/spec entries may replace their predecessor pins.
  Every other old helper/report/manifest/result stays unchanged. Missing/extra/duplicate/unauthorized paths refuse.
- Verify the NEW actual V2 worker entry, inventory module injection, nested manifest routing and fixed dependency
  pins. Both parent and actual worker must verify the same new inventory before/after. Four persisted reports,
  malformed/absent report refusals, sanitized failure records, default no-op, unchanged offline model/watchdogs,
  process identity, clone-only network, exact result proof and cleanup must remain intact.
- Run scoped checks/tests needed by these changes. Respect parent-approved scoped Native lint/format/types instead
  of global auto-fix/dependency sync. No model/corpus/HTTP/working-pair access; owned fixture PG and offline tests only.

## Delivery

Deliver NEW `w5-head-prefetch-independent-check.md`, exact validation commands/results and final source identity.
If repairs are needed, notify the parent promptly, preserve the delivered manifest and preimages, and publish a NEW
checked inventory instead of rewriting sealed evidence. Parent owns leader-now and execution/acceptance documents.

A scoped PASS permits only a parent-owned actual-model fresh-clone test. It does not prove timing savings, complete
HTTP latency, working-pair recovery, maintenance allowance, W5 exit or manual acceptance. No additional renewal,
reconversion, commit/push/archive, authority replacement or W6 dispatch.
