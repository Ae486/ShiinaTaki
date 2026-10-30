# Research: Independent global-rule and SDK entry readiness review

- Query: Do the revised global rules address the owner's observed failures without creating new procedural traps, and is the first SDK child ready to enter bounded development?
- Scope: mixed; local rules/specs/code/tests and retained official packages. Only this report was written; no installs, tests, downloads or Git operations.
- Date: 2026-10-21

## Findings

### Entry conclusion

**Ready for `10-21-ai-sdk-upgrade-baseline` after coordinator global-rule validation.** No further framework/delegation/source investigation is a prerequisite. Ready means capture baseline, review the lock delta, install and verify; compatibility/product acceptance has not passed.

Coordinator-supplied latest authorization (optimize rules, then develop when ready) supersedes `await_owner_start`; update prose without repeating permission. Coordinator resolves the parent through session `codex_01a15dc7-9db1-7e03-a520-9b09333423fb`. `.trellis/workflow.md:76` makes runtime sessions authoritative; the legacy avatar pointer needs no repair. Activate/recheck this child before mutation.

### Revised global rules: sound, bounded translation

`C:/Users/55473/Desktop/codex issues.md` identifies invented blockers, unsupported threat models, symptom patches, premature stopping, requirement substitution, destructive decisions, poor maintainability and self-confirming tests. The revised `C:/Users/55473/.codex/AGENTS.md` converts these into actionable rules rather than adopting the source text's absolutes:

- Lines 7-10 preserve original objectives and truthful completion; green tests/subagent results alone do not establish success.
- Lines 14-20 preserve authorization and clarify actual ambiguity, without repetitive permission loops. Paid/public/destructive actions keep separate boundaries.
- Lines 25-29 require current, reachable premises and stop research when evidence supports the decision.
- Lines 34-40 treat findings as hypotheses, reject automatic Request Changes, and limit advisors to high-impact decisions. Small edits need no ceremony or unconditional model distrust.
- Lines 44-49 favor existing packages, maintainability and dirty-work preservation over metrics/abstractions.
- Lines 53-59 prioritize real complex user paths but allow useful unit/integration and post-fix regression tests; no sole-E2E dogma. Evidence levels stay separate.

Managed jbcontext markers/routing remain at lines 89/139. Coordinator must record saved-preimage byte comparison, encoding and backup validation. This advisor did not edit global rules; no further expansion is needed.

### Package-first premises independently checked

Files checked: parent `prd.md`, child `prd.md`/`design.md`/`implement.md` (requirements/scope/rollback); parent `research/planning-brief.md`/`sdk-upgrade.md` (official evidence/gates); root/Core manifests and lock (current dependency contracts); ChatAgent/MCP factory/candidate source (actual SDK owners); lifecycle/parallel-effect/provider/schema tests and `tool-disclosure.test.ts:200` (mock versus actual serializer coverage); retained target manifests and `local-resolution.json` (version/peer/nested graph evidence).

Retained manifests independently confirm AI 7.0.148/MCP 2.0.81/compatible 3.0.75, Node >=22, zod `^3.25.76 || ^4.1.8`, provider 4.0.31/utils 5.0.65; AI adds gateway 4.0.121. Recorded Node 24.18.0/zod 4.4.3 qualify. Re-inventory actual resolutions before installation.

Limit changes to these existing packages and required transitives. Exact pins trade automatic direct updates for reproducibility, limited to these three packages. Complete future lock/undici resolution remains an execution result. No Workflow/Harness adoption, tuning, new authority or source semantics is needed here.

The plan correctly retains Core responsibilities. Target MCP `mcp-client.ts:985` still makes one-page `listTools` requests; pagination in `:1222` belongs to `tools()`. Target `mcp-stdio/create-child-process.ts:24` hides windows only when Electron is detected, so it does not replace Taki's Node/Tauri relay. Current `mcp-connect.ts:14` does not accept an initialization signal: retain outer deadlines/late cleanup and verify modern discovery, rather than assuming a new package option is wired. Local `chat-agent.ts:333` captures each completed step before subsequent failure; keep this rather than relocating durability to `onEnd`.

### Required verification obligations and two refinements

1. Save current working manifest/lock preimages, fingerprints, Node/pnpm and installed graph before mutation. Parent reports branch `task/t4-skills-mcp-productization`, HEAD `06a8090`, dirty lock/tree. Freeze only SDK-relevant concurrent edits for comparison. Baseline is current source/lock/installed graph, never HEAD/main worktree. Restore owned hunks or reconcile newer edits; reinstall the saved lock on rollback. Existing plan meets this requirement.
2. Run identical relevant baseline/target groups, then required workspace typecheck, root `pnpm lint`, TS tests and backend handoff checks. Separate existing failures with matched inputs/fingerprints; avoid unrelated repairs. Re-inventory imports after installation. Review the complete generated lock against the working preimage.
3. Add bounded reachable-change cases: parseable-but-incomplete streamed arguments; unusual/repeated IDs; unsafe finish reasons executing zero effects; abort settling aggregates without replay; structured-only MCP results; delayed discovery/deadline/late cleanup. Use actual compatible adapter fake-fetch SSE for wire claims and local HTTP/stdio for MCP claims; normalized mocks alone miss these changes.
4. **Refinement: real Node Core boot smoke before and after.** Packages imported at boot can change resolution/initialization even when Vitest/esbuild passes. Follow `quality-guidelines.md` with isolated data/nonstandard port and no model credentials/paid inference, capture listening and stop only the owned process tree. This is an execution verification obligation, not a pre-install blocker.
5. **Refinement: cap/timeout probes are conditional.** `chat-agent.ts:319` sets neither SDK timeout nor toolCallConcurrency. Check existing default parallel governance/cancellation. Unused options need no exhaustive acceptance gate unless a demonstrated compatibility fix uses them.

Dependency/fixture passes establish their recorded conditions, not live-provider quality, packaged process UX, owner acceptance or later delegation/source completion. Report these limits without reopening authorized development.

### Related specs and external references

- Read `.trellis/workflow.md`, backend `index.md`, `quality-guidelines.md`, `mcp-tool-schema-compatibility.md`, and relevant agent-runtime/MCP-lifecycle contracts. Relevant invariants are truthful tool/effect history, nullable-schema isolation, candidate deadlines/leases, and meaningful production boot evidence.
- Official pinned evidence is retained in `research/sdk-upgrade.md`: npm metadata/tarballs for the three exact versions and Vercel commit `e6230e43ba9def164550eea562c457e23be9efa6`. Public documentation: https://ai-sdk.dev/docs/reference/ai-sdk-core/tool-loop-agent and https://ai-sdk.dev/docs/ai-sdk-core/middleware. This review inspected retained published source/manifests and did not refetch those URLs.

## Caveats / Not Found

- No baseline/target tests, installation, live model call or manual acceptance was performed by this advisor. Full lock/engine resolution still awaits execution.
- Git identity/dirty state and authoritative session resolution are coordinator-supplied evidence; this advisor performed no Git operation. Older start-wait wording was still visible during review and is superseded by the latest supplied authorization.
- Global backup integrity and exact managed-block comparison are coordinator checks still to record. No production/config/global file was written by this advisor.
