# Research: Workspace-scoped file read/write (path-escape defense + execution location)

- **Query**: Workspace-confined file RW in Rust; canonical path-escape defense (canonicalize + prefix check, symlinks, `..`, Windows UNC/`\\?\`/case-insensitivity/ADS); WHERE it executes — Shell (Rust) or Core (TS) — given invariant 2
- **Scope**: external (Rust std::fs/path semantics) + internal (invariants 1/2, ADR 0004, screenshot precedent)
- **Date**: 2026-07-11

## Verdicts (read first)

1. **THE BIG ARCHITECTURE QUESTION — workspace-files should execute CORE-SIDE (TypeScript), NOT as a Shell capability.** The evidence is strong and convergent:
   - **Invariant 2**: "The database has one writer: Agent Core. All other processes query/subscribe over WS." Generalized by the screenshot precedent: the Shell captures bytes but **the Core persists them** — `screenshot-store.ts` is "the SANCTIONED Workspace write site… the Shell never writes it" (`screenshot-store.ts:4`, and `screenshot-tool.ts:40` does `deps.store.save(...)`). The Shell returns base64 over the wire; the Core writes the file.
   - **Invariant 8**: `packages/core` must run on Windows AND the Ubuntu VPS. The Workspace lives under the **Core's** data dir (`join(serverConfig.dataDir, "workspace", ...)`, `main.ts` / `server-config.ts:24` → `~/.takiagent/workspace`). In the v1.5 VPS topology the Shell is a *separate machine*; a Shell-side file capability would read/write the *Shell's* filesystem, not the Core's Workspace — semantically wrong.
   - **No gate round-trip needed**: screenshot needs the gate because it touches the OS *screen* (a Shell-only power). File RW confined to the Core's own Workspace directory is not an "agent touches the OS on its initiative" violation (invariant 1) — the Workspace is the Core's *own* sanctioned directory (the memory engine already reads/writes it directly: `createMemoryEngine({ memoryRoot: join(dataDir,"workspace","memory") })`, `main.ts:81`). So workspace-files is a **plain core-side AI SDK tool** that does `fs.readFile`/`fs.writeFile` under the Workspace root, WITHOUT crossing the WS boundary or the Rust gate.
   - **Consequence**: workspace-files does NOT get a `CapabilityExec` in `capabilities_impl/`, does NOT appear in the Shell's declared `capabilities: vec![...]` (`lib.rs:96`), and is NOT gated by the Rust `Gate`. It's a `read-file-tool.ts` / `write-file-tool.ts` under `packages/core/src/capabilities/` (or a new `packages/core/src/workspace/` module) with its OWN confinement check in TS.
   - **This diverges from the issue's framing** ("four typed capabilities on the ALREADY-PROVEN gate path"). Three of the four (process-list, clipboard, shell-open) ARE Shell gate-path capabilities. **workspace-files is the odd one out.** STRONGLY flag for leader — this changes the slice's shape.
2. **The path-escape defense is the security core.** Canonicalize BOTH the Workspace root and the resolved target, then verify the target's canonical path is a prefix of (or equal to) the canonical root — component-wise, not string-wise. Handle the non-existent-file case (canonicalize fails if the path doesn't exist) by canonicalizing the **parent** dir and re-appending the final component. Details below.
3. **Whichever language executes it, the algorithm is the same.** If the leader overrides verdict 1 and makes it Shell-side Rust, the `std::fs::canonicalize` algorithm below applies. If Core-side TS (recommended), use `fs.realpath` + `path.resolve` with the identical logic. I give both.

## Findings

### Where the Workspace lives

- Core-owned: `server-config.ts:24` → `dataDir = ~/.takiagent` (OS-neutral via `homedir()`+`join`). Workspace subtree = `join(dataDir, "workspace")`. `CONTEXT.md:59-60` glossary: Workspace = `%USERPROFILE%\.takiagent\workspace` — the Companion's own directory.
- Existing Core writers into it: memory engine (`memoryRoot: …/workspace/memory`, `main.ts:81`), screenshot store (`…/workspace/screenshots`, `main.ts:144`). Both write directly with `node:fs` — no gate. This is the precedent workspace-files follows.
- The Shell's own data dir is *different and deliberately outside the Workspace*: `lib.rs:77` `app_data_dir()` "Shell-owned, outside the Workspace by construction (D7)". So the Shell has no natural handle on the Workspace path at all — another signal file RW belongs to the Core.

### Path-escape defense — the algorithm (canonical form)

The one correct pattern (works on Windows + Linux):

1. **Canonicalize the Workspace root once** at startup: `let root = fs::canonicalize(workspace_dir)?;` (TS: `await fs.realpath(workspaceDir)`). This resolves symlinks and yields an absolute, normalized base. On Windows this returns an **extended-length `\\?\C:\…` (verbatim) path** — see the Windows caveat.
2. **Resolve the requested path against the root**: join the user-supplied relative path onto `root`, then canonicalize.
   - If the target **exists**: `let real = fs::canonicalize(root.join(user_path))?;`
   - If the target **does not exist yet** (a write creating a new file): `canonicalize` will `Err(NotFound)`. Instead canonicalize the **parent**: `let real_parent = fs::canonicalize(target.parent())?; let real = real_parent.join(target.file_name());` — the parent must exist and be inside the root; the leaf name is validated separately (reject `.`/`..`/separators in the leaf).
3. **Confinement check — component-wise, not string prefix**: `real.starts_with(&root)`. In Rust `Path::starts_with` compares **whole components**, so `/workspace-evil` does NOT `starts_with("/workspace")` (a naive `str::starts_with` WOULD wrongly accept it — do not use string prefix). In TS `Path.startsWith` doesn't exist; use `const rel = path.relative(root, real); rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel))`.
4. **Reject** anything failing the check with a structured error (never a panic; the tool degrades to a model-readable `{ok:false, code:"OUTSIDE_WORKSPACE"}`).

Why canonicalize (not just normalize `..` lexically): `canonicalize`/`realpath` resolves **symlinks**, defeating a symlink planted inside the Workspace that points outside (`workspace/evil -> C:\Windows`). A purely lexical `..`-collapse (Node's `path.resolve`, Rust manual normalization) does NOT follow symlinks and is therefore **insufficient alone** against symlink traversal. (`std::fs::canonicalize` docs: "resolves symbolic links"; on Windows uses `CreateFile`+`GetFinalPathNameByHandle`.)

**Threats and how the algorithm covers them:**
| Threat | Covered by |
|---|---|
| `../../../etc/passwd` / `..\..\Windows` | canonicalize collapses `..`; prefix check rejects the escape |
| Symlink inside Workspace → outside | canonicalize resolves the link to its real target; prefix check rejects |
| Absolute path `C:\Windows\...` supplied directly | join semantics: `root.join("C:\\x")` on Windows — **CAUTION**: `Path::join` with an absolute component REPLACES the base (`root.join("/etc")` == `/etc`). MUST reject absolute inputs *before* joining (check `Path::new(user).is_absolute()` / has a prefix/root → reject). Same in Node: `path.resolve(root, "/etc")` == `/etc`. **This is the single easiest mistake — validate the input is relative first.** |
| `..` mixed with valid segments (`a/../../b`) | canonicalize normalizes fully before the check |
| Non-existent target (create) | canonicalize the parent, re-append leaf, re-check |

### Windows-specific caveats (must handle)

- **`\\?\` verbatim prefix**: `fs::canonicalize` on Windows returns extended-length paths (`\\?\C:\Users\…`). Both root and target come back verbatim, so `starts_with` still matches consistently **as long as you canonicalize both** (never compare a verbatim path against a non-verbatim one). (docs.rs `std::path::Prefix`; `std::fs::canonicalize` note: "converts to extended length path syntax… you can only join backslash-delimited paths to it".) Do not hand-strip the `\\?\` — keep both sides in the same form.
- **Case-insensitivity**: Windows/NTFS is case-insensitive (usually). `canonicalize` returns the on-disk casing, so `WORKSPACE\file` and `workspace\file` both canonicalize to the same real casing → prefix check is consistent. Do NOT do a case-sensitive `str` compare of user input; rely on canonicalize's normalized output. (If you ever compare without canonicalize, you'd need `eq_ignore_ascii_case` — another reason canonicalize is mandatory.)
- **UNC / `\\server\share`**: a UNC input escapes the local Workspace entirely; the absolute-input rejection (has a `Prefix`) blocks it before joining.
- **Drive-relative paths (`C:foo`)**: Windows oddity — `C:foo` means "foo relative to the current dir on C:". `Path::is_absolute` returns **false** for `C:foo` (it has a prefix but no root). Treat "has any `Prefix` OR has root" as "not a safe relative input" → reject. Test this case explicitly.
- **Alternate Data Streams (`file:stream` / `name.txt:hidden`)**: NTFS ADS lets `foo.txt:evil` write a hidden stream. `canonicalize` may or may not normalize the `:stream` suffix. Mitigate by **rejecting any `:` in a path component other than the drive-letter prefix** (a relative user input should contain no `:` at all — reject `:` outright in relative inputs). Cheap and effective.
- **Reserved device names** (`CON`, `NUL`, `PRN`, `AUX`, `COM1..9`, `LPT1..9`): opening these as files hits devices, not the Workspace. `GetFullPathNameW` maps e.g. `C:\path\NUL` to `\\.\NUL`. Reject file names matching the reserved set (case-insensitive, with or without extension). Low severity (they don't escape to arbitrary data) but include the check.
- **Trailing dots/spaces** (`foo.` / `foo `): Windows strips them, so `foo.` and `foo` collide. Canonicalize normalizes; not a confinement escape but can cause surprising overwrites — acceptable for v1.

### Rust std APIs (if Shell-side, the override case)

- `std::fs::canonicalize(&Path) -> io::Result<PathBuf>` — the confinement primitive.
- `Path::starts_with(&self, base) -> bool` — **component-wise** prefix (safe).
- `Path::is_absolute` / `Path::has_root` / `Path::components().next() == Some(Component::Prefix(_))` — detect/reject non-relative inputs.
- `std::fs::read` / `read_to_string` / `write` — the actual IO (blocking, run off-reactor like screenshot).
- Size caps: check `fs::metadata(real)?.len()` before read; cap write input length. (ADR 0002 line 9 caps exec output; apply the same discipline.)

### Node/TS APIs (if Core-side, the RECOMMENDED case)

- `node:fs/promises` `realpath`, `readFile`, `writeFile`, `mkdir`, `stat`.
- `node:path` `resolve`, `relative`, `isAbsolute`, `normalize`, `parse`.
- Confinement: `const real = await fs.realpath(resolvedTarget)` (or realpath the parent for creates); `const rel = path.relative(root, real); if (rel.startsWith("..") || path.isAbsolute(rel)) reject;`.
- Reject absolute/drive/`:`-bearing inputs before resolving (`path.isAbsolute(input)` + manual `:`/prefix check — Node's `path.win32` semantics on Windows).
- Mirrors `screenshot-store.ts`'s direct `node:fs` Workspace writes; place under `packages/core/src/capabilities/` or a new `workspace/` module (invariant 7: own module + registry entry — here the "registry" is `extraTools` in `main.ts:168`).

### Output shapes

**file-read output** (returns content — text-model-friendly):
```jsonc
{ "path": "notes/todo.md", "content": "…file text…", "bytes": 1234, "truncated": false }
```
Return text content directly for the model (respect a size cap → `truncated:true` + first N bytes). Binary files: either base64 (`{encoding:"base64"}`) or refuse non-UTF8 for v1 — flag for leader.

**file-write output** (ack):
```jsonc
{ "ok": true, "path": "notes/todo.md", "bytes": 1234 }
```

Both use relative-to-Workspace paths on the wire (never leak the absolute `~/.takiagent` prefix to the model).

## Related code / specs

- `packages/core/src/capabilities/screenshot-store.ts:4,19-31` — the sanctioned Workspace-write precedent (Core writes, not Shell).
- `packages/core/src/capabilities/screenshot-tool.ts:31-54` — the `execute`-never-throws tool pattern a file tool copies.
- `packages/core/src/main.ts:81,144,168` — Workspace path construction + `extraTools` registry (where new core-side tools plug in).
- `packages/core/src/config/server-config.ts:24` — `dataDir` default (`~/.takiagent`).
- `apps/desktop/src-tauri/src/lib.rs:77` — Shell data dir deliberately OUTSIDE the Workspace (D7).
- `CLAUDE.md` invariants 1 (Core never touches OS), 2 (one DB writer / Core owns Workspace writes), 8 (Core OS-neutral).
- `docs/adr/0004-jsonrpc-ws-protocol-with-pairing.md` — the WS boundary a Shell capability would need but a Core-side tool skips.
- `CONTEXT.md:59-60` — Workspace glossary definition.

## Caveats / Not Found

- Did NOT empirically test canonicalize's `\\?\` output or ADS `:stream` handling on this host (no probe build). The `\\?\` verbatim-return behavior and `starts_with` component semantics are from `std::fs::canonicalize` / `std::path` docs — **write unit tests for the escape cases (`..`, symlink, absolute-input, drive-relative `C:foo`, `:`-ADS) as the security AC**; the issue's AC "paths outside are rejected" must be a table-driven test.
- Whether the leader wants file RW confined to Workspace-root vs a configurable sub-scope is unaddressed (assumed whole Workspace).
- Symlink-following on the *read* side (returning content of a symlink that points inside the Workspace to another inside-file) is allowed by this algorithm; if that's undesired, add an `is_symlink` reject.

## Leader decisions needed

1. **THE architecture call: is workspace-files a CORE-side TS tool (recommended, per invariants 2 & 8 + screenshot precedent) or a Shell-side gated Rust capability (as the issue's "gate path" framing implies)?** This determines whether the slice adds Rust `CapabilityExec`s or TS tools, and whether it's gated by the Rust `Gate` at all. My verdict: **Core-side, ungated-by-Rust-gate** (the Workspace is the Core's own directory; the memory engine already writes it directly). If leader wants uniformity/one gate for all four, that's a deliberate override with a real cost (a Shell-side file capability breaks in the VPS topology).
2. **If Core-side**: does workspace-files still need *any* user approval, or is Workspace-confined RW auto-allowed (like the memory engine's writes)? Recommend: read auto-allowed, write auto-allowed within Workspace (it's the agent's own scratch space) — or a lightweight core-side approval if the leader wants parity. See `capability-tiers.md`.
3. **Binary/non-UTF8 files**: base64-encode, or refuse for v1?
4. **Size caps**: max read bytes returned to the model (truncate?) and max write size.
5. **Confinement scope**: whole Workspace, or a dedicated `workspace/files/` subtree separate from `memory/` and `screenshots/`?
