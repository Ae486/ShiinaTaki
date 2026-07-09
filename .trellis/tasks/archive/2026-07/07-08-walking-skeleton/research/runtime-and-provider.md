# Research: Node 24 native TS runner + DeepSeek provider config

- **Query**: (a) Can `node <file>.ts` run the core dev entry incl. workspace `@taki/shared` import on this machine; env-file flag; final scripts. (b) Correct DeepSeek baseURL/model for `@ai-sdk/openai-compatible`.
- **Scope**: mixed (empirical runs on Node v24.18.0 + official DeepSeek docs + one live curl)
- **Date**: 2026-07-09

## (a) Node 24 native type-stripping as the dev runner

All experiments run on this machine (Node **v24.18.0**, `node --version`), throwaway files created under the task `research/tmp/` and deleted afterwards.

### Verified working

1. **Plain erasable TS runs with zero flags**: `node strip-basic.ts` (interfaces, type aliases, annotated fns) → executed correctly, exit 0.
2. **Workspace-linked bare import resolves and stripping applies through the pnpm link**: from `packages/core`, `import('@taki/shared')` resolved through `packages/core/node_modules/@taki/shared` → realpath `packages/shared/src/index.ts` **outside** node_modules → Node loaded and stripped it (proof: execution proceeded INTO `index.ts` — see failure 1 below — and a controlled junction-link replica of the full chain ran end-to-end: bare specifier → junction → `index.ts` → internal import → `console.log` OK, exit 0).
3. **Negative control**: the same replica with the dependency physically **inside** node_modules (not a link) fails with `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING` — confirming Node's rule: stripping applies iff the file's realpath is outside `node_modules`. pnpm workspace links (junctions on Windows) satisfy this.
4. **Env flag exists and works**: `node --help` documents both `--env-file=...` and `--env-file-if-exists=...` on 24.18.0. Empirical: from `packages/core`, `node --env-file-if-exists=../../.env.local <file>.ts` loaded `TAKI_PROVIDER_MODEL` into `process.env`; with a missing file it prints `"<path> not found. Continuing without it."` and continues (exit 0). Use the `-if-exists` variant so CI/prod (real env vars, no file) boots clean.

### Verified failure — the one blocker, with fix

`import('@taki/shared')` currently **fails at runtime**: `ERR_MODULE_NOT_FOUND ... Cannot find module '...packages/shared/src/ping-schema.js' imported from ...packages/shared/src/index.ts`.

Cause: `packages/shared/src/index.ts:1-2` uses NodeNext-style `./ping-schema.js` specifiers. Node's type stripping performs **no extension rewriting**: a `.js` specifier must exist as `.js` on disk. Relative imports between TS source files must be written with the **`.ts` extension** (`./ping-schema.ts`) — verified: a replica package using `.ts`-extension internal imports runs fine through the whole chain.

Required accompanying tsconfig change (TS 6.0.3 installed): add **`"rewriteRelativeImportExtensions": true`** to `tsconfig.base.json`. This (TS >= 5.7) makes `tsc` accept `.ts`-extension relative imports AND rewrite them to `.js` in any future emit, with no `noEmit` constraint — the documented combo for "run TS directly in Node" (https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-7.html, "Path Rewriting for Relative Paths"). The alternative `allowImportingTsExtensions` requires `noEmit`/`emitDeclarationOnly` in the tsconfig itself and makes tsserver complain given base `declaration: true` — prefer `rewriteRelativeImportExtensions`. Vitest/Vite handle `.ts`-extension imports natively.

Scope note for the implementer: new `shared`/`core`/`cli` source written for this slice uses `.ts`-extension relative imports; the two existing specifiers in `packages/shared/src/index.ts` must be flipped to `.ts` (desktop's Vite build accepts that unchanged).

### Recommended scripts (run from the package dir; repo-root env file at `../../.env.local`)

```jsonc
// packages/core/package.json
"scripts": {
  "dev": "node --watch --env-file-if-exists=../../.env.local src/main.ts",
  "start": "node --env-file-if-exists=../../.env.local src/main.ts"
}
// apps/cli/package.json — no secrets needed:
"start": "node src/main.ts"
```

(`--watch` is standard Node and orthogonal to stripping; drop it if unwanted. Root convenience: `"core:dev": "pnpm --filter @taki/core dev"`, same pattern as `desktop:dev`.)

**Fallback if stripping ever blocks** (e.g. a file needs enums/namespaces, which erasable stripping rejects): `tsx` as a devDependency, `"dev": "tsx watch src/main.ts"`. Not needed today — do not add it preemptively. Constraint to keep: **no non-erasable TS syntax** (no `enum`, no `namespace`, no parameter properties) in `core`/`shared`/`cli` — our zod-const style already avoids them.

## (b) DeepSeek as the OpenAI-compatible provider

### baseURL

From `research/ai-sdk-v7-api.md` §1: the SDK appends exactly `/chat/completions` to the trailing-slash-stripped baseURL. DeepSeek's official endpoint is `POST https://api.deepseek.com/chat/completions` (https://api-docs.deepseek.com/api/create-chat-completion); `https://api.deepseek.com/v1/chat/completions` also works (`/v1` is a compatibility alias unrelated to model versions — https://api-docs.deepseek.com/). Therefore **both** `https://api.deepseek.com` and `https://api.deepseek.com/v1` are correct; recommend the official primary form:

**`TAKI_PROVIDER_BASE_URL=https://api.deepseek.com`** (already the current `.env.local` value).

### Model id — action needed

Official docs (https://api-docs.deepseek.com/updates, /quick_start/pricing): **`deepseek-chat` and `deepseek-reasoner` are deprecated on 2026-07-24 15:59 UTC** (15 days from today). Until then `deepseek-chat` routes to `deepseek-v4-flash` (non-thinking). Replacement ids: `deepseek-v4-flash` (default tier) / `deepseek-v4-pro`.

Live confirmation (one minimal curl, key read from `.env.local` as an env var, never printed; `max_tokens: 8`, prompt "hi", non-streaming):

- `POST https://api.deepseek.com/chat/completions` with `model: "deepseek-chat"` → HTTP 200, standard OpenAI chat-completion JSON; response `"model": "deepseek-v4-flash"` (alias routing confirmed), `choices[0].message.content` present, `usage` present, `finish_reason: "length"` (hit max_tokens — expected).

Streaming: supported via `stream: true` SSE per official docs (https://api-docs.deepseek.com/api/create-chat-completion); the AI SDK chat model always uses this wire format for `doStream` — no provider-specific work needed.

### Final recommended `.env.local` (values masked)

```dotenv
TAKI_PROVIDER_BASE_URL=https://api.deepseek.com
TAKI_PROVIDER_API_KEY=sk-***
TAKI_PROVIDER_MODEL=deepseek-v4-flash
```

Change from current file: `TAKI_PROVIDER_MODEL` is presently `deepseek-chat` — flip to `deepseek-v4-flash` (works today, survives 2026-07-24; nothing in code should hardcode either — it is config).

## Caveats / Not Found

- `--watch` + type-stripping was not explicitly exercised together in the experiments (both are stock Node features; risk negligible, and `start` works without it).
- The junction replica used `cmd mklink /J`; pnpm on Windows creates junctions for workspace links — consistent with the direct `@taki/shared` resolution test which used the real pnpm link.
- DeepSeek's `deepseek-v4-flash` id was confirmed as the routing target via the live response `model` field; a direct call with `model: "deepseek-v4-flash"` was not made (single-curl budget) — official pricing page lists it as a first-class id.
- No programmatic `.env` loading in code (invariant 1 kept: env loading is the Node flag's job).
