# W6 admitted execution: missing-policy projection refusal

The explicit unadmitted successor finished exit1 without forced termination. It successfully passed the repaired
admission boundary, created one original emergency capture, sealed and acknowledged one incident, then reported
`MEMORY_TRANSITION_OUTCOME_UNKNOWN` with cause `MEMORY_TRANSITION_PROOF_INVALID` in phase `fenced`.
It did not reach authority COMMIT. This is not the first attempt's TTL refusal and not an observed lease expiry.

- History:`<prepared>/emergency-history/abe6344ee4bb433dbef99fa25047bbf9/`.
- Exec session81335 and owned Node39952 are stopped; no Core WAL/SHM.
- Operation:`0505474f-3dc3-4b04-8a03-409e8634d239`.
- Transition:`0faf660d-9d8c-4215-ae5f-954f9f574734`.
- Capture:`c0067448-2ea5-4548-aea3-97841eff2216`.
- Incident:`05f6c765-b099-4894-a191-32c83969a481`; sealed directory exists.
- Original attempt:`0769ee5e-5f97-44f9-9f26-2192b30f6682`, generation1, revision3, phase fenced, lastEvidenceId null.
- Lease until01:09:54.221Z; capture created01:06:11.438Z; supervisor stopped01:09:37.877754Z.
- Stopped Core SHA:`41fb3b3d289575f7cd8e276b8c9fea696a8a89581b4c3aac5b31d21688afec76`.
- All Native/transport/model/in-flight counts0. Frozen sources and original prepared/W5 input preservation PASS.

For this transition: capture1, incident1, surviving evidence0, candidate reservation0, candidate0, final evidence0.
The zero candidate-related counts can reflect transaction rollback and do not alone identify the first failure.
Both incident Banks have `paired-replica` evidence and non-null surviving-evidence/checkpoint hashes.

## Parent read-only production probe

The parent opened the stopped Core and sealed incident Core through `openReadonlyDatabase`, called the real
`captureSurvivingBankEvidence` with the original capture/intent Bank/lineage, then performed pure per-Bank Local
projection using each actual original Bank, real published baseline and Local ancestors. The temporary projection
epoch was only an in-memory output address: no scope reservation, operation, candidate, receipt or database write.

- Both Banks' reconstructed evidence IDs and checkpoint hashes exactly match the sealed incident.
- Global projection succeeds:160sources,268records,0pending Sources.
- Character projection throws `MEMORY_TRANSITION_PROOF_INVALID` in `projectMemory`,
  `transition-local-projection.ts:254`, where emergency has no `healthyProof` and the native memory lacks a bound
  application policy. Baseline/ancestor reads succeeded. The source stack identifies this explicit refusal;
  no memory body or credential was printed.
- Both stopped Core and sealed Core SHA values remain unchanged. Probe exec session64248 completed exit0.

The checker is investigating reuse of existing independently validated published policy/absence evidence for exact
unchanged native versions and application state. Do not remove the guard, silently omit memories or invent a
confirmed policy. The separate execution-lease/final-COMMIT gap from `w6-lease-review-plan.md` is also assigned to
this coherent repair. Source freeze is lifted while no actual process is running.

The subsequent production-reader probe (session77206, exit0) found13 Character `binding_missing` memory heads.
All13 have an exact matching complete application head, native version/body/record in the actual published W5
baseline, an original mapping, a stored Canonical record and `transition_initial_policy` history in the committed
candidate. Global has0 such heads. Both actual file hashes remain unchanged. This supports a narrowly proved reuse
of already committed policy/provenance, preserving policyVersion/updatedAt, rather than inventing a new policy or
claiming a new healthy-final proof. An initial raw-document decode probe failed read-only; the successful probe
uses the real `readTransitionCandidate` storage decoder and changes no state.
Parent also independently confirmed the complete authority row hash still equals the preserved input and the
new transition has0 receipts. All actual probe/process sessions are closed.

## Recovery boundary

Neither earlier fresh-entry runner may be rerun. An emergency was admitted and its immutable seal exists; the next
actual execution must recover this original transition/capture/incident through the product recovery path.
Do not rewrite the incident, reset old results, mint a replacement emergency or assume rollback from the outer
driver's failure. Parent owns actual data/probes/supervision; checker owns the scoped source repair and tests.
Actual restart, D91, W7 and W8 remain open.

The parent prepared `w6-owned-emergency-sealed-recovery.py` with the explicit
`--run-reviewed-sealed-recovery` entry. It reuses the original two-process supervisor and adds the agreed
`--recovery-transition-id` argument only to emergency phase. It pins both failed histories, stopped Core,
original capture/incident/manifest/sealed Core, unchanged authority, expired original generation1 attempt and
absence of a receipt. Any new history, changed evidence or already committed effect refuses. The old runners and
results remain untouched. A new recovery operation may observe/complete the same transition; it is not a new takeover.

Supervisor tests:9PASS0.94s, Ruff E/F/I/format120 PASS. Parent actual **read-only** `preflight()` also PASS
(session2412 finished): exact transition/incident found and stopped=true, no writer/model/Native service started.
The reviewer owns the matching driver option and the coherent product repairs. Actual recovery must wait for their
source release. Per-phase supervision remains1800seconds; production TTLs/leases are not enlarged by this helper.
