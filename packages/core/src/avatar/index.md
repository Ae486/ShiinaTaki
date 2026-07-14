# core/avatar/
- avatar-subscriptions.ts — the avatar.command fan-out registry (characterId→connection→sink); mirrors timeline-subscriptions
- avatar-vocabulary.ts — per-character {motions, expressions} store fed by avatar.report; render() → the turn-prompt vocabulary section (Option A)
- avatar-tools.ts — AvatarToolDeps + createAvatarTools: the avatar tool family combiner (bound per-turn with the characterId)
- set-expression-tool.ts — avatar_set_expression tool; publishes an expression avatar.command; execute never throws (fire-and-forget)
- play-motion-tool.ts — avatar_play_motion tool; publishes a motion avatar.command (priority/loop passthrough); execute never throws
