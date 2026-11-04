# Independent native-image review

Date: 2026-11-02. Workspace: `H:/TakiAgent-worktrees/t4`, branch `task/t4-skills-mcp-productization`.
Scope: the current tracked and untracked native-image/capability migration, using the owner's all-images-to-main requirement and authorized design. No commit, paid request, production service start or real database mutation was performed by this reviewer.

## Findings fixed

1. **Valid viewing preparation depended on unrelated global foreground evidence.** `main.ts` required a current accepted global foreground sample and a non-sensitive global activity before using an opaque ambient screenshot. Viewing preparation already performs fresh process screening against its exact captured Host, and its availability/presence path does not require a global accepted foreground sample. The root removed these redundant prerequisites, retaining ambient enablement, consent/epoch currentness, captured route currentness and viewing's actual-target screening.

2. **Private child replay dropped native evidence during its per-step SQLite reconstruction.** `private-task-context.ts` used the text-only converter, even after tool image references were preserved in the shared private message schema. Private source projection, tail retention and summary shrink accounting now reuse native replay with one retained-image read snapshot. `run-message-store.ts` and `SubagentDependencies` carry the sanctioned reader; the main `composeSubagents` call supplies the real attachment store. Initial snapshots use the same native projection.

3. **Temporary private screenshots also disappeared during reconstruction.** `private-tool-images.ts` provides an Attempt-local bridge keyed by Run, Attempt, global step and exact tool pair. It supplies only unretained image components, including mixed retained/transient MCP output. Retained components remain the attachment reader's responsibility. The bridge never writes pixels to SQL, drops old state at a new Attempt, and releases temporary evidence within committed summary coverage. The existing outer Attempt owner retains final cleanup responsibility.

4. **Private history had to consume the normalized legacy tool head.** A's explicit SDK media read projection now supplies byte-free tool feedback plus native image siblings. The private per-result reducer consumes that normalized head rather than reconstructing the old raw media output. Historical rows are unchanged; neither this projection nor the temporary bridge guesses images from arbitrary JSON.

## Checked boundaries

- User FileParts, direct/opaque screenshots, MCP typed image/resource results, current ambient/viewing context and retained native replay use the shared normal main-model path. Screenshot feedback preserves complete tool results and image/source association.
- Replay pricing occurs before window/private-tail selection. Last-moment middleware refresh removes expired retained files and retired optional observations without blocking valid text/tool work.
- Ambient consent, deterministic target screening, source retirement and same-Attempt release remain separate from image interpretation. The retired semantic translator/sentinel barrier is intentionally absent, as recorded in the authorized design.
- Bootstrap/provider/config/UI removal leaves historical VLM rows inert. Capability metadata preserves declared true/false/unknown, exact endpoint/model identity, late-client/config-response fencing and the distinction between application tools and adapter-native search.
- Directory indexes and the private-worker/native-image contracts describe the corrected private reconstruction and lifetime behavior.

## Verification

Passed:

```powershell
pnpm --filter @taki/core exec vitest run src/agents/private-task-context.test.ts src/agents/private-native-images.test.ts src/agents/private-tool-images.test.ts --maxWorkers=1
```

Result: 3 files, 20 tests passed. The suites cover real SDK/SQLite screenshot continuation, retained follow-up across new Runs, removal without recapture, byte-free private storage, temporary lifetime, invalidation at actual model intent, mixed retained/transient images, reused pair identities, summary retirement, image-aware fit and legacy explicit SDK media projection.

Focused ESLint passed for the modified private modules, tests, dependency port and fixture. `git diff --check` passed for the reviewer's changes.

The root owns the final workspace typecheck/lint/test/Clippy gates and real boot/UI/provider evidence. Those gates were not duplicated here. The reviewer did not infer manual acceptance or real visual accuracy from deterministic fixtures. No additional proven code blocker remains from this review.
