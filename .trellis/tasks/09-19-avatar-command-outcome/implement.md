# Implementation plan — Avatar command outcome and tool-contract repair

One `trellis-implement` pass in two internal waves (fail-closed between them), then one formal `trellis-check`.
Owner-only AC7 stays pending after automation.

## Wave 1 — Core truth (Shared + Core)

- [ ] Shared: `commandId`, outcome/reason enums, `avatar.outcome` params/result, `AVATAR_REJECTED`; explicit exports;
  `index.md`; schema tests.
- [ ] Core: `avatar/avatar-outcomes.ts` (+ test) per design §3.1; `subscriptions.isSubscribed`.
- [ ] Core: tools await the outcome and return the design §3.2 table; descriptions per PRD R6; `avatar-tools.test.ts`.
- [ ] Core: `server/methods/avatar-outcome.ts` (+ test); `main.ts` wiring; knob `TAKI_AVATAR_OUTCOME_DEADLINE_MS`.
- [ ] Core: `chat-activity.ts#outcomeMessage` avatar branch; `presentation-stop.ts` one-correction rule (+ tests);
  `chat-agent-presentation.test.ts` request-count scenarios.
- [ ] Headers/`index.md` for every touched directory.

Gate: `pnpm --filter @taki/shared test`, `pnpm --filter @taki/core test`, both typechecks, `pnpm lint`,
real Core boot against a temp data dir (migrations unchanged, ws listening, clean shutdown).

## Wave 2 — Pet UI report + E2E

- [ ] Desktop: `avatar-commands.ts` async classification (+ Lab-table fixtures), controller/scene propagation,
  `ws-client-methods.reportAvatarOutcome`, `restore-pet-connection.ts` report with generation guard (+ tests).
- [ ] E2E: fake-operator scenario (rejected/motion_busy round-trip) and no-subscriber `not_rendered`.
- [ ] Docs: `docs/deferred-decisions.md` D82 (TTS gate vs deadline); D80 and D69 rows updated to point here;
  `.trellis/spec/backend/tool-design.md` gains the "presentation tools return the Presentation Outcome" contract and
  the one-correction stop rule; `.trellis/spec/frontend/live2d-renderer.md` gains the rejection classification facts.

Gate: `pnpm --filter @taki/desktop test`, typecheck, build; `pnpm --filter @taki/e2e exec vitest run <new file>`;
`pnpm lint`; `git diff --check`.

## Final check scope

Full workspace typecheck/lint/tests, Desktop build, the new E2E file, `git diff --stat` proving no Rust/engine/dependency
change, header/index audit, and the AC1-AC6 matrix. AC7 is recorded as pending owner observation.

## Rollback points

After Wave 1 the Pet UI still ignores `commandId` and never reports; every tool result resolves `unknown` at the
deadline when a Pet is subscribed — truthful but slower, so Wave 2 must land in the same commit batch. Revert is a
plain git revert; no migration.
