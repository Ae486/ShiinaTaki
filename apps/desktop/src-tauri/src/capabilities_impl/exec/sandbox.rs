//! INPUT:  an approved/auto-run command string + a Sandbox (cwd, timeout, output cap)
//! OUTPUT: run(command, sandbox) -> ExecOutput { exitCode, stdout, stderr, truncated, timedOut, durationMs }
//! POS:    shell/capabilities/exec — the spawn half (ruling 12-15): D3 resolved-absolute-path spawn, NO shell, scrubbed env, hand-rolled timeout/caps

use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};

use crate::capabilities_impl::ExecError;
use crate::protocol::ExecOutput;

use super::parser::{analyze, Structure};
use super::policy::Sandbox;
use super::resolve;

// How often the timeout loop wakes to check the child / cap flag. A 50 ms poll against a 30 s deadline is ample and
// keeps us zero-dep (no wait-timeout crate) — consistent with #10's hand-rolled base64/uuid stance (ruling 14).
const POLL_INTERVAL: Duration = Duration::from_millis(50);

// The Windows-safe env allowlist (ruling 13): start from EMPTY, copy in only these. Everything else is dropped —
// notably every API-key-shaped var. PATH is set so `std::process::Command` resolves argv[0] against OUR curated PATH.
const SAFE_ENV_KEYS: &[&str] = &[
    "PATH",
    "SystemRoot",
    "SystemDrive",
    "windir",
    "PROCESSOR_ARCHITECTURE",
    "PROCESSOR_IDENTIFIER",
    "NUMBER_OF_PROCESSORS",
    "COMSPEC",
    "TEMP",
    "TMP",
    "USERPROFILE",
    "HOMEDRIVE",
    "HOMEPATH",
    "APPDATA",
    "LOCALAPPDATA",
    "USERNAME",
    "COMPUTERNAME",
    "PATHEXT",
    "OS",
];

/// Spawns and confines a command. The command is re-parsed here (single source of truth): only a Simple command yields
/// argv to spawn — an approved compound/shell command has no shell to run it, so it fails structurally, never silently.
pub fn run(command: &str, sandbox: &Sandbox) -> Result<ExecOutput, ExecError> {
    let argv = match analyze(command) {
        Structure::Simple(cmd) => cmd.argv,
        // No shell exists to interpret operators/redirection (ruling 12); approval does not grant one.
        Structure::Complex => {
            return Err(ExecError::failed(
                "compound or shell commands cannot run without a shell; approve a single command",
            ));
        }
    };
    let mut child = spawn(&argv, sandbox)?;
    Ok(collect(&mut child, sandbox))
}

fn spawn(argv: &[String], sandbox: &Sandbox) -> Result<Child, ExecError> {
    let program = resolve_spawn_target(&argv[0], &sandbox.cwd)?;
    let mut command = Command::new(&program);
    command
        .args(&argv[1..])
        .current_dir(&sandbox.cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    // Allowlist-from-empty: drop the inherited environment, then copy only the safe keys (ruling 13).
    command.env_clear();
    for key in SAFE_ENV_KEYS {
        if let Some(value) = std::env::var_os(key) {
            command.env(key, value);
        }
    }
    command.spawn().map_err(|error| ExecError::failed(format!("spawn failed: {error}")))
}

// D3: build the child from an ABSOLUTE path so neither CreateProcess nor Rust's own resolver can fall back to the
// child cwd for a bare name (research §4). A bare name resolves on the cwd-EXCLUDED PATH — a structured error,
// never a panic, if it is not there. A path-qualified argv[0] runs verbatim: an absolute one as-is (it skips the
// cwd search), a user-approved relative one joined onto the child cwd so it is unambiguous (the std docs call
// relative-program resolution "platform specific and unstable"; classification already forces such a command
// through approval). This re-resolves rather than threading a PathBuf across the gate boundary — the narrow
// classify->spawn TOCTOU is accepted for Windows v1 with no sandbox (research §Caveats).
fn resolve_spawn_target(program: &str, cwd: &Path) -> Result<PathBuf, ExecError> {
    if resolve::is_path_qualified(program) {
        let candidate = Path::new(program);
        return Ok(if candidate.is_absolute() { candidate.to_path_buf() } else { cwd.join(program) });
    }
    resolve::resolve_on_path(program, cwd)
        .ok_or_else(|| ExecError::failed(format!("cannot locate `{program}` on the trusted PATH (cwd excluded)")))
}

// Drives the child to completion: two capped reader threads (a single-thread dual read can deadlock) + a poll loop
// enforcing the deadline and the cap-kill. On deadline or over-cap the child is killed (direct child only, ruling 14).
fn collect(child: &mut Child, sandbox: &Sandbox) -> ExecOutput {
    let start = Instant::now();
    let cap_hit = Arc::new(AtomicBool::new(false));

    let stdout = child.stdout.take().expect("stdout piped");
    let stderr = child.stderr.take().expect("stderr piped");
    let out_reader = spawn_capped_reader(stdout, sandbox.output_cap, cap_hit.clone());
    let err_reader = spawn_capped_reader(stderr, sandbox.output_cap, cap_hit.clone());

    let mut timed_out = false;
    let exit_status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break Some(status),
            Ok(None) => {
                if cap_hit.load(Ordering::Relaxed) || start.elapsed() >= sandbox.timeout {
                    timed_out = start.elapsed() >= sandbox.timeout;
                    let _ = child.kill();
                    let _ = child.wait();
                    break None;
                }
                thread::sleep(POLL_INTERVAL);
            }
            // A wait error means we lost track of the child; kill defensively and report as killed.
            Err(_) => {
                let _ = child.kill();
                break None;
            }
        }
    };

    let (stdout_bytes, out_truncated) = out_reader.join().unwrap_or_default();
    let (stderr_bytes, err_truncated) = err_reader.join().unwrap_or_default();
    let truncated = out_truncated || err_truncated;
    // exitCode is null whenever we killed the child (timeout or cap); otherwise the real code (ruling 15).
    let exit_code = if timed_out || truncated { None } else { exit_status.and_then(|status| status.code()) };

    ExecOutput {
        exit_code,
        // Console output may be non-UTF-8 (codepage); the model reads text, we do not round-trip it (ruling 15).
        stdout: String::from_utf8_lossy(&stdout_bytes).into_owned(),
        stderr: String::from_utf8_lossy(&stderr_bytes).into_owned(),
        truncated,
        timed_out,
        duration_ms: start.elapsed().as_millis() as u64,
    }
}

// Reads a stream up to `cap` bytes; on overflow it stops, flags the shared cap-hit (so the poll loop kills the child),
// and returns what it has. Runs on its own thread so stdout and stderr cannot deadlock each other.
fn spawn_capped_reader(
    mut stream: impl Read + Send + 'static,
    cap: usize,
    cap_hit: Arc<AtomicBool>,
) -> thread::JoinHandle<(Vec<u8>, bool)> {
    thread::spawn(move || {
        let mut collected: Vec<u8> = Vec::new();
        let mut chunk = [0u8; 8192];
        loop {
            match stream.read(&mut chunk) {
                Ok(0) => break,
                Ok(read) => {
                    let remaining = cap.saturating_sub(collected.len());
                    if read > remaining {
                        collected.extend_from_slice(&chunk[..remaining]);
                        cap_hit.store(true, Ordering::Relaxed);
                        return (collected, true);
                    }
                    collected.extend_from_slice(&chunk[..read]);
                }
                Err(_) => break,
            }
        }
        (collected, false)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const DEFAULT_SHORT: Duration = Duration::from_secs(5);

    fn sandbox(timeout: Duration, cap: usize) -> Sandbox {
        // The Shell's own working dir exists on every host; a real cwd keeps spawn from failing on a bad path.
        Sandbox { cwd: std::env::temp_dir(), timeout, output_cap: cap }
    }

    #[test]
    fn a_compound_command_fails_structurally_without_a_shell() {
        let result = run("a && b", &Sandbox { cwd: PathBuf::from("."), timeout: DEFAULT_SHORT, output_cap: 1024 });
        assert!(result.is_err(), "no shell exists to run a chained command");
    }

    // The real-spawn tests need a genuine Windows process; they are Windows-only and use short deadlines/caps so they
    // stay fast and deterministic (a manual-check line documents the equivalent by-hand verification).
    #[cfg(windows)]
    #[test]
    fn a_fast_program_runs_and_reports_exit_zero() {
        let out = run("hostname", &sandbox(DEFAULT_SHORT, 1024 * 1024)).expect("hostname runs");
        assert_eq!(out.exit_code, Some(0));
        assert!(!out.timed_out);
        assert!(!out.truncated);
        assert!(!out.stdout.trim().is_empty(), "hostname prints the machine name");
    }

    #[cfg(windows)]
    #[test]
    fn a_sleeper_hits_the_timeout_and_is_killed() {
        // `ping -n 30 127.0.0.1` runs ~29s; a 300ms deadline forces the kill path well before it would exit.
        let out = run("ping -n 30 127.0.0.1", &sandbox(Duration::from_millis(300), 1024 * 1024))
            .expect("ping spawns");
        assert!(out.timed_out, "the deadline must fire");
        assert_eq!(out.exit_code, None, "a killed child has no exit code");
    }

    #[cfg(windows)]
    #[test]
    fn an_over_producing_command_truncates_and_is_killed() {
        // A 4-byte cap against hostname's output forces the overflow branch deterministically.
        let out = run("hostname", &sandbox(DEFAULT_SHORT, 4)).expect("hostname runs");
        assert!(out.truncated, "output exceeded the cap");
        assert!(out.stdout.len() <= 4);
    }
}
