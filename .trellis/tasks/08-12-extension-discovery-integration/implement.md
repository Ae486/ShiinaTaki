# Converged Extension Discovery and Integration - Implementation Plan

## Batch policy

This is one substantial vertical batch followed by one formal xhigh `trellis-check`. Do not split the same slice into
recursive delegated batches or repeat a formal check per module. Run focused tests while implementing, but keep the
final quality decision at the complete-slice boundary. Before touching shared wiring or `main.ts`, compare `main...HEAD`
and semantically reconcile any mainline advance; never edit `H:/TakiAgent` or `H:/hindsight`.

## 1. Shared contract and registry

- [x] Add strict Shared extension-discovery schemas/types for identity, bounded descriptors, snapshot generations,
      discovery/search/describe/call inputs/results, collision diagnostics, and provenance envelopes.
- [x] Export the schemas from `packages/shared/src/index.ts` and update `packages/shared/src/index.md`.
- [x] Add strict schema and collision tests. No secrets, absolute paths, labels-as-identifiers, or arbitrary error text
      may cross the wire.
- [x] Add the Core `extensions/` module with deterministic identity/model-key construction, bounded registry assembly,
      duplicate rejection, and an immutable per-Run snapshot.
- [x] Add `extension_discover`, `extension_describe`, and `extension_call` tools. Keep existing direct MCP/Skill/Host
      tools as compatibility paths and route explicit multi-Host calls only through the sealed bridge.

Focused gate:

```powershell
pnpm --filter @taki/shared test -- extension-discovery
pnpm --filter @taki/core test -- extension-registry extension-discovery extension-call
```

## 2. Host context and Agent snapshot wiring

- [x] Extend `host-context.ts` with sanitized status/label/provenance, explicit transfer descriptors, fixed normative
      rules, and tests proving hostile labels/content cannot change control facts.
- [x] Add snapshot creation to the Core composition layer using current Host catalog, Skill catalog, and MCP manager
      projections. The snapshot must perform no secret resolution or external I/O.
- [x] Add the smallest additive `TurnContext`/Agent seam needed to capture one snapshot before the first attempt and
      reuse it across overflow retries. Preserve existing tests and tool assembly behavior when the seam is absent.
- [x] Ensure generation replacement, disable, reconnect, and policy/Approval changes affect future Runs while captured
      calls fail closed as stale/unknown under existing leases.
- [x] Update Core source headers/indexes and `.trellis/spec/backend/extension-discovery.md` with the executable
      contract discovered during implementation.

Focused gate:

```powershell
pnpm --filter @taki/core test -- host-context route-capability mcp-generations skill-catalog chat-agent
pnpm --filter @taki/core typecheck
```

## 3. Home convergence and explicit transfer adapter

- [x] Add one operator-only, Shared-schema-validated convergence projection for Core/Host/Skill/MCP owner and
      generation state, or extend the existing list/status methods without creating a second authority.
- [x] Extend MCP/Skill Home controllers/pages with current-client-only convergence/unknown-outcome feedback and
      refetch-on-reconnect behavior. Do not add local persistence or mutation replay.
- [x] Add the explicit transfer adapter over the existing Host capability broker. It accepts only a sealed Host id and
      advertised transfer capability id; absent capability, stale generation, disconnect, or unknown outcome fails
      closed. Core-local mutations remain on the existing lifecycle services.
- [x] Add focused Desktop tests for old-client suppression, reconnect refetch, owner/generation display, and no-cache
      or replay regressions.

Focused gate:

```powershell
pnpm --filter @taki/desktop test -- mcp skill extension
pnpm --filter @taki/desktop typecheck
```

## 4. Real two-Node process evidence

- [x] Extend `e2e/src/fixture/with-stack.ts` with a second isolated Node data root/process and teardown ownership;
      retain the existing one-Node API unchanged for all prior tests.
- [x] Add one `extension-discovery.e2e.test.ts` covering duplicate capability refusal, explicit Host A/B calls,
      reconnect generation replacement, Host B isolation, stale/late responses, and `cancelled` versus
      `outcome_unknown` settlement.
- [x] Add an Agent-level test proving one Run's discovery snapshot remains immutable across an MCP/Skill reload and
      an overflow retry, with truthful owner/generation result labels.
- [x] Keep real package-transfer execution as an explicit manual/fixture gap when no compatible remote Host advertises
      a transfer capability; automate the refusal and sealed-routing contract instead of faking a successful mutation.

Focused gate:

```powershell
pnpm --filter @taki/e2e test -- extension-discovery
pnpm --filter @taki/core test -- extension-discovery host-generation-retirement capability-broker
```

## 5. Full-scope verification and documentation

- [x] Recheck `main...HEAD` before integration and resolve any semantic conflict in Shared exports, `main.ts`, Home
      registry, or e2e fixtures without reverting unrelated user work.
- [x] Run workspace typecheck, root lint, Shared/Core/Desktop/full E2E suites, Desktop production build, and a strip-only
      Core boot. If Rust files change, run locked Rust tests, Clippy `-D warnings`, and scoped rustfmt.
- [x] Run `git diff --check`, source-header/index audits, and a secret/path/cache/role security sweep.
- [x] Update `.trellis/spec/backend/extension-discovery.md`, touched folder indexes, `docs/HANDOFF.md`, and the
      developer journal with verified results and manual residuals. Do not update `docs/ZCODE-HANDOFF.md`.
- [x] Record that packaged Home/file-picker, external MCP credential round-trip, compatible remote transfer Host, and
      owner manual acceptance remain manual evidence unless actually observed.

## 6. Single formal check

Run one formal xhigh check over the complete Slice 8 diff. The check must review requirements, authority boundaries,
snapshot immutability, host provenance, no-fallback/no-replay behavior, and cross-surface convergence before running
the gates. Findings are first recorded and independently confirmed; only real findings are fixed.

Required gates:

```powershell
pnpm -r typecheck
pnpm lint
pnpm -r test
pnpm --filter @taki/desktop build
git diff --check
```

## Rollback points

- Shared/schema or registry failure: keep existing direct MCP/Skill/Host tools and remove only the new discovery seam.
- Agent snapshot regression: disable the optional snapshot injection and restore the existing per-turn assembly while
  retaining the registry unit tests for a corrected follow-up.
- Home/e2e failure: preserve Core lifecycle authority and revert only convergence UI/fixture additions.
- Never delete Skill package data, MCP desired rows, secret catalogs, Host identity, or another worktree's files as a
  rollback action.
