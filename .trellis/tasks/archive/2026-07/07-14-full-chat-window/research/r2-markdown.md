# Research: Markdown rendering for the chat window (React 19)

- **Query**: react-markdown + remark-gfm current versions, React 19 compat, XSS default safety, streaming re-render guidance
- **Scope**: external (npm registry queried directly + official README)
- **Date**: 2026-07-15

## 1. Versions and install specifiers (registry-verified)

Queried the npm registry directly on 2026-07-15 (`pnpm view`):

| Package | Latest | dist-tags |
| --- | --- | --- |
| `react-markdown` | **10.1.0** (published 2025-03-07) | `latest: 10.1.0` (`next: 3.0.0-rc4` is an ancient leftover — ignore) |
| `remark-gfm` | **4.0.1** (published 2025-02-10) | |

Install (in `apps/desktop`):

```
pnpm add react-markdown@^10.1.0 remark-gfm@^4.0.1
```

**React 19 compatibility**: `react-markdown` peerDependencies are `react >=18`, `@types/react >=18`
(registry-verified). v10.1.0 explicitly "Fix types for React 19" (PR #879,
https://github.com/remarkjs/react-markdown/releases/tag/10.1.0) and the repo's own devDependencies
test against `react ^19.0.0` / `@types/react ^19.0.0`. Confirmed compatible.

`remark-gfm@4` adds GFM: tables, task lists, strikethrough, autolinks, footnotes. It requires
remark-parse 11+ which is what react-markdown 10 uses internally — the pairing 10.x + 4.x is the
documented combination (https://github.com/remarkjs/react-markdown#use).

## 2. XSS safety: the default IS safe — no sanitizer needed

From the official README (https://github.com/remarkjs/react-markdown#readme, sections "Features"
and "Security"):

- "**safe by default** (no `dangerouslySetInnerHTML` or XSS attacks)"
- "`react-markdown` typically **escapes HTML** (or ignores it, with `skipHtml`) because it is
  dangerous and defeats the purpose of this library." Raw HTML in the markdown source is rendered
  as escaped text, NOT parsed into DOM — unless you add `rehype-raw`, which we do not.
- "Use of `react-markdown` is secure by default. Overwriting `urlTransform` to something insecure
  will open you up to XSS vectors. Furthermore, the `remarkPlugins`, `rehypePlugins`, and
  `components` you use may be insecure." — the default `urlTransform` sanitizes URLs (allows
  http/https/mailto-style, defangs `javascript:`).

**Plainly**: with only `remark-gfm` (a syntax plugin, adds no raw-HTML pathway) and no `rehype-raw`,
rendering assistant output is safe with zero extra config. `rehype-sanitize` is warranted ONLY if
someone later adds `rehype-raw` or an untrusted rehype plugin — do not add it now (it would strip
nothing on the default tree and adds a dependency).

## 3. Streaming: re-render per chat.delta is fine; memoize settled messages

- react-markdown parses the full string on every render (no incremental parser). For chat-sized
  messages (a few KB) a full remark parse is well under a frame; re-rendering the growing string on
  every `chat.delta` is the standard, acceptable v1 approach.
- **Keep the parse scoped to the ONE in-flight message**: wrap the message-row component in
  `React.memo` (or key the list so settled messages' props are referentially stable). Then each
  delta re-parses only the streaming bubble, not the whole timeline. This is the entire mitigation
  needed at this scale.
- **Mid-stream incomplete markdown gotcha**: an unclosed code fence (` ``` ` arrived, closing fence
  not yet) renders its tail as a paragraph until the closing fence arrives, then snaps into a code
  block; same transient effect for unclosed `**bold**` / tables. This self-corrects on the next
  delta and is cosmetically standard in LLM chat UIs. Simplest mitigation if it ever bothers:
  before rendering the in-flight string, count ` ``` ` occurrences and append a closing ` ``` `
  when odd (render-only, never stored). Do not build incremental parsing for v1.

## 4. Minimal usage snippet

```tsx
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function MessageBody({ text }: { text: string }) {
  return <Markdown remarkPlugins={[remarkGfm]}>{text}</Markdown>;
}
```

- Children is the markdown string (the only required input).
- GFM tables/task-lists/strikethrough/autolinks render out of the box with the plugin.
- Styling: react-markdown emits plain HTML elements (`p`, `pre`, `code`, `table`, ...) — style via
  a scoped Tailwind class on the wrapper (e.g. utility selectors or the `components` prop for
  per-element classNames). Note Tailwind v4 preflight strips default list/heading styles, so the
  chat bubble needs explicit list/heading styles (or the `components` prop) for markdown to look right.

## Sources

- npm registry via `pnpm view react-markdown version|peerDependencies|dist-tags` and
  `pnpm view remark-gfm version` (2026-07-15)
- https://github.com/remarkjs/react-markdown#readme (Features / Security / Use sections)
- https://github.com/remarkjs/react-markdown/releases/tag/10.1.0 (React 19 types fix)
- https://github.com/remarkjs/remark-gfm (remark-parse 11+ requirement)

## Caveats / Not found

- No open question. (If a syntax-highlighted code block is wanted later, `rehype-starry-night` or
  `react-syntax-highlighter` via the `components` prop is the documented path — out of v1 scope.)
