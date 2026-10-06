# Verified observation implementation checkpoint

Implementation owner: `/root/w5_snapshot_repair`; parent `/root`. Active existing task remains
`09-29-hindsight-transitions-emergency`; no task/Git/Native/service/model actions are authorized to this worker.

Parent approved the nine production paths in `w5-verified-observation-proposal.md`, then explicitly added only
`db/memory-transition-publication-proof.ts` for `assertIndependent()` at its public context-accepting boundary.
All ten production paths are implemented. Full independent publication reads reject observer contexts; original
mutation/COMMIT entrypoints create fresh contexts. The original reader's database queries and mutable joins remain.

New preimages: `w5-verified-observation-preimages/` with `w5-verified-observation-preimage-manifest.json`, plus
`w5-verified-observation-guard-preimage.json` for the separately approved tenth file. The prior narrow manifest
SHA256 remains `5f056f60218dbba7a1b574f7f89c63f77b788e394321fb1ab421f2bba3ca2341`.

The new domain store retains only freshly byte-matched native verification and frozen pure Bank projections,
one projection variant per Bank. Each successful observer read prunes untouched dependencies; any error, selected
receipt change, binding revision change or close clears reuse. Binding revisions follow the existing private state
object identity and lifetime, with detached publication metadata; no second binding/authority owner was introduced.
Already-published default boot primes the observer before client dispatch. Full operation `ready` remains separate.

Completed: initial and final Core typechecks PASS. Final serial regression groups pass 10 files / 84 tests (37.72s),
5 files / 33 tests (31.35s), and 2 files / 17 tests (22.99s): 17 distinct files / 134 tests. Initial observer/store
21-test regression also passed after correcting two inaccurate test expectations; its original failed log is retained.
Cold full ID-based native reads do not reject slot-only mutation, whereas warm observer byte identity does. This
existing full-reader limit is explicit in the tests/spec and was not silently expanded in this observer repair.

Default positive-binding replay PASSES: `w5-verified-observation-replay-result.json`, cold composition 81.921s,
warm polls 3.824/3.632s, actual client pending response 3.834s. Original 60s deadline / 10s poll / 3 event-loop turns.
The warm observation threshold is the actual 10s poll period, not the earlier absent-binding-only 1s criterion.

Complete driver replay FAILS: `w5-verified-observation-driver-result.json`, composition 82.423s, driver 419.430s,
terminal operation outcome_unknown at settling. Primary diagnostic is MEMORY_TRANSITION_LEASE_LOST; the pending
heartbeat is cancelled after 349.467s by finally and logs HINDSIGHT_CANCELLED, not HINDSIGHT_TIMEOUT. Native outcomes
are synthetic over the preserved real corpus; this proves Core behavior, not actual Native retirement. Real full
bind/ready/executeIntents/nativeRelease form an uninterrupted synchronous chain. Do not skip full queue validation.

Parent received `w5-finalization-scheduling-proposal.md`: only proposed execution/native-session changes for real
event-loop boundary yields, joining the existing heartbeat and preserving newer terminal/executor statuses against
late renewal. Parent subsequently approved and the separate scheduling repair is delivered; see its checkpoint and
immutable source manifest. Observer delivery itself was frozen first: manifest SHA256
`9cb5ecbcf8c13c4e77504da52fd1c2b5fab60f72e60890defa30d40186883a66`, 22 paths / 19 preimages. Strip-only boot smoke,
final Core types and 17-file/134-test regression pass; scoped lint retains only inherited Hindsight binding54/50.
The old failed full-driver result is preserved; new scheduling replay reaches completed terminal resolution.
Real pair is
stopped, 301/329 budget unchanged, source SHA256 a81a1e3ec6e85f3faa287b8b77c704742be7bbf0f05ec594e1a4bc8381c00923.
No real HTTP/PG/model calls by this worker; diagnostic copies and immutable predecessor evidence are retained.
