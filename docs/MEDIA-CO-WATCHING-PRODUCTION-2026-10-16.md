# Explicit Co-Watching production slice — 2026-10-16

Status: the explicit existing-analysis single-video engineering path passed real browser/desktop validation:
Home acceptance, governed native read, normal Skill/Agent preparation, two timed deliveries, ordinary-chat revision,
Stop and source/privacy retirement. This is not owner persona/quality acceptance or the full MEDIA roadmap.
The owner reauthorized foreground browser use after the earlier wait, and the remaining tests were completed.
No Trellis task/binding, commit, push, archive, main-worktree change or new native analysis was performed.

## Implemented path

Home's Perception page now selects a current browser player and matching completed analysis, explicitly starts a
finite session, shows actual preparation/confirmed-send state and offers Stop plus normal-chat navigation. It uses the
same Character as Chat. The default 120-minute lifetime and allowed 5–720 minute bounds are visible.

Core stores bounded exact analysis references in its own data directory and verifies the original result through the
captured governed `bilinote_read_result` MCP tool. The ordinary installed `taki-co-watching` Skill guides normal Agent
file-tool preparation. Proposal files never grant authority. Preparation and publication use existing Run/Attempt,
Effect, Character queue and the already-created shared delivery owners. No per-timestamp model call is added.

Revision/Stop are also available as a governed primary tool. Revisions withhold output before acknowledgement and
prepare after foreground release; committed moments cannot be renamed and replayed. Source/authority loss and expiry
close work. Elapsed timing windows remain closed after rewind and revision, without claiming the old content is useless.

## Initial live evidence, before foreground availability

All evidence is under `.runtime/co-watching-production-20261016/` in the T4 worktree.

| Step | Observed result |
| --- | --- |
| Native recovery | Current BiliNote production routes launched on loopback port 18484 with an isolated SQLite backup and copied R7 output; original native identities retained |
| Complete result | Actual HTTP 200, 93,226 bytes, SHA-256 `06c65b0e23d4edebda8d6bb50830c5cef66378696213546e9a848dffe704f380` |
| MCP setup | Standard `mcp.add`; only `bilinote_read_result` selected; stdio bridge connected |
| Skill installation | Standard `skill.import`, enabled and available; directory wrapper must equal the declared `taki-co-watching` name |
| Home acceptance | Actual `开始共看` click created session `4904bb50-bbc4-4cc9-b91a-82e4d3b0cc9a` and accepted Run `09e1db2f-e1d5-43d2-906b-23203f30567a` |
| Approval | Actual Home approval for `co-watching-native` / `bilinote_read_result`, allowed once; global MCP posture unchanged |
| Real preparation | `deepseek-flash`, ordinary Character context, installed Skill and real file tools; four validated optional reactions; no preparation text entered Timeline |
| Playback trial | Browser reported hidden while another application occupied the foreground; output remained held, sent count zero |
| Subsequent source loss | Session closed as `source_lost`; root cancelled; one prepared child retained `expired` with no Timeline sequence |

The initial malformed Skill import was rejected because directory imports require their named wrapper. The corrected
package is `integrations/taki-co-watching/SKILL.md`; the rejected import remains separate evidence. No validator was weakened.

Authoritative `run_usage` rows for this production preparation report four completed model Effects and **51,824 tokens**
(input/output totals: 10,890; 11,594; 14,592; 14,748). All four usage rows have reported totals. These are additional to
the earlier 160,138-token synthetic-transport composition test, and do not include any later test not yet performed.
`execution-evidence-20261016-123021.json` records the corresponding Effects and delivery state without prompts or secrets.

## Foreground rerun and correction

The first foreground trial delivered one real response (Timeline seq 47), but its ordinary-chat revision loaded the
preparation Skill and tried to locate task files, eventually requesting a shell command. That path was interrupted;
the transcript retains the file-read failures and command timeout. The Core primary-tool wiring was independently
verified through the ordinary `ChatAgent` seam. The missing distinction was then made explicit in the Skill:
ordinary chat must call `manage_co_watching`; only Core-supplied private preparation receives exact file/revision work.
No tool permissions were widened and no file search was used as a substitute for the control tool.

The updated Skill was imported normally as configuration revision 3. The following complete sequence then passed
under session `d446d84d-e32c-46eb-ba58-a523e9821d15`, accepted Run `e74b2232-0041-4cbb-ac95-c672c575bcf5`:

| Real action | Evidence |
| --- | --- |
| Home Start, actual native read and private preparation | Four valid candidates; original analysis reused without resubmitting native generation |
| Play near 1 second | Timeline seq 55 and child `07e9e357-4204-4872-898d-870825287e5a` confirmed `sent` |
| Ordinary chat requests a gentle, encouraging tone | Actual `manage_co_watching` call/result at seq 57–58, `revision_queued`; runtime observed `revising` before returning to `ready` |
| Background revision | New revision `91e962e4-3ca7-4d8d-b9c5-022df53d91be`, three future candidates; the first delivered candidate remained closed |
| Pause at 64 seconds | No delivery or new Timeline row across the observation interval |
| Play near 64 seconds | Revised text at Timeline seq 60, child `2b0b0295-785a-46a1-9ae9-eace561b6892` confirmed `sent` |
| Rewind to 1 second | No replay of the delivered response |
| Skip to 260 seconds, then rewind to 110 seconds | Remaining elapsed candidates expired; no catch-up or reopened timing window |
| Ordinary chat requests Stop | `manage_co_watching` returned `stopped` at seq 63; the foreground reply completed normally, and subsequent playback produced no video response |

The two publication children have **zero model Effects**. Their actual Home rendering was visually inspected; see
`play-1792128931068.png` and `chat-stop-confirmed.json`. The second delivered text was:

> 这几类转场能分清楚就不容易了，慢慢试，不用急着一次全用上。

Separate real tests also passed:

- Desktop Stop in the earlier foreground session, followed by real playback with no further output.
- Privacy Pause closed ready session `ce7f53c0-4bbf-4d37-b43c-124b610e7b06` as `source_lost`, cleared sources and
  expired its held child without a Timeline row. The first restore attempt encountered a changed active Home page;
  restoration through the visible Perception page then passed. The runner now navigates first and selects only
  visible controls. Restoring observation did not resume the closed acceptance.
- Navigating the actual selected tab to BV1BTP5euE75 retired session `7455c58a-fb83-4673-9d6d-26df70eed21a` and its
  pending preparation. Original and replacement source references differed. Returning to the original video did
  not resume output; subsequent real playback remained silent.

The source-swap test reached a real model request before cancellation. Its Effect is `outcome_unknown` with
`provider_stream_interrupted`; no candidate or Timeline output was accepted. Do not report that test as zero-cost.

## Measured model usage

`execution-evidence-20261016-134535.json` joins exact accepted roots and the three script-sent foreground message
identities. The owner's independent app/timezone conversation is excluded. All listed known totals are reported
provider usage, not local token estimates.

| Scope | Model Effects | Reported tokens |
| --- | ---: | ---: |
| Earlier hidden-browser preparation | 4 | 51,824 |
| Pre-fix foreground preparation and failed revision | 8 | 122,016 |
| Successful session preparation, revision and two control chats | 13 | 205,442 |
| Ready-session privacy test | 4 | 59,999 |
| Source-swap cancellation | 1 | Unknown |
| Cumulative production validation | 30 | 439,281 known, plus one unknown call |

The reauthorized foreground turn therefore adds **387,457 reported tokens**, plus the source-swap call's unreported
usage. The earlier 160,138-token synthetic-transport composition remains a separate run and is not in this table.

## Verification and remaining work

- Core focused tests cover catalog/native identity, exact operator scope, duplicate start, two Timeline outputs with
  synthetic ports, foreground revision, committed/elapsed-window replay prevention and Stop during late work.
- Desktop tests cover the real WS inbound seam and subscriptions, stale/hidden reads, command settlement and unknown
  outcomes. Shared tests cover the new schemas, immutable control capability and presentation inventory.
- Final Core, Shared and Desktop typechecks and scoped lint passed. Frontend build passed with the existing
  large-chunk warning. Final focused suites: Core 27 passed / one opt-in real-model test skipped, Desktop 52 passed,
  Shared 40 passed; the separate shared delivery/browser/Core-tool/chat-name regressions passed 54 tests.
- Shared delivery/browser/Core-tool/chat-name regressions: 54 passed. The opt-in paid fixture test was not rerun.

Final state: Core PID 21100 and Skill revision 3 remain available. The original video is paused, observation is enabled,
and no active Co-Watching acceptance remains. The user's current timezone is Asia/Shanghai after their separate setup
correction; the test did not overwrite it. `final-live-state.json` records this state. No fake source frames, forced
visibility flags, modified model proposals or fixture transport acknowledgements were used to obtain delivery results.

Full restart/Continue, automatic invitations, recommendation entry, native-service browsing, account integration and
optional natural-completion synthesis remain outside this explicit existing-analysis slice. Owner quality/persona
acceptance remains separate from automated evidence.
