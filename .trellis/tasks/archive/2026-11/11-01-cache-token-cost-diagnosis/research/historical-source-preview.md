# Historical source preview

Read-only observation: 2026-11-01. Source: `C:/Users/55473/.takiagent/taki.db` with WAL visibility,
SQLite `mode=ro`, `query_only=ON` and one read transaction. No schema/data mutation or application-model call occurred.
Reproduce with `preview_historical_sources.py --db <database> --output <preview.json>`; sanitized output is
[historical-source-preview.json](historical-source-preview.json).

The three old user rows at seq **3816, 3838 and 3847** still have neither Local nor Hindsight primary witnesses.
Nearby Runs remain `recovering/reconciliation_required`. The first two have one unsettled model Effect each; the third
has one settled and one unsettled model Effect. Time proximity is not an exact Run-to-Timeline binding. No candidate
mutation is approved or applied: keep each historical source unresolved until exact independent evidence or a separately
reviewed explicit historical classification exists. Do not mark a Run successful, advance the baseline, delete a row,
or attach guessed response rows to remove the warning.

There are **417** already witnessed, unassigned rows. The unknown user rows separate candidate groups:

| Candidate range | Witness rows |
| --- | ---: |
| 3813-3815 | 3 |
| 3817-3837 | 21 |
| 3839-3846 | 8 |
| 3848-4232 | 385 |

The new consumer can consider valid groups independently, subject to its exact digest, membership, scope and saved-plan
checks. This preview counts candidate witnesses, not successfully extracted facts. Continuous coverage is currently
3812 and still cannot cross unresolved seq 3816; processing later groups must not disguise that gap. Independent context
compaction can proceed without completing this catch-up and leaves original Timeline evidence durable.

The new additive source migration does not retrospectively classify these rows. It prevents new capture gaps and allows
new-process recovery from exact source membership. The user's actual database has not received that migration here.

One-time catch-up may incur Write Gate, extraction and summary calls. Witness counts do not determine exact call counts,
output size or price: batching limits, gate decisions and existing plans/receipts matter. The failed historical compactions
were blocked before summary generation, so they are not 26 paid summary calls. No savings percentage, invoice total or
real-model quality result is established by this preview; paid catch-up and real-data repair remain separate actions.
