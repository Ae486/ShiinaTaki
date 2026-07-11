//! INPUT:  a raw exec command string (bare, as the agent emitted it — parsing lives here, not in the Core)
//! OUTPUT: analyze(raw) -> Structure { Complex | Simple{argv, program, extension} }; a pure, policy-free tokenizer
//! POS:    shell/capabilities/exec — the structural half of the three-way sieve (ruling 1-5); no side effects, table-tested

/// A single tokenized command, with argv[0] normalized for allowlist matching.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SimpleCommand {
    /// The verbatim tokens to spawn: `Command::new(argv[0]).args(argv[1..])` (no shell, ruling 12).
    pub argv: Vec<String>,
    /// argv[0] normalized: basename, extension stripped, lowercased — the allowlist match key (ruling 3).
    pub program: String,
    /// argv[0]'s lowercased extension, if any (e.g. "exe"/"bat"/"cmd") — the allowlist is `.exe`-only (ruling 3).
    pub extension: Option<String>,
}

/// The structural class of a raw command, independent of the allow/blocklist (policy adds those, `policy.rs`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Structure {
    /// An unquoted shell operator/metachar, a quote imbalance, or an empty command → never auto-run (fail-closed).
    Complex,
    /// A clean single command that tokenized without any shell syntax.
    Simple(SimpleCommand),
}

// The cmd.exe / POSIX metacharacter set. Their unquoted PRESENCE means the string is only meaningful to a shell we
// deliberately refuse (ruling 2/5) — chaining/pipe/redirection/subshell/expansion/glob. We never emulate them.
const METACHARS: &[char] = &[
    ';', '&', '|', '<', '>', '`', '$', '(', ')', '%', '*', '?', '^', '!', '\n', '\r',
];

/// Tokenizes `raw`, treating any unquoted metachar (or a quote imbalance) as a signal to escalate. Pure and total:
/// never spawns, never panics. Auto-run and spawning both re-run this so the class is computed from one source.
pub fn analyze(raw: &str) -> Structure {
    let mut tokens: Vec<String> = Vec::new();
    let mut current = String::new();
    let mut has_token = false;
    let mut in_single = false;
    let mut in_double = false;

    for c in raw.chars() {
        if in_single {
            match c {
                '\'' => in_single = false,
                _ => current.push(c),
            }
            has_token = true;
            continue;
        }
        if in_double {
            match c {
                '"' => in_double = false,
                // Backslash is a Windows path separator, NOT an escape — keep it literal so quoted paths survive.
                _ => current.push(c),
            }
            has_token = true;
            continue;
        }
        match c {
            '\'' => {
                in_single = true;
                has_token = true;
            }
            '"' => {
                in_double = true;
                has_token = true;
            }
            ' ' | '\t' => {
                if has_token {
                    tokens.push(std::mem::take(&mut current));
                    has_token = false;
                }
            }
            // An unquoted metachar means shell syntax we refuse — the whole command escalates (BLOCK is checked first
            // by policy, so a catastrophic pattern inside a chain still wins). `\` is a Windows path sep, kept literal.
            _ if METACHARS.contains(&c) => return Structure::Complex,
            _ => {
                current.push(c);
                has_token = true;
            }
        }
    }

    // An unterminated quote is unparseable — never guess (ruling 2, fail-closed).
    if in_single || in_double {
        return Structure::Complex;
    }
    if has_token {
        tokens.push(current);
    }
    match tokens.first() {
        // An empty command has nothing to run; treat as Complex so it never auto-runs.
        None => Structure::Complex,
        Some(program) => {
            let (program, extension) = normalize(program);
            Structure::Simple(SimpleCommand { program, extension, argv: tokens })
        }
    }
}

// Extracts argv[0]'s allowlist key: strip any directory, lowercase, split off a trailing extension. Windows is
// case-insensitive, so matching is case-folded; the `.exe`-only rule is enforced by policy via the returned extension.
fn normalize(raw_program: &str) -> (String, Option<String>) {
    let basename = raw_program.rsplit(['\\', '/']).next().unwrap_or(raw_program);
    let lower = basename.to_ascii_lowercase();
    match lower.rsplit_once('.') {
        Some((stem, ext)) if !stem.is_empty() => (stem.to_string(), Some(ext.to_string())),
        _ => (lower, None),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn simple(raw: &str) -> SimpleCommand {
        match analyze(raw) {
            Structure::Simple(cmd) => cmd,
            Structure::Complex => panic!("expected Simple for {raw:?}"),
        }
    }

    fn is_complex(raw: &str) -> bool {
        matches!(analyze(raw), Structure::Complex)
    }

    #[test]
    fn a_bare_single_command_tokenizes_and_normalizes_argv0() {
        let cmd = simple("git status");
        assert_eq!(cmd.argv, vec!["git", "status"]);
        assert_eq!(cmd.program, "git");
        assert_eq!(cmd.extension, None);
    }

    #[test]
    fn a_path_qualified_exe_normalizes_to_basename_without_extension() {
        // A spaced path must be quoted (else it tokenizes at the space); argv[0] stays verbatim for spawning.
        let cmd = simple("\"C:\\Program Files\\Git\\bin\\GIT.EXE\" --version");
        assert_eq!(cmd.program, "git");
        assert_eq!(cmd.extension.as_deref(), Some("exe"));
        assert_eq!(cmd.argv[0], "C:\\Program Files\\Git\\bin\\GIT.EXE");
    }

    #[test]
    fn quoted_args_keep_metachars_literal_and_stay_simple() {
        let cmd = simple("git commit -m \"fix: a & b | c\"");
        assert_eq!(cmd.argv, vec!["git", "commit", "-m", "fix: a & b | c"]);
        assert!(cmd.extension.is_none());
    }

    #[test]
    fn every_operator_and_metachar_forces_complex() {
        // Each of these is only meaningful to a shell we refuse (ruling 2) — the table fails if any one stops escalating.
        for raw in [
            "a ; b",           // sequence
            "a & b",           // cmd background / separator
            "a && b",          // and-chain
            "a || b",          // or-chain
            "a | b",           // pipe
            "echo hi > f.txt", // redirect out
            "echo hi >> f.txt",
            "sort < f.txt",  // redirect in
            "echo `whoami`",   // backtick substitution
            "echo $(whoami)",  // $() substitution
            "echo $HOME",      // env expansion
            "echo %PATH%",     // cmd env expansion
            "type ( x )",      // subshell parens
            "echo a^b",        // cmd escape
            "echo !DELAYED!",  // delayed expansion
        ] {
            assert!(is_complex(raw), "expected Complex for {raw:?}");
        }
    }

    #[test]
    fn glob_metacharacters_force_complex() {
        // Ruling 5: `*`/`?` escalate (fail-closed); the user can approve in the dialog.
        assert!(is_complex("git add *"));
        assert!(is_complex("ls ?.txt"));
    }

    #[test]
    fn a_newline_forces_complex() {
        assert!(is_complex("git status\nrm -rf /"));
    }

    #[test]
    fn an_unbalanced_quote_forces_complex() {
        assert!(is_complex("echo \"unterminated"));
        assert!(is_complex("echo 'unterminated"));
    }

    #[test]
    fn an_empty_or_whitespace_command_is_complex() {
        assert!(is_complex(""));
        assert!(is_complex("   "));
    }

    #[test]
    fn a_batch_target_reports_its_extension_for_the_policy_to_refuse() {
        // Ruling 3: `.bat`/`.cmd` must never auto-run (BatBadBut); the parser surfaces the extension, policy escalates.
        assert_eq!(simple("deploy.bat --now").extension.as_deref(), Some("bat"));
        assert_eq!(simple("build.cmd").extension.as_deref(), Some("cmd"));
    }
}
