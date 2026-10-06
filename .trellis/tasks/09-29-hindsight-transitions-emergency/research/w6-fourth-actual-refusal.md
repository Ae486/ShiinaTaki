# W6 actual Local COMMIT and ready binding, unresolved completion

The fourth retained execution ended exit1 normally, without forced termination. Session30139 and Node6004 are
stopped. History `baa914d916a34442a654f436f63b4298` remains unchanged. Unlike all prior failures, this run **committed
Local authority** and reached runtime `ready` / queue `settled`; its operation is still truthfully `outcome_unknown`
because the executor lost its lease during binding completion. This is not an authority rollback.

- Receipt:`5da1b2448bcc7ccaf0a41d5cbfa50fc9ea5e6f77e3610082300c7ea9477eed31`.
- Target:`c4f53993-517e-4d97-96cd-7e916620ce29`; selected mode:`canonical-local`.
- Operation:`391a96ee-e370-4129-911c-2fc37a717f0b`; original transition:`0faf660d-9d8c-4215-ae5f-954f9f574734`.
- Attempt:`867570ab-3677-42b6-9edb-4d808c3f74ef`, generation3/revision10/binding,
  leaseUntil03:30:19.925Z; final proof:`80a9f19628c196d2b336735e805d0950ea14f6b80c4914d497e250f73d9bca11`.
- Exact installation passed at03:28:26.739Z:2Banks/722sources/1275records. The supervisor ended03:33:44.241087Z.
- Actual Core SHA:`2efaa2332a7cee5c7fbed50c58d9f0e3f74d5f0c4049d5ba6b0e6d2210b54949`.
- Supervisor SHA:`983e7809de94f6cc40c3ef7b55c4dc64441bb10e219092b1821909d5ce7b36a2`.
- Driver result SHA:`e2be16cc5bf96cd7b466b44f5d1e2c581e6675e5db94ad02a5698376959802ce`.
- Native/transport/model/in-flight counters0; source and original input preservation PASS.

Independent stopped-state audit confirms one receipt, publication and foreign-branch row for this transition,
one original capture/incident, and selected Local marker/epoch matching the receipt. The sealed Core SHA remains
`cc6dc6567eb3dc88512134f6444945c8c8bdf779a8352f0cd6bf599897569e6b`.

Parent production publication/candidate/retention reread (session66352, exit0) passed without writes. Result:
`w6-fourth-actual-retention.json`. Current2Banks/722sources/1275records/89invalidated match the installed logical
state; there are0 new receipt-backed retention changes and the actual Core hash is unchanged.

The final parent `mode=ro` observation began three seconds after the supervisor had already closed Node and created
an empty WAL plus32KiB SHM beside the WAL-mode Core. Their creation times identify this parent probe, not failed Node
checkpointing. After verifying WAL size0, exact stopped PID and unchanged Core hash, the parent preserved both files
under this history's `parent-observer-sidecars/` with hashes. Nothing was deleted; the Core remained unchanged.
All later stopped-Core reads use immutable mode and no current sidecars remain.

## Narrow continuation

The current driver injects two independent full audits before calling the real runtime binder. The publication
rehearsal measured their aggregate184s cost; they block the event loop and therefore the otherwise working heartbeat.
The real binder performs further independent publication/selection checks. The reviewer is first repairing the
harness's extra-audit boundaries with real yields and same-captured-executor checks, without direct renewal or
reviving an expired owner. Segment clocks will distinguish harness audit, production bind and final settlement.
No additional production cache or lease extension is authorized by this finding.

The next driver entry must explicitly recover this already committed receipt/epoch using the original failed
installation proof, full current retention audit and all earlier unknown-operation hashes. It must not reconstruct
a new authority or rerun an uncommitted recovery wrapper. Parent owns a new exact-state committed wrapper and an
owned-copy whole bind/settle/separate-restart rehearsal. Actual restart, D91 and W7/W8 remain incomplete.
