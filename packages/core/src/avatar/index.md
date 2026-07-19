# core/avatar/
- avatar-subscriptions.ts — the avatar.command fan-out registry (characterId→connection→sink); mirrors timeline-subscriptions
- avatar-vocabulary.ts — per-character {motions, expressions} store fed by avatar.report; get() → per-turn dynamic-enum source (1e), render() → the turn-prompt vocabulary section (Option A), consumeCostumeChanged() → one-shot true after a costume swap (1f, baseline-snapshot diff of the worn costume id)
- costume-notice.ts — COSTUME_CHANGE_NOTICE: the one-shot system note chat-agent prefixes onto a turn's user message after a costume swap (1f), when the vocabulary's consumeCostumeChanged fires
- vocab-name-schema.ts — vocabNameSchema(names): a dynamic z.enum of the live vocabulary (or z.string().min(1) fallback) for the avatar tools' `name` param (1e)
- avatar-tools.ts — AvatarToolDeps + createAvatarTools: the avatar tool family combiner (bound per-turn with the characterId)
- set-expression-tool.ts — avatar_set_expression tool; publishes an expression avatar.command; execute never throws (fire-and-forget)
- play-motion-tool.ts — avatar_play_motion tool; publishes a motion avatar.command (priority/loop passthrough); execute never throws
- presentation-stop.ts — PRESENTATION_TOOL_NAMES + presentationTailStop StopCondition; stops the tool loop after a spoken, presentation-only step so the SDK forces no filler generation (1c)
