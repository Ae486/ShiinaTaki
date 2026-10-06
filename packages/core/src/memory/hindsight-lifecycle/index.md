# core/memory/hindsight-lifecycle/
Stage 2c lifecycle producers under a committed Hindsight authority. They run only as the bank.provision /
connection.revalidate operation kinds (family hindsight-lifecycle); nothing here writes Memory Authority.
- hindsight-lifecycle-context.ts — the producer deps/call contract and the closed lifecycle error-code mapping
- hindsight-lifecycle-reads.ts — synchronous local reads: one Character's Bank facts, replica binding, the never-throwing live connection, the reviewed fingerprint and the Stage 5 revalidation blocker shared by the producer, trigger and status (the persisted reviewed deployment mode is the reference; a pre-050 row without one fails closed unless the runtime was built on the reviewed fingerprint)
- hindsight-bank-occupancy.ts — read-only native stats probe before the first PUT; HINDSIGHT_BANK_OCCUPIED for a Bank that already holds content
- hindsight-lifecycle-provision.ts — bank.provision producer: local guards (template, fingerprint, runtime), occupancy probe, dry-run (failed row on rejection), the unchanged applyHindsightBank, then one full replica run
- hindsight-lifecycle-revalidate.ts — connection.revalidate producer: Stage 4/5 refusal, lineage admission, export-verify without row writes, fingerprint + deployment mode + compatibility + admission evidence record, then verifiedReconnect (unchanged runtime) or binding replace
- hindsight-lifecycle-service.ts — createHindsightLifecycleService: shared reads, bounded provision/revalidate calls, normal joined stop and epoch-specific emergency retirement; aborted late exports cannot dispatch or publish again
- hindsight-lifecycle-trigger.ts — the R8 automatic submitter: once per (Character, fingerprint) / (epoch, fingerprint) from persisted rows, busy refuses, never throws into the Run
