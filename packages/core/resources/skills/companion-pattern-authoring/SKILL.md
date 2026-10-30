---
name: companion-pattern-authoring
description: Create and manage source-backed Companion interaction habits from an explicit user request, and consider finite automatic follow-ups on current user matters within shared wake policy.
compatibility: TakiAgent with manage_interaction_pattern, plan_follow_up and Interaction Pattern review cards.
metadata:
  version: "2"
---

# Companion interaction habits

Use this guidance when the user asks for a recurring interaction, check-in, or a change to an existing habit.
The current Character's Persona determines expression; the Pattern stores the purpose and supported conditions,
never fixed dialogue. Use `schedule_task` instead when the user explicitly requests a scheduled reminder/task.
The finite follow-up section also applies when the current user message raises a matter worth checking on later.

## Authoring loop

1. Understand the requested purpose and observation. Clarify a missing application, duration, time window or intent.
   Do not claim to detect stress, fatigue, emotion or real-world completion from an application name or screen prose.
2. Call `manage_interaction_pattern` with `list`, `read` or `history` before changing an existing rule. Use the returned
   current bindings internally. Follow a non-null `nextAfter` with `listAfter` on `list`, or a non-null `nextBefore`
   with `historyBefore` on `history`, until the needed rule or revision is found. Each page is bounded to 25 items.
   Never quote opaque IDs, revisions, hashes, cursors or schema dumps as an explanation.
3. Propose the complete definition using only supported data. Conditions are an `all` list of at most eight atoms:
   `local_time_window` (start/end HH:MM and ISO weekdays 1–7), `application_in_set`, `activity_dwell_at_least` (minutes),
   `known_idle_state` (active/idle), `presence_present`, `completion_of` (an actual known background Run), or
   `intention_due` only when a real Intention producer is available. Unavailable sources must be explained honestly.
   Foreground dwell measures continuity of the same accepted foreground activity; it does not measure physical
   sitting time, every open application, or overall computer use. Explain the observed condition precisely.
   When the user requests creation and these fields are clear, actually call `propose`. A prose outline, `list`,
   `read`, or `history` does not save a proposal. Only say a review card exists after an `applied`/`duplicate` result
   contains its candidate revision; a refusal is not success. Do not invent creation/modification dates or say
   "yesterday" without checking returned timestamps against the supplied User Timezone and current date.
4. Include `silent` among allowed outcomes. Select only necessary context: `memory_global`, `memory_character`,
   `accepted_activity`, `accepted_screen`, `presence`. `minimumGapMinutes` separates admitted judgments, including
   silent ones; `chance` can only suppress otherwise eligible opportunities. Global budgets and privacy still apply.
5. Explain the candidate's purpose, observations, thresholds/units, possible expression, timing, lifetime and changes.
   Direct the user to the concrete review card. A proposal or revision is not active until that exact card is confirmed.
   Confirmation still leaves the rule subject to initiative master/source controls, current source availability,
   privacy, quiet hours and shared limits; it does not promise a message at every match.
6. Use `pause`, `resume`, `retire` or `rollback` only for the user's explicit current request. A rollback creates a new
   reviewable revision; it never rewinds history, restores permissions or replays old occurrences.

For read operations, pass null for unused mutation fields. Always supply `listAfter` and `historyBefore`; use null
for the first page and every action where that cursor does not apply. For a new proposal, use a null Pattern ID and expected
version zero. For changes, use the exact latest version from `read`. A conflict requires rereading and presenting the
changed proposal; do not automatically confirm or repeat a mutation after losing its result.

## Finite automatic follow-up

- When an actual current user matter makes a later check-in useful, use `plan_follow_up` if available. A separate
  follow-up request or Pattern confirmation card is not required. Use judgment; ordinary messages do not all need plans.
- Supply a bounded purpose and an absolute inclusive `notBefore` / exclusive `expiresAt` window. The default maximum
  active window is seven days, even when its start is farther in the future. A plan permits consideration of a fresh
  interaction within policy; it promises neither speech nor an event outcome.
- Keep `reportedEventTime` null unless the actual user message literally contains that ISO timestamp. Relative or
  vague timing is not an exact reported instant. Abstain or clarify when a useful window would require invented facts.
- An automatic follow-up is separate from a recurring Pattern and from an explicit reminder/task. Do not convert it
  into `schedule_task` without user reminder/task intent.
- Read `created`, `duplicate` and refusal results accurately. A duplicate retains the original deadline and terminal
  state. Rewording, retries or rediscovering the same old source cannot renew an expired or consumed opportunity.
- Expiry ends that plan's eligibility; it never resolves or deletes the user's underlying matter. A later independently
  eligible interaction may use current permitted Memory to ask a fresh question while the old trigger stays closed.

## Boundaries

- This Skill provides guidance, not authority. Use the registered tool; never edit database files, Persona, safety
  instructions, source code, permission settings or other Skill packages to activate a habit.
- There is no confirmation action in the Agent tool. A generic user "yes" is not permission to activate an arbitrary
  candidate. Closing a review card, reconnecting or restarting does not confirm anything.
- Clock ticks and raw observations only request deterministic checks. A match does not require speech. No new sensor,
  screenshot, external effect or background model is authorized by this Skill.
- Pending revisions leave the accepted rule and its paused state intact. Explain whether the result is a candidate,
  active, paused, retired, duplicate or refused. Never describe a staged candidate as completed activation.
- Keep permanent habits separate from finite one-shot follow-up Intentions and normal factual Memory. Expiry of a
  plan never proves that the user's real-world matter was resolved.
