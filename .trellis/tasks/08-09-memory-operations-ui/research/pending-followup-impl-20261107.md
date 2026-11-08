**1. Outcome — done**

Foreground Pending writes now arm the Bank’s existing retry state and recompute the scheduler wake. Original write identities, foreground deadlines and return semantics are preserved. [source packages/core/src/memory/hindsight/hindsight-memory-writes.ts:46] [source packages/core/src/memory/hindsight/hindsight-replica-scheduler.ts:152]

**2. Changes**

- Gateway handoff and one subsystem wiring line. [source packages/core/src/memory/hindsight/hindsight-memory-subsystem.ts:74]
- Transactional retry request preserving earlier due times and existing backoff. [source packages/core/src/db/hindsight-replica-scheduler-repo.ts:85] [source packages/core/src/db/hindsight-replica-schedule-state.ts:68]
- Existing tests extended for automatic settlement, original identity, manual-only behavior, non-Pending outcomes, earlier wakes and storage failure.
- Step 5 now requires automatic scheduler evidence and original-write completion **before** explicit sync; records settlement delay. Drain checks reject missing/empty summaries and failed/unknown children. [source .trellis/tasks/08-09-memory-operations-ui/research/first-use-runtime/native-smoke.mjs:249]
- Updated both assigned specs and directory indexes.

All 13 changed files and individual hunks are listed in the [report](G:/taki-codex-work/tmp-h/p1-h/report.md); the [patch](G:/taki-codex-work/tmp-h/p1-h/changes.patch) excludes inherited edits.

**3. Evidence and checks**

- Affected Vitest suites: **56 passed**, three files, two workers using `--pool=threads`. Default forks failed with `spawn EPERM`. [run artifact G:/taki-codex-work/tmp-h/p1-h/affected-tests-final.log]
- Core typecheck and scoped ESLint: **passed**.
- Harness `node --check` and ten isolated drain-function checks: **passed**.
- Whitespace and UTF-8/BOM checks: **passed**.

Commands and logs are recorded in the report. No Core, Native or PG services were started.

**4. Trade-offs**

The binding rule remains: **“Manual mode schedules no background due or retry wake.”** Manual-only Banks therefore await explicit recovery. [source .trellis/spec/backend/memory-replica-sync.md:129]

Automatic mode adds timely synchronization I/O. Continued Pending uses existing backoff; completion within 180 seconds is not guaranteed. Scheduling-storage failures preserve the Pending receipt and surface through `lastError()`.

**5. Open items / UNKNOWN**

Actual connected settlement delay remains **UNKNOWN**: the journey was not run, as instructed. The leader must run the updated harness.

No `-o` path was supplied; the complete report is saved at [report.md](G:/taki-codex-work/tmp-h/p1-h/report.md).

**6. Outside scope**

No additional verified defect found. Reserved files, leader records, prompts/templates, original user data and Git state were left untouched.