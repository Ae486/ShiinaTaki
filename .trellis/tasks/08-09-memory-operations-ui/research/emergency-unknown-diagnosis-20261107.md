**1. Outcome — done: read-only diagnosis**

The immediate failure is a **correct refusal to invent missing policy**, exposed through a **pre-existing emergency eligibility defect**: preview/admission accepts a structurally paired replica without checking whether its surviving Memory units can actually be reconstructed. Execution then retires the source runtime and discovers that reconstruction is impossible. The harness’s post-chat ordering exposed this gap; there is no evidence that emergency failed because of a scheduler lease or queue-drain requirement. [source packages/core/src/memory/transitions/transition-current-identity.ts:75–86] [source packages/core/src/db/memory-transition-surviving-policy.ts:26–46] [inference]

**2. Changes**

None. Source, task records, templates, retained data and inherited changes were preserved. No Core, Native, PostgreSQL or model service was started. All database connections used `readOnly: true`; diagnostic Node processes exited and database handles were closed.

This final message supplies the report. No explicit `-o` destination was provided, and the session filesystem is read-only.

**3. Evidence and checks run**

**Q1 — Exact decision and observed condition**

The error is caught in `executeEmergencyTransition()` at lines 150–163. It records `outcome_unknown`, derives `authorityCommitted` from receipt existence, and reports queue settlement independently. The operation adapter subsequently maps this result to state `outcome_unknown` and reason `commitment_unknown`. [source packages/core/src/memory/transitions/transition-emergency-service.ts:150–163] [source packages/core/src/memory/operations/memory-operation-transition-storage.ts:61–67]

The retained evidence identifies:

- Operation: `d821952c-e045-419d-b9c2-dc5131c67100`.
- Transition: `b15eb573-19e6-4971-b2bd-b84fc6663d01`.
- Logged cause: `MEMORY_TRANSITION_PROOF_INVALID`; phase `fenced`; receipt `null`.
- Attempt revision 3; `lastEvidenceId:null`; cutoff sequence 0.
- One acknowledged incident, but **zero candidate, surviving-evidence, proof, receipt, publication and queue rows** for this transition.
- Hindsight authority remains epoch `9f85de01-c9ed-4431-9905-d59e4b934283`.
- Lease expiry: `21:07:01.782Z`; failure: `21:02:12.845Z`. This was not lease expiry.

[run .trellis/tasks/08-09-memory-operations-ui/research/first-use-runtime/results/2026-11-06T20-38-18.987Z/core-2.log:40] [run G:/taki-first-use-q00t4S/core-data/taki.db]

`queue:"settled"` means the **empty transition queue** is settled. It does not mean Pending memory writes settled. [source packages/core/src/memory/transitions/transition-emergency-service.ts:157–162]

I replayed these actual read-only production functions against each sealed incident:

```text
captureSurvivingBankEvidence
readTransitionPublishedNativeBaseline
readSurvivingBaselinePolicies
```

The failed incident reproduces `MEMORY_TRANSITION_PROOF_INVALID` at **`memory-transition-surviving-policy.ts:46`**: `previous` is absent for newly captured `binding_missing` Memory heads. Candidate preparation calls this validator during reconstruction; its transaction rolls back on failure. [source packages/core/src/db/memory-transition-surviving-policy.ts:44–46] [source packages/core/src/db/memory-transition-emergency-candidate.ts:30–76,117–121]

| Read-only comparison | Failed journey | J17 |
|---|---:|---:|
| Step 15 duration | 25,337 ms | 47,554 ms |
| Mika missing-policy heads | 1; exact predecessor match; passes | 1; exact predecessor match; passes |
| Taki missing-policy heads | 10 new heads; fails | 0; passes |
| Global missing-policy heads | 20 new heads; fails | 0; passes |
| Current-epoch Pending children | 2 submitted | 0 |
| Emergency authority committed | No | Yes |

[run G:/taki-first-use-q00t4S/core-data/backups/incident-be81a681-fa90-4316-a2c1-1b4b548e6ed2/core.sqlite] [run G:/taki-first-use-orER2N/core-data/backups/incident-bd142c41-c892-4539-9494-88fd1c07b072/core.sqlite] [run .trellis/tasks/08-09-memory-operations-ui/research/first-use-runtime/results/2026-11-05T18-51-25.420Z/result.json]

**Q2 — Causal sequence and scheduler involvement**

1. Step 13’s final recall completed at `21:00:08.433Z`. Subsequent auto-gate ingestion created Global and Taki Pending writes at `21:00:09.253Z` and `21:00:14.612Z`, referencing `timeline:taki:5:52`. Step 14 had already started at `21:00:08.519Z`. Its initial Pending-empty observation therefore did not establish post-turn settlement. [run G:/taki-first-use-q00t4S/core-data/taki.db] [run .trellis/tasks/08-09-memory-operations-ui/research/first-use-runtime/results/2026-11-06T20-38-18.987Z/result.json] [source .trellis/tasks/08-09-memory-operations-ui/research/first-use-runtime/native-smoke.mjs:317–325,690–692]

2. Native completed both ingestion operations, but Core retained their children as `submitted` and parents as pending. All 10 unmatched Taki heads belong to that Pending ingestion document. Global contains both new document facts and documentless Memory units created in the same interval. Native completion alone does not prove completed Taki policy publication. [run G:/taki-first-use-q00t4S/core-data/taki.db] [run .trellis/tasks/08-09-memory-operations-ui/research/first-use-runtime/results/2026-11-06T20-38-18.987Z/native.log:13989,14128] [source .trellis/spec/backend/hindsight-application-runtime.md:170–171]

3. **Background recovery was active around Native shutdown.** Taki’s child retry was due at `21:01:20.441Z`; a scheduler attempt started at `21:01:20.721Z` and was cancelled during backup. The retained backup records `HINDSIGHT_CANCELLED`, retry attempt 2. A later scheduler run, `11b55688-50a0-47ce-9cd5-505f01f87740`, started at `21:01:38.276Z` and failed `HINDSIGHT_UNREACHABLE` at `21:01:48.922Z`, during Native shutdown. Global was manual-only and had no automatic retry armed. [run G:/taki-first-use-q00t4S/core-data/backups/7e9784c5-389b-49bb-bea2-d3f64facbf24/core.sqlite] [run G:/taki-first-use-q00t4S/core-data/taki.db] [run .trellis/tasks/08-09-memory-operations-ui/research/first-use-runtime/results/2026-11-06T20-38-18.987Z/core-2.log:35–37]

4. By emergency admission at `21:01:59.089Z`, that run had ended and all retained replica leases had expired. A future retry remained recorded, but emergency retirement disables dispatch, clears the timer and cancels active execution. Emergency does not require zero Pending writes. [source packages/core/src/memory/hindsight/hindsight-replica-scheduler.ts:116–121,257–259] [source packages/core/src/memory/hindsight-runtime-binding.ts:147–156] [source .trellis/spec/backend/memory-transition-emergency.md:91–95]

5. Preview at `21:01:55.832Z` nevertheless stored `takeover:"eligible"`, `blocking:[]`, with Pending counts 2/0/2. Checkpoint pairing passed; missing predecessor-policy correspondence was not checked until candidate reconstruction. [run G:/taki-first-use-q00t4S/core-data/taki.db] [source packages/core/src/memory/transitions/transition-emergency-preview.ts:54–72]

The recorded hashes for the emergency service, identity reader, candidate and surviving-policy validator are identical between J17, this failure and current source. This establishes a pre-existing gap exposed by different retained state, rather than a newly changed emergency validator. [run both journey result.json files, baseline.taki.changedSource]

**4. Trade-offs and smallest correction**

**Q3 — Recommended product correction**

Reuse the existing read-only closure and surviving-policy checks **before emergency admission withdraws the source runtime**:

- `transition-current-identity.ts / readEmergencyTransitionIdentity`: validate consumable policy correspondence, not only checkpoint/head identity.
- `transition-emergency-preview.ts` and `transition-emergency-service.ts / previewEmergencyTransition, plan`: share that eligibility result and expose an existing explicit blocker; reject before `emergencyAdmitted`.
- Reuse `memory-transition-surviving-policy.ts`; retain its strict rejection and the independent final candidate/publication checks.

[source packages/core/src/memory/transitions/transition-emergency-service.ts:44–65] [source packages/core/src/db/memory-transition-surviving-policy.ts:22–49] [inference]

The governing requirements are explicit:

> “Missing/native-only/incompatible/unreadable closure cannot create a submit identity: `expected:null`, `takeover:refused`, explicit blockers.”

> “A surviving `binding_missing` Memory unit may reuse only its exact previously committed healthy Canonical record … Missing or changed correspondence refuses.”

[source .trellis/spec/backend/memory-transition-emergency.md:45–47,60–66]

Tests to extend:

- `transition-emergency-service.test.ts:141`: presently tests missing checkpoints; add structurally paired evidence containing a **new unbound Memory unit absent from the predecessor**. Require refusal without source withdrawal.
- `transition-emergency-admission.test.ts`: introduce that condition between preview and submit; require admission refusal before retirement.
- `memory-transition-surviving-policy.test.ts:78–89`: already protects strict correspondence. Preserve these assertions.
- Preserve the Pending/hung-producer success cases; a blanket “Pending must be zero” gate would violate supported emergency behavior. [source packages/core/src/memory/transitions/transition-emergency-service.test.ts:113–130,153]

For the successful controlled journey, step 14/15 must also establish post-turn settlement and complete policy readiness before stopping Native. Explicitly synchronize manual-only Global; a single earlier Pending-empty poll or successful backup is insufficient. Keep this captured incomplete-policy case as separate negative coverage. [source .trellis/spec/backend/memory-hindsight-backup.md:81–91] [inference]

Trade-offs: additional local proof work at preview/admission; stricter early refusal when policy is unavailable. This preserves evidence and avoids retiring a usable source for a predictably impossible takeover. It does **not** repair an already sealed incomplete incident. No timeout enlargement, scheduler rewrite, policy fabrication or template change is justified.

**5. Recovery state and UNKNOWN**

**Q4 — What Home shows; whether retry helps**

The captured Home page actually shows Hindsight authority, runtime unavailable, emergency “result unknown,” target authority not committed, zero queued intents, and “original execution lease has not expired.” New return/emergency actions are blocked. [run G:/taki-first-use-q00t4S/home-emergency-local-82nTC9/page-error.json] [run G:/taki-first-use-q00t4S/home-emergency-local-82nTC9/failure.png]

Read-only replay of the real status/overview functions shows recovery disabled with `lease-active` immediately after failure, then enabled after `21:07:01.782Z`. However, **enabled recovery is not successful recovery**: it reuses the original immutable incident, whose policy check deterministically fails. No successful retry was executed or demonstrated. [source packages/core/src/memory/transitions/transition-operator-actions.ts:53–67] [source packages/core/src/memory/hindsight-backup/hindsight-backup-emergency.ts:31–35] [source packages/core/src/memory/transitions/transition-emergency-service.ts:178–190]

`outcome_unknown` with `authorityCommitted:false` is truthful for this admitted, unresolved transition: no Local COMMIT occurred, the old runtime was retired, and no release resolution exists. The adapter’s generic `commitment_unknown` reason must not be interpreted as evidence that a Local COMMIT might actually have happened. Changing the result to completed/cancelled or automatically reopening writers would be incorrect. The defect is admitting the known-unusable evidence and offering recovery that cannot resolve it unchanged. [source .trellis/spec/backend/memory-transitions.md:64–75] [source packages/core/src/memory/operations/memory-operation-transition-storage.ts:64–67] [inference]

UNKNOWN:

- Which combination of retry scheduling, F1/F2 timing or v3 extraction made this exposure differ from J17: no controlled ablation exists.
- Exact trigger classification of each scheduler wake: the settled schedule does not preserve a complete wake history.
- Successful restoration/recovery of this retained failed run: not attempted. Its verified pair remains available, but restoration requires its own validation and authorization.
- Fix validation: no edits, Vitest runs or fresh full journey were performed; the checks here were source/hash comparison, retained SQL inspection, actual reader replay and captured Home inspection.

**6. Outside-scope observation**

The same failed Home capture contains a contradictory Local onboarding card saying “current runtime available,” while the authority and transition cards correctly report unavailable. This is an observed display inconsistency; its producer was not investigated or changed. [run G:/taki-first-use-q00t4S/home-emergency-local-82nTC9/page-error.json]