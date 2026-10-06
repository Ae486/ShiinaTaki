# W5 reentry candidate timeout diagnosis checkpoint

READ-ONLY diagnosis/proposal only. No production/helper/old-report changes, real pair,
PG/HTTP/model startup, dependency/Git/task changes or delegation. New diagnostic artifacts
and derivatives are allowed. Parent may run the explicitly delivered PG-only audit.

Only offline input: `.trellis/.runtime/w5-reentry-candidate-timeout-500a3683cc5d45e8ab52f92beb7f2205`.
All9files verified against copy-manifest. Copied SQLite312033280bytes, SHA256
`e800dc396be19e65b90edd789420e2a2e787a9ae83269892998f7233ace6dbd0`.
Actual parent source hash is different:
`5f12a7385d6b1fa97bcd98fc1a529a891660f76fa053792ea213519109b5ceb3`.

New transition `6d27eb9b-6bbd-4b56-8ef4-0fda9c5eec53`, operation
`2e1846ad-3167-4e13-b60f-2b328d22979c`, request
`b13bf832-a118-4ba4-9092-58610cf18f66`, preview
`5c4a768c-5900-498c-bb4b-42e083a883de`; admitted12:52:28.588Z.
HINDSIGHT_TIMEOUT at12:57:06.624Z in candidate; abort uncertainty3mslater.
New Core attempt remains fenced; lease until13:02:01.828Z. Only two new acquire
commands; new verify/delta-result/Source-upload/native-evidence/final-candidate all0.
Original RETURN and successful request supersession must remain immutable. Future
continuation uses this SAME admitted transition with ordinary recovery, no renewal flag.

Only new preparation `f71c1133b1fdf655b1b3cbe5a373152754af9283b3152c68e945cc84a2a404ce`,
Character Bank `taki-hs-v1-c-d60b8f9887b9060b6c4bf519d7c87b71`.
Delta operation `6497dfc9-e287-4cb1-96b5-1020ea1eabc4`, request hash
`946b0a8228df74206a91ea4154e34d6592082e5afae2c069a71846e8e301b8d7`.
Preparation2.115MB; native1559(1491reuse/68upsert), application1558(1445reuse/113upsert),
rows.memory_units68, documents/chunks0. No Source-body upload.

Source chain: prepareHealthyTransitionCandidate -> executeTransitionDelta -> historical
transitionDelta GET; on absence, guarded applyTransitionDelta (may capability-probe first)
-> POST executor/delta. No separate Core delta-dispatch journal distinguishes these calls.
Native delta lookup reads its owner+immutable delta row in a readonly-style transaction;
apply has two admission/preflight transactions, preparation outside the write transaction,
then all native/application writes plus delta receipt in one transaction.

Ranked predictions shared before probes: Native delta transaction/lock cost; Core event-loop
blocking while a request is in flight; delta lookup/capability stall; response validation
cost. Current log alone cannot identify the timed-out endpoint or prove commit absence.

New parent-only script `w5-reentry-candidate-native-audit.py` reuses existing
`w5-return-recovery-audit.py` custody/start-stop/source-preservation. It pins actual source
SQLite hash, uses read-only PG transactions/30s diagnostic statement timeout, inspects exact
new owners/history/delta identities and verifies any delta request/result hashes using native
schemas, then counts only this transition's maintenance/steps/actions. No engine/HTTP/model.
CHILD MUST NOT EXECUTE. Next: send scope to parent, build offline Core timing/replay feedback
over a new SQLite derivative, capture result and write final diagnosis/proposal. Do not
assume the earlier admission/observer problem explains this new post-admission timeout.

## Subsequent measured progress

Parent executed the metadata audit: no persisted exact delta, no new maintenance/steps/actions;
both new owners remain fenced generation1/revision2, original92steps/769actions preserved.
Supplement inside the offline input directory: parent-native-audit-1d17df9a0a284fd0ac81df6b70782889.json,
SHA2564562c3944ed7685ee3c616105ad2d1fe59ce153f2578f3afff8cbda81217dd25.

New child-only offline script w5-reentry-candidate-core-diagnostic.mjs reached actual POST handoff
with synthetic GET/manifest: execution5.296s, dispatchguard4.659s, readPreparation0.489s,
requestschema/sign0.222s, POST2,113,480bytes. Success result:
.trellis/.runtime/w5-candidate-core-diagnostic-eefd6de7-d118-48d0-a4c6-332a2c987ed6/result.json.
One exact operation-state read is answered running in the diagnostic facade; actual copied
operation/request/lease bytes remain unchanged. Historical clock, real finite clienttimeout60s.
No Native/network/model and no delta result.9original inputs preserved; derivative integrityok.
Body kinds:44memory,68memory_evidence,1block,0source_evidence; memory_evidence triggers capabilityGET.

New pure Native codec script w5-reentry-candidate-native-codec.py passes3runs: requestparse144–153ms,
hash227–233ms,68factconstruction<1ms with SYNTHETIC vectors (not actual embedding cost).
Success .trellis/.runtime/w5-candidate-native-codec-04be223173274d1c87791cd2394736c2/result.json.

Parent approved/executed additional read-only timing script w5-reentry-candidate-native-timing.py:
capturebaseline21.922s/hashmatches, preflight1.195s, predecessors3.725s;24,864SQLcalls8.720stotal,
maxsingle0.539s.20,058calls arebodydescriptor/bodypartqueries.36,070auxiliaryrecords,
1,559nativedescriptors,1,515existingapplicationpredecessors.180swhole/30sSQLDIAGNOSTIClimits;
readonlyRR, rejectDML/locks, noengine/HTTP/models/apply. ParentPGstopped/sourcepreserved/count301.
Supplement parent-native-timing-ad45dcd8eb2a483393996e135bc21237.json SHA256
b597e603dc98df81c2de3158c25ba234daffd537e585bcee504fa68b07d61987.

Read w5-reentry-candidate-timeout-diagnosis.md for detailed evidence and next proposal.
NO fullapply timeout reproduction yet. Twofold read-stage arithmetic53.684s is not measuredfullapply.
Proposed next: ONEparent-owned stoppedNativeclone, <=2GiB/symlink-free verifiedcopy, newport,
same-transition ordinaryclaim, exactdelta identity, one realDeltaService.apply using syntheticvectors,
noHTTP/LLM/maintenance;180sdiagnostic and60sobservation only, finallystop. Requested parent scope;
not performed/authorized yet. Parent owns any realpair orclone start. Do not modify production/timers.

## Final clone result and next scope (supersedes pending-clone paragraph)

Parent approved, reviewed and executed new parent-only w5-reentry-candidate-native-clone.py.
Child did NOT execute it, read originaldata or start a clone. Child mayread result/manifestonly.
Result .trellis/.runtime/w5-candidate-native-clone-22efe32ae26c4938b6bf3edfd36c8278/result.json
SHA25645aa7df021304e1fe8891a2087357d48c2ab8d2e2f0876d056cfe70a2da5645d.
Source1660files/550592708bytes; allsource/copy/input/core/original/historychecksPASS,
clonePGstopped, no model, no realpairapply. Same transition/delta hash withnormalcloneclaimgen2.
Actual fullapply94.569s,60.382s observerPENDINGinsideSECOND_admit/baseline BEFOREnative/appwrites.
Baselines30.564/30.336s,total60.900s;preflights1.378/1.346s;predecessors4.821/5.003s;
syntheticpreprocessing1.97ms;nativewrites12.409s;appwrites12.623s(includessecondpredecessors).
Oneexactreceipt,lookupmatches1559mappings/1558artifacts. Internalrenew15–29ms,nolongcommit.
Identicalsyntheticvectorsaffectlatergraphwrites;doNOTcallfull94.569sarealmodellowerbound.
Decisiveprewritebudgetoverrunisindependentofthatwriteeffect. OriginalHTTPendpointstillunknown.

FINALdiagnosis: w5-reentry-candidate-timeout-diagnosis.md.
AwaitFORMALscopeapproval: w5-reentry-candidate-timeout-repair-proposal.md.
Proposed4Nativeproductionfiles: newtransition_baseline_reads.py,application_state/store.pyrawloadhooks,
transition_snapshot.pyprivateperinvocationreader,transfer/transition_delta.py_admitoptinonly.
CacheIMMUTABLEBYTESonly;eachread_bodyfreshdecode/schema/sourceclosure;noPydanticsharing,
noacrosstransactioncache,twocompletebaselinesremain,writesordinary/defaultordinarypathunchanged.
Boundedrawprefetch/correctfallback,cycle/mutation/corruptionregressions;freshPREAPPLYcloneforperformance.
No production implementation yet. Continue only after parent reviews concrete proposal.
