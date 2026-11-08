# core/memory/hindsight-lifecycle/
Stage 2c lifecycle producers under a committed Hindsight authority. They run only as the bank.provision /
connection.revalidate operation kinds (family hindsight-lifecycle); nothing here writes Memory Authority.
- hindsight-lifecycle-context.ts — producer dependencies including explicit full-authority verification, call cancellation and closed error mapping
- hindsight-lifecycle-reads.ts — synchronous local reads: one Character's Bank facts, replica binding, the never-throwing live connection, the reviewed fingerprint and the Stage 5 revalidation blocker shared by the producer, trigger and status (the persisted reviewed deployment mode is the reference; a pre-050 row without one fails closed unless the runtime was built on the reviewed fingerprint)
- hindsight-bank-occupancy.ts — read-only native stats probe before the first PUT; HINDSIGHT_BANK_OCCUPIED for a Bank that already holds content
- hindsight-lifecycle-provision.ts — bank.provision producer: managed scope-default rollout through the template owner, or legacy occupancy/dry-run/apply/full-sync with existing guards
- hindsight-lifecycle-revalidate.ts — connection.revalidate producer: lineage admission, exact managed receipt/snapshot or legacy export verification, reviewed connection/admission publication and verifiedReconnect or binding replacement
- hindsight-lifecycle-service.ts — createHindsightLifecycleService: shared reads, bounded provision/revalidate calls, normal joined stop and epoch-specific emergency retirement; aborted late exports cannot dispatch or publish again
- hindsight-lifecycle-trigger.ts — the R8 automatic submitter: construction-bound async context independent of the foreground Run owner; once per (Character, fingerprint) / (epoch, fingerprint) from persisted rows, busy refuses, never throws into the Run
