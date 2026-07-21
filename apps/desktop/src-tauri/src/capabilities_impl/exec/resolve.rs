//! INPUT:  argv[0] + the child cwd + a SearchConfig (PATH dirs + PATHEXT); the wrapper reads the real env
//! OUTPUT: resolve_program (pure, cwd-excluded), resolve_on_path (env wrapper), env_search_config, is_path_qualified
//! POS:    shell/capabilities/exec — the D3 argv[0] resolver (research §4); a cwd-local same-named exe never wins

use std::path::{Path, PathBuf};

/// The cwd-excluded search config: PATH directories + the PATHEXT completions tried for a bare name. Injectable
/// so the classifier's auto-run tests never mutate process env (research §4 "injectable dirs").
#[derive(Debug, Clone, Default)]
pub struct SearchConfig {
    pub dirs: Vec<PathBuf>,
    pub pathext: Vec<String>,
}

/// True iff argv[0] carries a path separator — a path-qualified target (absolute or relative), matched as a
/// concrete path rather than resolved by bare name against PATH. Grounding: bare allowlist names match ONLY via
/// PATH, never `./rg` or `/tmp/rg` [OC-EA]; a path glob trusts one specific location.
pub fn is_path_qualified(program: &str) -> bool {
    program.contains('\\') || program.contains('/')
}

/// Resolves `program` to an absolute path with the child cwd and `.` EXCLUDED, so a cwd-local same-named binary
/// can never satisfy a bare-name allowlist match (D3; [OC-EA]). Rust's `std::process::Command` already omits the
/// current directory from its own Windows search (CVE-2021-3013 / rust-lang/rust#87704), but (a) a RELATIVE
/// argv[0] is "platform specific and unstable" per the std docs and can still resolve against a cwd, and (b) the
/// raw Win32 CreateProcess search order is app-dir → current-dir → system → PATH (MS Learn) — so spawning the
/// resolved ABSOLUTE path is what makes the executed binary provably the allowlist-matched one, independent of
/// either search order.
/// - path-qualified + absolute -> the concrete target if it exists (PATHEXT-completed when extensionless);
/// - path-qualified + relative -> None (it points into cwd -> never auto-runnable by a bare-name match);
/// - bare name -> the first existing hit while walking `config.dirs` (cwd / `.` skipped), PATHEXT-completed.
pub fn resolve_program(program: &str, cwd: &Path, config: &SearchConfig) -> Option<PathBuf> {
    if is_path_qualified(program) {
        let candidate = Path::new(program);
        // A relative path-qualified argv[0] points into the cwd -> never auto-runnable by a bare-name match.
        return if candidate.is_absolute() { resolve_concrete(candidate, &config.pathext) } else { None };
    }
    config
        .dirs
        .iter()
        .filter(|dir| !is_cwd_or_dot(dir, cwd))
        .find_map(|dir| resolve_concrete(&dir.join(program), &config.pathext))
}

/// The env-backed wrapper (spawn side): resolves a bare name against the real PATH/PATHEXT with cwd excluded.
pub fn resolve_on_path(program: &str, cwd: &Path) -> Option<PathBuf> {
    resolve_program(program, cwd, &env_search_config())
}

/// Reads PATH (split OS-correctly) and PATHEXT (falling back to the Windows default set when absent) — the search
/// config the classifier (via ExecPolicy) and the spawn path both resolve against.
pub fn env_search_config() -> SearchConfig {
    let dirs = std::env::var_os("PATH")
        .map(|paths| std::env::split_paths(&paths).collect())
        .unwrap_or_default();
    let pathext = std::env::var("PATHEXT")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .map(|value| parse_pathext(&value))
        .unwrap_or_else(default_pathext);
    SearchConfig { dirs, pathext }
}

fn parse_pathext(value: &str) -> Vec<String> {
    value.split(';').map(str::trim).filter(|ext| !ext.is_empty()).map(str::to_string).collect()
}

fn default_pathext() -> Vec<String> {
    [".COM", ".EXE", ".BAT", ".CMD"].iter().map(|ext| (*ext).to_string()).collect()
}

// Skips the child cwd and a literal `.` so a cwd-local binary is never a bare-name match. Canonicalizes both
// sides for a robust same-directory test; on a canonicalize failure it falls back to a literal compare, so only
// an EXACT match is ever skipped (a real system dir is never dropped by accident).
fn is_cwd_or_dot(dir: &Path, cwd: &Path) -> bool {
    if dir == Path::new(".") {
        return true;
    }
    match (dir.canonicalize(), cwd.canonicalize()) {
        (Ok(resolved_dir), Ok(resolved_cwd)) => resolved_dir == resolved_cwd,
        _ => dir == cwd,
    }
}

// A concrete candidate: an explicit extension is used as-is; an extensionless candidate is completed with each
// PATHEXT in turn (Windows appends these to a bare name), then tried bare (a non-Windows executable has no ext).
fn resolve_concrete(candidate: &Path, pathext: &[String]) -> Option<PathBuf> {
    if candidate.extension().is_some() {
        return existing_file(candidate);
    }
    for ext in pathext {
        if let Some(hit) = existing_file(&with_appended_ext(candidate, ext)) {
            return Some(hit);
        }
    }
    existing_file(candidate)
}

fn with_appended_ext(candidate: &Path, ext: &str) -> PathBuf {
    let mut raw = candidate.as_os_str().to_os_string();
    raw.push(ext);
    PathBuf::from(raw)
}

// Returns the candidate as an ABSOLUTE path iff it is an existing file. Already-absolute candidates (the common
// case: PATH dirs are absolute) are returned verbatim; a relative one is canonicalized so the eventual spawn
// target is unambiguous and skips any cwd-relative resolution.
fn existing_file(candidate: &Path) -> Option<PathBuf> {
    if !candidate.is_file() {
        return None;
    }
    if candidate.is_absolute() {
        Some(candidate.to_path_buf())
    } else {
        candidate.canonicalize().ok()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn plant(dir: &Path, name: &str) -> PathBuf {
        let path = dir.join(name);
        fs::write(&path, b"").expect("plant fake binary");
        path
    }

    fn exe_config(dirs: Vec<PathBuf>) -> SearchConfig {
        // Lowercase `.exe` matches the planted files on a case-sensitive fs too (cross-platform test hygiene).
        SearchConfig { dirs, pathext: vec![".exe".to_string()] }
    }

    #[test]
    fn a_bare_name_resolves_on_the_path_never_the_cwd_copy() {
        // D3 core (RED-proof): with `fakebin.exe` planted in BOTH the cwd and a PATH dir — and the cwd listed
        // FIRST, as the raw Win32 order would search it — the resolver must return the PATH copy. A resolver that
        // did not exclude cwd would return the cwd copy (this is red under that flip).
        let cwd = tempfile::tempdir().unwrap();
        let path_dir = tempfile::tempdir().unwrap();
        plant(cwd.path(), "fakebin.exe");
        let path_copy = plant(path_dir.path(), "fakebin.exe");

        let config = exe_config(vec![cwd.path().to_path_buf(), path_dir.path().to_path_buf()]);
        let resolved = resolve_program("fakebin", cwd.path(), &config);
        assert_eq!(resolved.as_deref(), Some(path_copy.as_path()), "the PATH copy, never the cwd one");
    }

    #[test]
    fn a_bare_name_present_only_in_the_cwd_does_not_resolve() {
        // The auto-run gate: a binary that exists ONLY in the cwd (not on the trusted PATH) fails to resolve, so
        // the classifier escalates instead of auto-running it.
        let cwd = tempfile::tempdir().unwrap();
        let empty_path_dir = tempfile::tempdir().unwrap();
        plant(cwd.path(), "fakebin.exe");
        let config = exe_config(vec![empty_path_dir.path().to_path_buf()]);
        assert_eq!(resolve_program("fakebin", cwd.path(), &config), None);
    }

    #[test]
    fn a_relative_argv0_is_never_resolved_by_bare_name() {
        // The live residual hijack: a RELATIVE argv[0] whose basename matches the allowlist. It points into the
        // cwd and is "platform specific and unstable" to spawn (std docs) — so it never resolves for auto-run.
        let cwd = tempfile::tempdir().unwrap();
        let path_dir = tempfile::tempdir().unwrap();
        plant(cwd.path(), "fakebin.exe");
        plant(path_dir.path(), "fakebin.exe");
        let config = exe_config(vec![path_dir.path().to_path_buf()]);
        assert_eq!(resolve_program("./fakebin", cwd.path(), &config), None);
        assert_eq!(resolve_program("sub\\fakebin", cwd.path(), &config), None);
    }

    #[test]
    fn an_extensionless_bare_name_is_completed_via_pathext() {
        let path_dir = tempfile::tempdir().unwrap();
        let cwd = tempfile::tempdir().unwrap();
        let planted = plant(path_dir.path(), "tool.exe");
        let config = exe_config(vec![path_dir.path().to_path_buf()]);
        // Extensionless `tool` completes to `tool.exe`; an explicit `tool.exe` matches the same file.
        assert_eq!(resolve_program("tool", cwd.path(), &config).as_deref(), Some(planted.as_path()));
        assert_eq!(resolve_program("tool.exe", cwd.path(), &config).as_deref(), Some(planted.as_path()));
    }

    #[test]
    fn an_absolute_path_qualified_target_resolves_to_itself_when_it_exists() {
        let dir = tempfile::tempdir().unwrap();
        let cwd = tempfile::tempdir().unwrap();
        let planted = plant(dir.path(), "tool.exe");
        let config = exe_config(vec![]);
        assert_eq!(
            resolve_program(planted.to_str().unwrap(), cwd.path(), &config).as_deref(),
            Some(planted.as_path()),
        );
    }

    #[test]
    fn a_missing_bare_name_fails_closed_to_none() {
        let cwd = tempfile::tempdir().unwrap();
        let path_dir = tempfile::tempdir().unwrap();
        let config = exe_config(vec![path_dir.path().to_path_buf()]);
        assert_eq!(resolve_program("does-not-exist", cwd.path(), &config), None);
    }

    #[test]
    fn path_qualification_detects_both_separators() {
        assert!(is_path_qualified("./git"));
        assert!(is_path_qualified("sub\\git"));
        assert!(is_path_qualified("C:\\x\\git.exe"));
        assert!(!is_path_qualified("git"));
        assert!(!is_path_qualified("git.exe"));
    }

    #[test]
    fn pathext_parsing_trims_and_drops_empties() {
        assert_eq!(parse_pathext(".COM; .EXE ;;.BAT"), vec![".COM", ".EXE", ".BAT"]);
    }
}
