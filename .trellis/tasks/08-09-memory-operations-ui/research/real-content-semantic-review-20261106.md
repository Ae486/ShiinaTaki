# Research: Scoped precision of the first real Local memory sample

- Query: Which retained claims are supported by the supplied study-evening slice, and which exceed its user evidence?
- Scope: internal; private fixture plus read-only isolated Local SQLite
- Date: 2026-11-06

## Findings

Only the six-message study-evening slice was examined. Private inputs: `G:/taki-memory-real-input-jwav_sy8/conversation-fixture.json`; isolated output: `G:/taki-real-memory-OckQlQ/core-data/taki.db`, opened with SQLite `mode=ro`. No owner DB, model or service was opened. Checks emitted only role/sequence/category/hash/date metadata, never dialogue.

| Claim category | Evidence in supplied slice | Result |
| --- | --- | --- |
| Afternoon subject and evening subject | User source seq4702 directly supplies the two subjects and time-of-day ordering. | Supported as that day's activity/plan statement; not a recurring schedule or proof of completion. |
| User notices Taki prompting | User source seq4699 directly acknowledges the behavior. | Supported observation; stable preference or emotional need is not directly expressed. |
| Frontend/LinuxDO historical topics | Present only in assistant seq4697/4700; absent from the supplied user messages. | Unsupported as user-asserted facts **by this slice**. Earlier history may establish them; this review does not call them universally false. |
| Stable emotional interpretation/preference | No explicit preference statement in the supplied user rows. | An inference must not be represented as an actually expressed user fact under this test's instruction. |

The first retained study source includes both user-supported study facts and assistant-only historical topics. The later isolated assistant answer at Timeline seq8 also includes those topics. Successful retrieval therefore preserves and repeats an overbroad source; matching recall is not sufficient for this precision gate. The companion observation source must likewise distinguish the directly observed prompting remark from inferred emotional meaning.

Temporal evidence is separate. Original fixture timestamps are 2026-11-05; the harness, according to root's runner readback, quotes role/content without those timestamps. Isolated experience units have `event_date` and `mentioned_at` on 2026-11-06, null occurrence bounds, and no explicit original date in retained text. These prove write/mention timing, not the original event date. Missing source date is a harness-input limitation; it does not explain assistant-to-user attribution, since roles remain supplied.

Smallest next validation: keep integration results separate from content precision; assert supported user facts, absence or explicit assistant attribution of extra history, and absence or explicit inference qualification of emotional preference. Include original timestamp/role/source sequence in the bounded historical envelope, and state that only user assertions may be presented as user-expressed facts. Reuse the same sample after the active integration run; no broad runtime guard or wider corpus investigation is justified by this one observation.

Potential prompt-owner seams, if the explicit-instruction case continues failing: `packages/core/src/agents/base-prompt.ts:37-54` owns memory decision norms; `packages/core/src/agents/chat-agent.ts:65-68` substitutes canonical tool vocabulary; `packages/core/src/memory/canonical-tools/retain-tool.ts:8` describes safe durable content but does not impose role attribution. These are prompt/tool-description candidates for a narrowly reproduced requirement, not an automatic production change.

## Caveats / Not Found

- No semantic truth claim is made about omitted earlier conversation. The finding is evidence attribution and precision relative to this supplied slice.
- Phrase/category checks independently confirm role/topic leakage; emotional-preference characterization also uses the root's inspected output assessment. No broad model-quality conclusion follows.
- No source/code change, services, models or tests ran. The sole write is this abstract research record required by the researcher role; private dialogue remains outside the repo.
- The second real integration run is owned by the root; this review does not block or duplicate it.
