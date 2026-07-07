# Hook Guidelines

- Files `use-x.ts`, exports `useX`. One hook per file; colocate inside the owning feature folder (`features/chat-bubble/use-chat-stream.ts`); only truly cross-feature hooks go to a shared `hooks/` dir (create it when the second consumer appears, not before).
- Hooks are the ONLY place components touch `ws-client` / `tauri` wrappers or stores with selectors. A component importing `ws-client.ts` directly is a review-blocker.
- WS subscription pattern: subscribe in `useEffect`, return the unsubscribe function, key the effect on stable ids — never on whole objects. Server-pushed events update Zustand stores; hooks select from stores rather than holding duplicate `useState` copies.
- Streaming LLM output: accumulate into the store (append reducer), let components select the derived string. No `setState` per token in component-local state (re-render storm).
- Every hook returning async actions must expose error state (`{ data, error, isPending }` shape or a store-level error field) — the approval dialog and chat bubble both render failures; silent failure is forbidden.
- Custom hooks stay under 50 lines like any function; extract pure helpers to sibling `*.ts` files.
