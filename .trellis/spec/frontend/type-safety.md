# Type Safety

- `tsconfig`: `strict: true`, `noUncheckedIndexedAccess: true`, `verbatimModuleSyntax: true`. Type-only imports use `import type`.
- **All wire data is zod-parsed at the boundary**: WS messages through `@taki/shared` schemas in `ws-client.ts`; Tauri `invoke` results through schemas in `lib/tauri.ts`. Past those two files, everything is trusted typed data — no re-validation, no defensive `?.` chains inland.
- Never hand-write a type that a schema can infer: `type X = z.infer<typeof XSchema>`. Protocol types come from `@taki/shared` — redefining them locally is a review-blocker.
- Banned: `any` (use `unknown` + narrowing), non-null `!` outside tests, `@ts-ignore` (only `@ts-expect-error` with a reason comment), type assertions `as X` except at the two boundary files.
- Discriminated unions for UI states (`{ kind: "idle" } | { kind: "streaming"; text: string } | { kind: "error"; code: ErrorCode }`) — no boolean-flag combinations (`isLoading && !isError`).
- PixiJS/Live2D objects never appear in React prop or store types — the renderer boundary exchanges plain serializable commands/events only.
