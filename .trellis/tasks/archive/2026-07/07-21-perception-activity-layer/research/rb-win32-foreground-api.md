# Research: Win32 foreground-window sampling (title + process name) from the Rust Shell

- **Query**: Doc-verified way to sample the FOREGROUND window (title + owning process name) on Windows from the Tauri 2 Rust shell, low-frequency poll (~5-60s), preferring the pinned crates (xcap 0.9, sysinfo 0.39).
- **Scope**: mixed (pinned-crate source verification + Microsoft Learn + prior-art repos)
- **Date**: 2026-07-21
- **Verification method**: every crate claim below was verified against the *vendored pinned source* in the local cargo registry (`~/.cargo/registry/src/*/xcap-0.9.6/`, exact version from `apps/desktop/src-tauri/Cargo.lock`) or docs.rs; every Win32 claim against Microsoft Learn. Unverified ideas are quarantined in §OMITTED.

## 1. Pinned versions and dependency status

| Crate | Pinned (Cargo.toml) | Locked (Cargo.lock) | Evidence |
|---|---|---|---|
| `xcap` | `0.9` (`apps/desktop/src-tauri/Cargo.toml:41`) | `0.9.6` (Cargo.lock:6193-6194) | already used by `screenshot.rs` |
| `sysinfo` | `0.39` (`Cargo.toml:42`) | `0.39.6` (Cargo.lock:4212-4213) | already used by `process_list.rs` |
| `windows` | **not a direct dep** | `0.62.2` transitive via BOTH xcap 0.9.6 and sysinfo 0.39.6 (Cargo.lock:5635-5637, xcap dep block 6193-6221, sysinfo dep block 4212-4224) | adding it directly at `0.62` would compile no new source, but is still a new Cargo.toml entry |

**Conclusion up front: xcap 0.9.6 + sysinfo 0.39.6 fully suffice — zero new dependencies needed.** Verified in detail below.

## 2. xcap 0.9.6 — verified against the vendored pinned source

Public API (docs.rs, https://docs.rs/xcap/latest/xcap/): `Window::all() -> XCapResult<Vec<Window>>` plus per-window accessors `id() / pid() / app_name() / title() / is_focused() / is_minimized() / ...`, each returning `XCapResult<T>`.

Windows implementation, file `xcap-0.9.6/src/windows/impl_window.rs` (local vendored source; line numbers from that file):

- **`Window` is a lazy HWND wrapper** (`ImplWindow::new` stores only the hwnd, L310-312). All accessors are computed at call time — nothing is cached at enumeration.
- **`Window::all()`** (L314-330) = `EnumWindows` + a webrtc-derived `is_valid_window` filter (L64-143): visible, non-cloaked (DWM `is_window_cloaked`), non-`WS_EX_TOOLWINDOW` (taskbar exception), non-empty class name, non-empty rect, skips `Progman` (desktop) and Vista/7 `Button` (Start).
- **`is_focused()`** (L404-405): `GetForegroundWindow() == self.hwnd` — **computed live per call** since PR #191 (merged 2025-02, i.e. in 0.9.x): https://github.com/nashaofu/xcap/pull/191 (motivating issue: https://github.com/nashaofu/xcap/issues/190). So `Window::all()?.into_iter().find(|w| w.is_focused().unwrap_or(false))` is the crate's sanctioned way to get the foreground window; there is no direct "get focused window" constructor (issue #190 option 3 was never implemented).
- **`title()`** (L167-175): `GetWindowTextLengthW` -> exact-size `Vec<u16>` -> `GetWindowTextW` -> `U16CString::from_vec_truncate(..).to_string()?`. NOTE: `to_string()` **errors on invalid UTF-16** (propagated as `XCapError` via `?`) — it is not lossy.
- **`pid()`** (L206-212, L337-340): `GetWindowThreadProcessId(hwnd, Some(&mut pid))`.
- **`app_name()`** (L214-260, L342-344): `OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION)` -> `GetModuleFileNameExW` -> reads the exe's **version-info `FileDescription`** (friendly name, e.g. "Google Chrome"), falling back to `GetModuleBaseNameW` (exe basename). CAVEAT: if `OpenProcess` fails (e.g. elevated target process), it logs and returns **`Ok(String::new())`** — a silent empty string, not an error (L216-222).
- **Two caveats that directly affect us**:
  1. **Current-process windows are excluded** from `Window::all()` (L113-117: `lp_dw_process_id == GetCurrentProcessId() -> return false`), a deliberate deadlock guard — `GetWindowText*` can block when the target hwnd belongs to the calling process (comment cites the Microsoft remarks; see also PR #192 discussion: https://github.com/nashaofu/xcap/pull/192). Consequence: **when TakiAgent's own pet/settings window is foreground, the xcap path finds no focused window.** Must be a handled degradation case ("no foreground sample"), not a crash.
  2. `Progman` (empty desktop focused) is also filtered -> likewise "no focused window found".

## 3. sysinfo 0.39 — cheap process name from a PID

Verified on docs.rs:

- `System::refresh_processes_specifics(ProcessesToUpdate::Some(&[pid]), remove_dead, refresh_kind)` refreshes **only the listed PIDs** — https://docs.rs/sysinfo/latest/sysinfo/struct.System.html and https://docs.rs/sysinfo/latest/sysinfo/enum.ProcessesToUpdate.html (example shows refreshing exactly one pid).
- Even with `ProcessRefreshKind::nothing()`, a refreshed `Process` still carries **Pid, parent pid, name, start time** ("When all refresh are ruled out, a Process will still retrieve the following information: Process ID (Pid), Parent process ID, Process name, Start time") — https://docs.rs/sysinfo/latest/x86_64-pc-windows-msvc/sysinfo/struct.ProcessRefreshKind.html
- This is exactly the pattern `process_list.rs:23-25` already uses (`System::new()` + `refresh_processes_specifics(..., ProcessRefreshKind::nothing().with_memory())`), just narrowed to `Some(&[pid])`.
- Value as fallback: sysinfo does not depend on `OpenProcess` succeeding from our (non-elevated) process the way xcap's `app_name()` does, so it can name elevated processes where `app_name()` degrades to `""`. (ActivityWatch hit the same elevated-process failure with the OpenProcess route and added a WMI fallback — commit https://github.com/ActivityWatch/aw-watcher-window/commit/2d878c5 "added back wmi method on Windows as fallback for admin processes".)

## 4. Raw Win32 path (documented for reference; NOT needed for v1)

All verified on Microsoft Learn:

1. `GetForegroundWindow() -> HWND` — "The foreground window **can be NULL** in certain circumstances, such as when a window is losing activation." Any sampler must handle NULL as a normal transient, not an error. https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getforegroundwindow
2. `GetWindowThreadProcessId(hwnd, [out] lpdwProcessId) -> DWORD(thread id)` — pid comes out via the pointer; the **return value is the THREAD id**, a classic mixup (also flagged in https://stackoverflow.com/questions/64031366/how-to-get-the-process-name-based-on-hwnd-in-c). Returns 0 for an invalid hwnd. https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getwindowthreadprocessid
3. `OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid)` — https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-openprocess — then `QueryFullProcessImageNameW(hProcess, 0, buf, &mut size)`; the handle "must be created with the PROCESS_QUERY_INFORMATION or **PROCESS_QUERY_LIMITED_INFORMATION** access right". https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-queryfullprocessimagenamew (Alternative: skip OpenProcess entirely and resolve the pid via sysinfo, §3.)
4. `GetWindowTextW(hwnd, buf, nMaxCount)` — see §5.
5. Crate wiring: `windows` 0.62.2 is already transitive (§1), so a direct raw path would add `windows = { version = "0.62", features = ["Win32_UI_WindowsAndMessaging", "Win32_System_Threading"] }`-style entry. §OMITTED for the exact feature names — not verified against the windows-rs 0.62 feature list because v1 does not need this path.

## 5. Window-title caveats

- **Truncation is safe and built-in**: `GetWindowTextW`'s `nMaxCount` is "the maximum number of characters to copy to the buffer, **including the null character**. If the text exceeds this limit, it is truncated" and the copied string is null-terminated. There is no documented hard OS cap on title length, so the sampler should impose its own cap. https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getwindowtextw
- **Cross-process calls cannot hang**: "If the target window is owned by another process and has a caption, GetWindowText retrieves the window caption text ... It allows applications to call GetWindowText **without becoming unresponsive** if the process that owns the target window is not responding." (same page Remarks; background: Raymond Chen, "The secret life of GetWindowText", https://devblogs.microsoft.com/oldnewthing/20030821-00/?p=42833 — cross-process reads come from a cached "special place", no message is sent). The hang risk exists only for own-process windows — which xcap already excludes (§2).
- **Exact-size allocation**: `GetWindowTextLengthW` "may return a value that is larger than the actual length ... will always be at least as large as the actual length; you can thus always use it to guide buffer allocation." https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getwindowtextlengthw (xcap does length+1, §2).
- **Encoding**: titles are UTF-16; xcap's `to_string()` errors on invalid UTF-16 (§2). A raw path should use `String::from_utf16_lossy` (Rust std, https://doc.rust-lang.org/std/string/struct.String.html#method.from_utf16_lossy) to degrade instead of failing. With xcap, treat a title error as a degraded sample (process name still usable, title = error note).
- **Privacy**: titles routinely embed document paths, URLs, mail subjects (this is the whole reason A1 fences them). ActivityWatch's watcher returns raw `GetWindowText` output too (https://github.com/ActivityWatch/aw-watcher-window/blob/master/aw_watcher_window/windows.py) — scrubbing is T3b scope; the T3a fence + a length cap at the protocol boundary is the v1 posture.

## 6. The UWP / ApplicationFrameHost gotcha

- For UWP/Store apps, the foreground top-level window belongs to **`ApplicationFrameHost.exe`**; `GetWindowThreadProcessId` + image-name on it returns the host, not the app. Documented across: https://stackoverflow.com/questions/32360149/name-of-process-for-active-window-in-windows-8-10 (Hans Passant: the real app owns a **`Windows.UI.Core.CoreWindow`** child window), https://stackoverflow.com/questions/39702704/connecting-uwp-apps-hosted-by-applicationframehost-to-their-real-processes, and Microsoft PowerToys issue https://github.com/microsoft/PowerToys/issues/1766.
- Known workarounds (all with caveats):
  1. `EnumChildWindows(foreground_hwnd)` and take the child whose pid differs from the host's / whose class is `Windows.UI.Core.CoreWindow` (SO 32360149, 39702704). Fails for full-screen UWP apps (PowerToys #1766 notes this) and the CoreWindow child disappears when the app is suspended (https://stackoverflow.com/questions/67762440/how-do-i-get-the-pid-of-a-uwp-hosted-app).
  2. `GetGUIThreadInfo(0, &gti)` then `GetWindowThreadProcessId(gti.hwndFocus)` — recommended as "the better workaround with some documentation" in PowerToys #1766 (links https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getguithreadinfo).
- **Prior art stance**: ActivityWatch has had "UWP apps shown as ApplicationFrameHost.exe on Windows" open as issue #31 **since 2018** without shipping an unwrap (https://github.com/ActivityWatch/aw-watcher-window/issues/31) — i.e. a mature shipped tracker just reports the host process. Mitigating fact: the frame window's **title still carries the real app name** (e.g. Spy++ dumps in SO 67762440 show host pid + title "Rechner"/Calculator), so the activity layer loses little signal.
- **Assessment for v1**: report what the API gives (`ApplicationFrameHost.exe` + real title); defer the unwrap. If adopted, log the deferral in `docs/deferred-decisions.md` with trigger "UWP apps become a meaningful share of observed foreground samples / exe→category mapping lands".

## 7. Polling vs event-driven (SetWinEventHook)

- **Poll cost**: one `EnumWindows` pass + a handful of per-hwnd user32 queries + one live `GetForegroundWindow` comparison per accessor, then title/pid/app-name for a single window. All non-blocking for cross-process targets (§5). ActivityWatch's shipped watcher is a **pure GetForegroundWindow poll** (its self-test loop runs at 1.0s: https://github.com/ActivityWatch/aw-watcher-window/blob/master/aw_watcher_window/windows.py) — at our 5-60s cadence the cost is strictly lower than what a mainstream tracker runs continuously at 1s. No quantitative benchmark claimed (§OMITTED).
- **Event-driven alternative**: `SetWinEventHook(EVENT_SYSTEM_FOREGROUND, ..., WINEVENT_OUTOFCONTEXT)`. Verified constraints: "The client thread that calls SetWinEventHook **must have a message loop** in order to receive events" and out-of-context events "deliver on the same thread that called SetWinEventHook" (https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setwineventhook); `EVENT_SYSTEM_FOREGROUND` = 0x0003, hwnd param is the new foreground window (https://learn.microsoft.com/en-us/windows/win32/winauto/event-constants). That means a dedicated Win32 thread pumping `GetMessage/DispatchMessage` (see https://stackoverflow.com/questions/69330261/how-to-define-the-message-loop-when-using-setwineventhook) plus a channel into the tokio side — push-shaped, stateful, and thread-lifecycle-bearing.
- **Recommendation: poll.** Our architecture is pull-style by design (PRD assumption: Core asks over WS, Shell answers; capability handlers are stateless `CapabilityExec::run` calls — `process_list.rs:17-41`). A hook would invert that (Shell-push), add a message-pump thread for zero functional gain at a 5-60s cadence, and its events would still need debouncing into samples Core-side. Event-driven only becomes interesting if T4 ever needs sub-second reaction to focus changes (§OMITTED — no evidence it does).

## 8. Existing handler patterns to reuse (file:line)

| File | Pattern to copy |
|---|---|
| `apps/desktop/src-tauri/src/capabilities_impl/process_list.rs:15-41` | stateless `CapabilityExec` impl; `System::new()` per call; `refresh_processes_specifics(..., ProcessRefreshKind::nothing()...)`; output via `serde_json::to_value` of a protocol struct; `ExecError::failed(...)` degradation |
| `apps/desktop/src-tauri/src/capabilities_impl/screenshot.rs:17-54` | xcap usage precedent (`Monitor::all()` + graceful `primary_monitor()` fallback chain, `ok_or_else` structured error); POS header marks it "blocking (run off-reactor)" — the foreground sampler is likewise a blocking Win32 call sequence |
| `apps/desktop/src-tauri/src/capabilities_impl/process_list.rs:14` (doc comment) | "cmd/argv deliberately NOT requested (leaks URLs/tokens)" — same minimal-fields discipline applies: emit process name + title only, not full exe path |
| `apps/desktop/src-tauri/src/capabilities_impl/index.md` | one-line registry of handlers — new sampler gets a row |
| `apps/desktop/src-tauri/src/gate/governance.rs` (`factory()`) | governance descriptor registry the new capability must join (per PRD; not re-verified here) |

## §Recommendation — concrete v1 design (every element cited)

**Crate choice: xcap 0.9.6 (+ sysinfo 0.39.6 fallback), zero new dependencies.**

1. **API sequence** (new `ForegroundWindowExec`, mirroring `ProcessListExec` shape, `process_list.rs:15-41`):
   - `xcap::Window::all()` -> `.find(|w| w.is_focused().unwrap_or(false))` — is_focused is a live `GetForegroundWindow()==hwnd` comparison in the pinned source (impl_window.rs L404-405; PR #191).
   - On the found window: `title()` (impl_window.rs L167-175), `pid()` (L206-212), `app_name()` (L214-260).
   - If `app_name()` returns `Ok("")` (the verified silent-failure path for e.g. elevated processes, L216-222): fall back to `sysinfo` `System::new()` + `refresh_processes_specifics(ProcessesToUpdate::Some(&[Pid::from_u32(pid)]), true, ProcessRefreshKind::nothing())` + `process.name()` — name is always retrieved per ProcessRefreshKind docs (§3), same call shape as `process_list.rs:23-25`.
2. **Error/degradation shape** (structured, never a crash — `ExecError::failed` convention, `process_list.rs:40`):
   - *No focused window found* (own pet window foreground — current-process exclusion impl_window.rs L113-117; desktop/Progman filtered L120-122; or `GetForegroundWindow` NULL during a focus transition per Microsoft Learn §4.1): return a **valid "no-sample" result** (e.g. `{"available": false, "reason": "no-foreground-window"}`), not an error — this is a normal state at poll time.
   - *Title decode error* (invalid UTF-16 -> `XCapError`, §2): degrade to empty/absent title, keep process name.
   - *Everything else* -> `ExecError::failed(msg)`.
3. **UWP stance**: v1 reports `ApplicationFrameHost.exe` + the frame title (which carries the real app name, §6); the CoreWindow/GetGUIThreadInfo unwrap is explicitly deferred (matches ActivityWatch's shipped behavior, issue #31 open since 2018) — log in `docs/deferred-decisions.md`.
4. **Buffer/encoding**: xcap already does exact-size `GetWindowTextLengthW`+1 allocation and safe truncation semantics per Microsoft Learn (§5); add our own **policy cap** (e.g. 256-512 chars) on the title at the protocol boundary before it crosses WS — a privacy/prompt-budget choice, not an OS requirement (no documented OS max, §5).
5. **Threading**: blocking Win32 sequence — run off-reactor exactly like `screenshot.rs` (its POS header, L3). Cross-process `GetWindowTextW` cannot hang (§5), so no timeout machinery is warranted.
6. **Polling**: pull-style poll over WS at Core's cadence (5-60s), no `SetWinEventHook` (§7 — hook requires a dedicated message-pump thread per Microsoft Learn, and push inverts our Core-asks architecture).

## §OMITTED (unverified — do not code from these)

- Exact `windows`-crate 0.62 cargo feature names for the raw path (`Win32_UI_WindowsAndMessaging` etc.) — not checked against the windows-rs 0.62 feature list since v1 needs no direct dep.
- Quantitative cost numbers for EnumWindows/GetForegroundWindow (microseconds-level claims) — no authoritative benchmark found; only the qualitative "mainstream trackers poll this at 1s" evidence (§7).
- aw-watcher-window's *configured default* poll interval (only its self-test loop's 1.0s sleep was verified in source).
- Whether OpenClaw/Hermes implement foreground sampling at all (cadence question in PRD Open Questions) — not investigated in this topic; separate research if needed.
- `GetGUIThreadInfo(0)` full semantics — cited secondhand via PowerToys #1766; read the Microsoft Learn page before ever implementing the UWP unwrap.
