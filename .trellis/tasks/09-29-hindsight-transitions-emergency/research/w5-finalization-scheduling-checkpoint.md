# Finalization scheduling implementation checkpoint

Owner `/root/w5_snapshot_repair`; parent `/root`. Parent approved exactly two production paths in
`w5-finalization-scheduling-proposal.md`, with focused tests/index/spec. No Native or real-service action is allowed.

Observer repair is immutable: `w5-verified-observation-source-manifest.json` SHA256
`9cb5ecbcf8c13c4e77504da52fd1c2b5fab60f72e60890defa30d40186883a66`, 22 source paths and 19 exact preimages.
Separate scheduling preimages (two production paths + index + spec) are retained in
`w5-finalization-scheduling-preimages/`; manifest SHA256
`dce8468bf0da30688b7a32dc4519c4182895316626be65afb711257fb02c5ba2`.

Implemented `transition-healthy-execution.ts`: same 30s serialized heartbeat and 300s lease, true setImmediate
boundaries before finalization/after each outcome/full bind/full readiness/full queue/native release. Each joins the
current heartbeat tail and rechecks live CAS/config/signal. Successful terminal resolution stops new ticks and joins
first. Complete validators and effect order are unchanged. No transaction includes a new async gap.

Implemented `transition-native-session.ts`: response validation against exact dispatched request/executor precedes
comparison with current active state. Preserve newer/terminal status and newer generation; reject divergent same
revision, request/executor/proof/regression, and never regress accepted lease expiry. No new authority owner.

Verification completed:
- Core typecheck initial and final-v2 PASS. First final failed only on new test Promise.withResolvers lib support
  and an unknown logger object property; test helpers use ordinary Promise now. Old log is preserved.
- Initial new tests 16/17 passed, with a wrong global timer-count assertion counting the new Local maintenance
  timer. Corrected to verify the actual driver's interval handle was cleared; no runtime timer behavior changed.
- Seven-file existing/new regression: 46 tests PASS, 32.54s. Final new two-file group: 17 tests PASS, 14.14s.
- Final scoped lint: one inherited createTransitionNativeSession 63/50 length error, unchanged from preimage;
  no new warnings/errors. The initial unused-rest names were replaced with an explicit semantic status projection.

Complete corpus diagnostic `w5-finalization-scheduling-driver.mjs` finished exit 0; session 33699 is closed.
Result/log have matching scheduling names. No worker-owned heavy process remains.
It takes a new committed corpus copy, captures exact source hashes at launch, retains 60s deadline / 10s polling /
production 30s heartbeat / three-turn response, and checks real Core terminal resolution plus full validators.
Fixture-only correction explicitly models real Native `transition_service.py:360` terminal revision increment;
the old Core synthetic helper omitted it. Parent agreed; no shared fixture or Native production file was modified.

Decisive result: composition 81.657s; driver 434.325s; terminal completed / ready / settled / source-retired / 2 Banks.
The pending heartbeat resolved in 29.507s under the original 60s deadline; diagnostics empty. Full bind 80.853s,
full readiness 39.953s, complete empty-queue validation 118.166s and native release 34.025s actually ran. Cold observer
after binding replacement took 39.343s; warm reads 3.316-3.658s. No generalized latency guarantee is claimed.

Final source audit PASS: six supplemental paths, four exact preimages, all previous observer evidence/old failed
driver artifacts unchanged; launch and end source identities match. Immutable scheduling manifest SHA256:
`f984db6db6bbfbb0d57fe4e61c1056677f02506617c3637d9e7517460f6b2da2`.
Implementation report SHA256: `2e65b5113a62800bd6ff80a6747501a7a16c85904b54d5f0c75d1ff48062e803`.

Next: parent independent combined narrow + observer + scheduling review, before any real-service startup.
Preserve all source/result manifests rather than overwriting earlier checks. Real original hash remains
`a81a1e3ec6e85f3faa287b8b77c704742be7bbf0f05ec594e1a4bc8381c00923`; real pair stopped and budget301/329 untouched.
