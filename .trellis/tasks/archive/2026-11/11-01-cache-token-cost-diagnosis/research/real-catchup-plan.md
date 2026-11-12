# Authorized real-data catch-up

The owner explicitly authorized real conversation data and paid model calls after the code-only delivery:
“对于已有的真实对话数据，新的链路是否已经打通，即原本阻塞的未入库消息和未摘要是否已经入库/摘要？允许使用真实数据和付费模型调用”.
This continues the existing task. No new task, deployment campaign, Git commit or Run replay is required.

Verified baseline: actual database `C:/Users/55473/.takiagent/taki.db`, migration 062, Local authority epoch
`b5d0b188-8b10-4847-b51a-41149f5b9dd2`, 4,223 Timeline rows through seq 4232, summary revision 5 through 3715,
continuous ingestion cursor 3812, 417 pending witnesses, and three missing user witnesses at 3816/3838/3847.
No running Core or listener at its default port was observed. Model selection resolves from current config;
credentials remain in the local process and are never copied into reports.

1. Make a consistent SQLite backup and preserve it. Rehearse migrations on a disposable copy, check integrity,
   and retain baseline hashes for raw Timeline, Runs/Effects, old processing spans and immutable witness fields.
2. Apply the ordinary migration registry to the real database under the existing single-writer discipline.
3. Explicitly classify the three individually inspected retained user rows as
   `operator_accepted_historical_user_source`. Call the existing source journal one row at a time within one transaction,
   with exact current row digests, `runId` absent and `committedThroughSeq` equal to that row. Record the real classification
   time and audit identity. Historical Run linkage remains unknown; do not manufacture old source captures or alter Runs.
4. Run the production Local ingestion owner on the captured tail. Reuse saved gates/plans/receipts. Classifying first
   avoids unnecessarily splitting the backlog into extra small model batches. Do not advance baselines or synthesize completion.
5. Run production context compaction once, with actual stored replay pressure, normal history budget/tail policy,
   summary quality checks and source/CAS fences. This one-off uses the supported history-only pressure path; do not
   label its replay estimate as a full assembled request or historical billed usage.
6. Reopen and verify raw data/old records, coverage, pending count, new facts and committed summary. A gate skip is
   completed source processing, not a claim that every message became a fact. Recent raw tail remains by design.

An independent Astra advisor checked these boundaries before mutation. Its main corrections were to classify before
batching, preserve unknown Run identity, and prevent implicit SDK paid retries (default maxRetries is 2).
The one-off model wrapper records each real `doGenerate` attempt and returned raw usage metadata, hashes rather than
logs prompts, and converts a failed call to a non-retryable closed error. Parsing/quality failure preserves usage and
stops the phase for diagnosis. No autonomous tools, tidy pass, background scheduler, old unsettled model Effect, or
unrelated conversation is executed. All private backup data stays under ignored `target/`.

The existing full-project checks establish the production code baseline. This operation needs a migration rehearsal,
actual provider observations and factual postconditions; it does not justify another unrelated full test campaign.
