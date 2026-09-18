# D77/B6 Owner-Approved Acceptance

On 2026-09-11 the owner approved one acceptance pass using an isolated consistent copy of actual data,
the configured real models for representative cases, and interruption/restart recovery. The owner also
requested the next task after acceptance. This approval supersedes the implementation-only restriction
for these tests; it does not authorize production activation, original-data writes, Git publication,
task archival, new dependencies, or B7 implementation.

The current task remains `08-09-memory-runtime-integration` in `H:/TakiAgent` on `main`. The native
companion remains `H:/hindsight` on `main`. Recovery must verify these anchors before proceeding.

1. Resolve the actual Core data root from its effective startup configuration. Capture committed SQLite
   state through a read-only connection and online backup. Compare the complete source against the
   retained successful D78 input before deciding whether that native baseline is reusable.
2. Copy the stopped, identity-verified D78 PostgreSQL cluster and its corresponding SQLite evidence to
   a new private owned directory. Never start or modify the retained original target. Restore the
   test-only HTTP endpoint and credential with their existing B3 fingerprint, while using an independently
   named PG process and verified data-directory ownership. This preserves genuine recovery evidence;
   revalidate the restored endpoint before promotion instead of inventing a replacement fingerprint.
3. Use production B3/B4 activation guards on the copy, then exercise the actual D77 application-state
   runtime. Compare every original Source, Memory, policy and Block, and rebuild from provider state
   into a separate SQLite database. No synthetic proof rows or fake completed status are allowed.
4. Run a bounded selection of actual recall, guarded reflection, policy assessment and dialogue/source
   ingestion calls. Record genuine returned usage and latency; absent usage remains unknown. Keep
   conversation content and credentials in the private ignored runtime, out of reports and command lines.
5. Exercise copied-environment offline, lost-response, reopen, concurrent-policy and pre-retirement
   source-flush paths. Stop owned services and report exact passes, failures and remaining limits.

This is engineering acceptance with real inputs. It does not substitute for the owner's subjective
quality judgment or authorize selecting Hindsight in the original running application. B7 still needs
its separate grill before implementation.
