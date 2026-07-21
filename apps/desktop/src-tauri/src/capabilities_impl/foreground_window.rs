//! INPUT:  a gate-authorized foreground-window request (input ignored; the current focused window + session idle)
//! OUTPUT: ForegroundWindowExec: xcap focused window -> ForegroundWindowOutput Value (available/processName/windowTitle/idleSeconds)
//! POS:    shell/capabilities — the foreground-window perception sampler (T3a); reachable ONLY via the gate; read-only, blocking (run off-reactor)

use serde_json::Value;
use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System};
use xcap::Window;

use crate::capabilities_impl::{CapabilityExec, ExecError};
use crate::protocol::ForegroundWindowOutput;

const CAPABILITY: &str = "foreground-window";

/// The Shell-side privacy cap on the sampled title — matches ActivityWatch / BANDORI (140 chars). Bounds both the
/// injection surface Core must A1-fence and the prompt budget; enforced here so the raw title never crosses the WS.
const TITLE_MAX_CHARS: usize = 140;

/// Samples the FOREGROUND window (its owning app name + title) and the session idle time. Stateless per call, like the
/// screenshot/process-list execs. Foreground-first by construction: xcap excludes our own process + the desktop, so
/// system/background processes never appear (owner-ratified foreground-first — no fragile system blocklist).
pub struct ForegroundWindowExec;

impl CapabilityExec for ForegroundWindowExec {
    fn capability(&self) -> &str {
        CAPABILITY
    }

    fn run(&self, _input: &Value) -> Result<Value, ExecError> {
        let output = sample_foreground();
        serde_json::to_value(output).map_err(|error| ExecError::failed(error.to_string()))
    }

    // Dialog-only disclosure (NEVER logged): the approval prompt must state that titles are sampled (prd ruling —
    // titles enter the prompt inside the A1 fence, so the grant has to disclose it).
    fn detail(&self, _input: &Value) -> Option<String> {
        Some("reads the foreground app name and window title, and your idle time".to_string())
    }
}

/// Builds one sample. No focused window (pet/settings window or desktop foreground — xcap filters our own process and
/// Progman) is a clean `available:false` SUCCESS, not an error. idleSeconds is reported whenever computable, even with
/// no focused window (it is session-wide, independent of the foreground window).
fn sample_foreground() -> ForegroundWindowOutput {
    let idle_seconds = idle_seconds();
    let Some(window) = focused_window() else {
        return ForegroundWindowOutput { available: false, process_name: None, window_title: None, idle_seconds };
    };

    // A title decode failure (xcap errors on invalid UTF-16) degrades to an absent title — the process name still stands.
    let window_title = window.title().ok().map(|title| normalize_title(&title));
    let process_name = process_name_for(&window);
    ForegroundWindowOutput { available: true, process_name, window_title, idle_seconds }
}

/// The focused top-level window, or None. `is_focused()` is a live `GetForegroundWindow()==hwnd` check (xcap 0.9.6);
/// an enumeration error degrades to "no focused window", never a crash.
fn focused_window() -> Option<Window> {
    Window::all().ok()?.into_iter().find(|window| window.is_focused().unwrap_or(false))
}

/// The owning app's friendly name (xcap `app_name()` = the exe's FileDescription). It returns "" when OpenProcess is
/// denied (e.g. an elevated target); we then fall back to sysinfo, which names the process from its pid without needing
/// OpenProcess to succeed (rb research). None only if both paths fail.
fn process_name_for(window: &Window) -> Option<String> {
    if let Ok(name) = window.app_name() {
        let trimmed = name.trim();
        if !trimmed.is_empty() {
            return Some(trimmed.to_string());
        }
    }
    let pid = window.pid().ok()?;
    process_name_by_pid(pid)
}

/// sysinfo fallback: refresh ONLY the one pid (the process-list precedent, narrowed). name is always retrieved even
/// with `ProcessRefreshKind::nothing()`.
fn process_name_by_pid(pid: u32) -> Option<String> {
    let pid = Pid::from_u32(pid);
    let mut system = System::new();
    system.refresh_processes_specifics(ProcessesToUpdate::Some(&[pid]), true, ProcessRefreshKind::nothing());
    system.process(pid).map(|process| process.name().to_string_lossy().into_owned())
}

/// Whitespace-normalize (collapse runs + trim) then truncate to TITLE_MAX_CHARS by CHARACTER, never by byte — a CJK
/// or emoji title can never be split mid-codepoint.
fn normalize_title(raw: &str) -> String {
    let normalized = raw.split_whitespace().collect::<Vec<_>>().join(" ");
    normalized.chars().take(TITLE_MAX_CHARS).collect()
}

/// Session idle time in whole seconds via GetLastInputInfo + GetTickCount64 (Win32). None when the call fails or on a
/// non-Windows build — the activity layer reads absence as "idle unknown", never a fabricated value.
#[cfg(windows)]
fn idle_seconds() -> Option<u64> {
    use windows::Win32::System::SystemInformation::GetTickCount64;
    use windows::Win32::UI::Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO};

    let mut info = LASTINPUTINFO { cbSize: std::mem::size_of::<LASTINPUTINFO>() as u32, dwTime: 0 };
    // SAFETY: `info` is a valid, correctly-sized LASTINPUTINFO; the call only writes its dwTime field.
    let ok = unsafe { GetLastInputInfo(&mut info) }.as_bool();
    if !ok {
        return None;
    }
    // dwTime is a 32-bit GetTickCount() sample (wraps ~49 days); take GetTickCount64's low 32 bits so both live in the
    // same wrap domain and `wrapping_sub` yields the correct elapsed ms across a wrap (Microsoft Learn: dwTime is not
    // guaranteed incremental).
    let now = unsafe { GetTickCount64() } as u32;
    let elapsed_ms = now.wrapping_sub(info.dwTime);
    Some(u64::from(elapsed_ms) / 1000)
}

#[cfg(not(windows))]
fn idle_seconds() -> Option<u64> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_title_collapses_whitespace_and_trims() {
        assert_eq!(normalize_title("  main.rs   -   taki \n "), "main.rs - taki");
    }

    #[test]
    fn normalize_title_truncates_to_the_char_cap() {
        let long = "a".repeat(200);
        assert_eq!(normalize_title(&long).chars().count(), TITLE_MAX_CHARS);
    }

    #[test]
    fn normalize_title_truncates_multibyte_on_a_char_boundary() {
        // 200 emoji (4 bytes each): truncation MUST be by char, so the result is exactly 140 valid codepoints and
        // never a panic from splitting a multi-byte sequence.
        let emoji = "😀".repeat(200);
        let out = normalize_title(&emoji);
        assert_eq!(out.chars().count(), TITLE_MAX_CHARS);
        // A CJK case for good measure — still char-counted, still valid UTF-8.
        let cjk = "窗口标题".repeat(50); // 200 chars
        assert_eq!(normalize_title(&cjk).chars().count(), TITLE_MAX_CHARS);
    }

    #[test]
    fn output_round_trips_through_serde_both_arms() {
        for output in [
            ForegroundWindowOutput {
                available: true,
                process_name: Some("Visual Studio Code".into()),
                window_title: Some("main.rs - taki".into()),
                idle_seconds: Some(3),
            },
            ForegroundWindowOutput { available: false, process_name: None, window_title: None, idle_seconds: Some(0) },
        ] {
            let value = serde_json::to_value(&output).expect("serialize");
            let back: ForegroundWindowOutput = serde_json::from_value(value).expect("deserialize");
            assert_eq!(back, output);
        }
    }

    #[test]
    fn a_null_window_field_stays_on_the_wire_as_null() {
        // No skip_serializing_if: available=false keeps processName/windowTitle present as null (the zod fields are
        // required + nullable, so the golden round-trip depends on this).
        let output = ForegroundWindowOutput { available: false, process_name: None, window_title: None, idle_seconds: None };
        let value = serde_json::to_value(&output).expect("serialize");
        assert!(value["processName"].is_null());
        assert!(value["windowTitle"].is_null());
        assert!(value["idleSeconds"].is_null());
    }

    #[test]
    fn run_never_errors_and_shapes_a_valid_output() {
        // Environment-tolerant (rb §5 / process_list style): a headless runner may report no focused window — that is
        // available:false, still a SUCCESS. When a window IS focused, available:true carries at least one signal.
        let value = ForegroundWindowExec.run(&Value::Null).expect("sampling is always a structured success");
        assert!(value["available"].is_boolean());
        if value["available"] == Value::Bool(true) {
            assert!(value.get("processName").is_some() || value.get("windowTitle").is_some());
        }
    }

    #[test]
    fn detail_discloses_that_titles_are_sampled() {
        let detail = ForegroundWindowExec.detail(&Value::Null).expect("a disclosure line");
        assert!(detail.contains("title"));
    }
}
