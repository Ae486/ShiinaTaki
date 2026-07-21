//! INPUT:  a target write path + injected FsWriteScopes (Workspace root, authorized dir-roots, skill/hook dirs)
//! OUTPUT: classify -> FsWriteClass (impl gate::ArgClass): floors fs-write:sensitive / :self-escalation, then
//!         :skill-hook / :in-workspace / :dir-root:<root> / :outside-root
//! POS:    shell/gate — the fs-write ArgClass producer (T2b item 4, research §3.4). FOUNDATION / NOT IN THE
//!         PRODUCTION PATH: no out-of-Workspace fs-write capability exists yet. Its live handler will build
//!         FsWriteScopes from operator config, canonicalize the target (symlink-following) and hard-reject
//!         control-char paths at the capability boundary BEFORE calling classify; this module only supplies the
//!         class + its keys, riding the SAME Gate::evaluate_class engine as shell-open/exec (no gate change).

use std::borrow::Cow;
use std::path::{Component, Path, PathBuf};

use crate::gate::ArgClass;

// Component names that make ANY containing path a sensitive sub-target floor, matched case-insensitively (Windows
// folds case, so a case-sensitive floor would be bypassable via `.GIT` / `ID_RSA`) [H-EDIT:45-48,192-197;
// CX-PERM deny-wins-over-write].
const PRIVATE_KEY_NAMES: &[&str] = &["id_rsa", "id_dsa", "id_ecdsa", "id_ed25519"];

// The permission/policy files the gate, Level and floor read — writing any of them is self-escalation ("config IS
// policy": the agent must never rewrite its own authorization) [H-APR:262-275]. Matched on the basename,
// case-insensitively; over-inclusive is fail-safe for a deny floor.
const PERMISSION_SURFACE_FILES: &[&str] = &["gate-decisions.json", "exec-policy.json", "permission-level.json"];

/// The derived risk class of an fs-write target, on the `(capability, argClass)` spine (research §3.4). Ordered by
/// stricter-wins precedence: the two floors are matched FIRST and everywhere (a `.env` inside an authorized root is
/// still sensitive, prd stricter-wins), then the containment classes from most-specific to catch-all.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FsWriteClass {
    /// A secret / private-key / `.git` / `.ssh` sub-target — the sensitive floor (deny in every tier).
    Sensitive,
    /// A permission/policy file the gate reads — the self-escalation floor (deny in every tier).
    SelfEscalation,
    /// Under a skill/hook script dir — executable code (D36): asks below relaxed, never a permanent backdoor.
    SkillHook,
    /// Under the Workspace root, plain data — the always-auto baseline (like Codex `:workspace`).
    InWorkspace,
    /// Under one authorized dir-root — the per-root dynamic class; the root is the key's third segment (the Cow).
    DirRoot(String),
    /// Under no authorized scope — the always-ask, never-persist catch-all.
    OutsideRoot,
}

impl FsWriteClass {
    /// The `(capability, argClass)` key. The dir-root variant carries the specific root as a third segment, so
    /// decision memory is per-root and an Always on one root never reaches another (R1) — hence the owned key
    /// (the first `Cow::Owned` user, the reason A typed the trait as `Cow`).
    pub fn key(&self) -> Cow<'_, str> {
        match self {
            Self::Sensitive => Cow::Borrowed("fs-write:sensitive"),
            Self::SelfEscalation => Cow::Borrowed("fs-write:self-escalation"),
            Self::SkillHook => Cow::Borrowed("fs-write:skill-hook"),
            Self::InWorkspace => Cow::Borrowed("fs-write:in-workspace"),
            Self::DirRoot(root) => Cow::Owned(format!("fs-write:dir-root:{root}")),
            Self::OutsideRoot => Cow::Borrowed("fs-write:outside-root"),
        }
    }
}

impl ArgClass for FsWriteClass {
    fn class_key(&self) -> Cow<'_, str> {
        self.key()
    }
}

/// The authorized write scopes, injected (no live config source exists yet — foundation). A live out-of-Workspace
/// fs-write handler will build this from operator config; `authorized_roots`/`skill_hook_dirs` should be canonical
/// absolute paths (classify normalizes `.`/`..` lexically but does not touch the filesystem).
pub struct FsWriteScopes<'a> {
    pub workspace: &'a Path,
    pub authorized_roots: &'a [PathBuf],
    pub skill_hook_dirs: &'a [PathBuf],
}

/// Derives the fs-write class the gate authorizes on. Fail-closed: a target that could write somewhere other than
/// the classified path (non-UTF-8, empty, a control char) or that escapes via `..` never lands in a silent class —
/// it falls to `OutsideRoot` (never `InWorkspace`).
pub fn classify(target: &Path, scopes: &FsWriteScopes) -> FsWriteClass {
    let Some(raw) = target.to_str() else {
        return FsWriteClass::OutsideRoot; // non-UTF-8 is unclassifiable -> riskier
    };
    // A NUL could truncate the path so the OS writes a different file than the one classified; any control char is
    // unclassifiable (mirror of shell_open target.rs:32). A live handler hard-rejects these at the boundary.
    if raw.is_empty() || raw.chars().any(char::is_control) {
        return FsWriteClass::OutsideRoot;
    }

    let target_components = normalized_lower_components(target);

    // FLOOR 1 — sensitive sub-target: ANY path component is a secret/private-key/.git/.ssh name. Checked FIRST so a
    // floor sub-target inside an authorized root is STILL the floor (stricter-wins) [CX-PERM; H-EDIT:45-48,192-197].
    if target_components.iter().any(|component| is_sensitive_component(component)) {
        return FsWriteClass::Sensitive;
    }
    // FLOOR 2 — self-escalation surface: the filename is a permission/policy file [H-APR:262-275].
    if target_components.last().is_some_and(|name| PERMISSION_SURFACE_FILES.contains(&name.as_str())) {
        return FsWriteClass::SelfEscalation;
    }

    // skill/hook script write (executable code, D36): checked BEFORE the Workspace because a skill dir
    // (workspace/skills) is nested under it and is the stricter class.
    if scopes.skill_hook_dirs.iter().any(|dir| is_within(&target_components, &normalized_lower_components(dir.as_path()))) {
        return FsWriteClass::SkillHook;
    }
    // in-Workspace plain data: the always-auto baseline (like Codex `:workspace`) [CX-PERM].
    if is_within(&target_components, &normalized_lower_components(scopes.workspace)) {
        return FsWriteClass::InWorkspace;
    }
    // authorized dir-root: the per-root dynamic class (memory keys on the specific root, R1) [CX-PERM workspace_roots].
    if let Some(root) =
        scopes.authorized_roots.iter().find(|root| is_within(&target_components, &normalized_lower_components(root.as_path())))
    {
        return FsWriteClass::DirRoot(root.to_string_lossy().into_owned());
    }
    // Outside every authorized scope [CC-PERM additionalDirectories gating; H-EDIT workspace_session under-root-only].
    FsWriteClass::OutsideRoot
}

fn is_sensitive_component(component: &str) -> bool {
    component.starts_with(".env") // .env / .env.local / .env.production (.env*)
        || component == ".git"
        || component == ".ssh"
        || PRIVATE_KEY_NAMES.contains(&component)
}

// Lexically normalized, lowercased path components. `.`/`..` are collapsed WITHOUT touching the filesystem (the
// target may not exist yet; tests stay hermetic); a `..` pops a normal segment but never climbs past the
// prefix/root, so a `C:\ws\..\secret` target normalizes OUT of the Workspace instead of string-prefix-matching it
// (path-traversal fail-closed [H-PATH:15-34]). Lowercasing is the Windows case-fold the floor consts rely on.
fn normalized_lower_components(path: &Path) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let mut anchor = 0usize; // [0..anchor) is the prefix/root — never popped by `..`
    for component in path.components() {
        match component {
            Component::Prefix(_) | Component::RootDir => {
                out.push(component.as_os_str().to_string_lossy().to_ascii_lowercase());
                anchor = out.len();
            }
            Component::CurDir => {}
            Component::ParentDir => {
                if out.len() > anchor {
                    out.pop();
                }
            }
            Component::Normal(segment) => out.push(segment.to_string_lossy().to_ascii_lowercase()),
        }
    }
    out
}

// Component-wise containment (never a string-prefix false match like `C:\wsfoo` under `C:\ws`). An empty root
// contains nothing (a misconfigured/empty root grants no scope) — fail-closed.
fn is_within(target: &[String], root: &[String]) -> bool {
    !root.is_empty() && root.len() <= target.len() && target[..root.len()] == *root
}

#[cfg(test)]
mod tests {
    use super::*;

    // Injected scopes are the foundation contract (no live config source). ws = Workspace root.
    fn classify_with(target: &str, ws: &str, roots: &[&str], skills: &[&str]) -> FsWriteClass {
        let roots: Vec<PathBuf> = roots.iter().map(PathBuf::from).collect();
        let skills: Vec<PathBuf> = skills.iter().map(PathBuf::from).collect();
        classify(
            Path::new(target),
            &FsWriteScopes { workspace: Path::new(ws), authorized_roots: &roots, skill_hook_dirs: &skills },
        )
    }

    #[test]
    fn in_workspace_plain_data_classifies_in_workspace() {
        assert_eq!(classify_with("C:\\ws\\notes.txt", "C:\\ws", &[], &[]), FsWriteClass::InWorkspace);
        assert_eq!(classify_with("C:\\ws\\sub\\deep\\a.rs", "C:\\ws", &[], &[]), FsWriteClass::InWorkspace);
    }

    #[test]
    fn a_file_under_an_authorized_root_carries_that_root_in_its_key() {
        let class = classify_with("C:\\proj\\src\\main.rs", "C:\\ws", &["C:\\proj"], &[]);
        assert_eq!(class, FsWriteClass::DirRoot("C:\\proj".into()));
        assert_eq!(class.class_key(), "fs-write:dir-root:C:\\proj");
    }

    #[test]
    fn a_file_outside_every_root_is_outside_root() {
        assert_eq!(classify_with("C:\\other\\f.txt", "C:\\ws", &["C:\\proj"], &[]), FsWriteClass::OutsideRoot);
        // A string prefix that is NOT a component prefix (`C:\wsfoo` under `C:\ws`) must not match the Workspace.
        assert_eq!(classify_with("C:\\wsfoo\\f.txt", "C:\\ws", &[], &[]), FsWriteClass::OutsideRoot);
    }

    #[test]
    fn skill_hook_dirs_are_checked_before_the_workspace() {
        // A skill dir nested under the Workspace still classifies as skill-hook (executable code, stricter, D36).
        assert_eq!(
            classify_with("C:\\ws\\skills\\a.js", "C:\\ws", &[], &["C:\\ws\\skills"]),
            FsWriteClass::SkillHook,
        );
        // A hooks dir OUTSIDE the Workspace too.
        assert_eq!(classify_with("C:\\hooks\\b.js", "C:\\ws", &[], &["C:\\hooks"]), FsWriteClass::SkillHook);
        // A plain Workspace file (not under a skill dir) is still in-workspace — skill-hook must not shadow it.
        assert_eq!(
            classify_with("C:\\ws\\notes.txt", "C:\\ws", &[], &["C:\\ws\\skills"]),
            FsWriteClass::InWorkspace,
        );
    }

    #[test]
    fn a_sensitive_sub_target_beats_an_authorized_root() {
        // RED-proof #1: a .env INSIDE an authorized root is STILL the sensitive floor, never dir-root
        // (stricter-wins, deny-wins-over-write). Flip the floor check below the dir-root check -> this goes red.
        assert_eq!(classify_with("C:\\proj\\.env", "C:\\ws", &["C:\\proj"], &[]), FsWriteClass::Sensitive);
        // ...and inside the Workspace, and for env variants / private keys / .git / .ssh components.
        for target in [
            "C:\\ws\\.env",
            "C:\\ws\\.env.local",
            "C:\\ws\\.env.production",
            "C:\\ws\\id_rsa",
            "C:\\ws\\id_ed25519",
            "C:\\ws\\.git\\config",
            "C:\\ws\\.ssh\\known_hosts",
        ] {
            assert_eq!(classify_with(target, "C:\\ws", &[], &[]), FsWriteClass::Sensitive, "{target}");
        }
    }

    #[test]
    fn sensitive_detection_is_case_insensitive() {
        // Windows folds case, so a case-sensitive floor would be bypassable via `.GIT` / `ID_RSA`.
        for target in ["C:\\ws\\.GIT\\config", "C:\\ws\\ID_RSA", "C:\\ws\\.SSH\\x", "C:\\ws\\.ENV"] {
            assert_eq!(classify_with(target, "C:\\ws", &[], &[]), FsWriteClass::Sensitive, "{target}");
        }
    }

    #[test]
    fn the_permission_surface_is_the_self_escalation_floor() {
        // RED-proof #2 (classify half): writing any file the gate/Level/floor reads is self-escalation
        // ("config IS policy"). Even outside every root, and case-insensitively.
        for name in ["gate-decisions.json", "exec-policy.json", "permission-level.json"] {
            let target = format!("C:\\anywhere\\{name}");
            assert_eq!(classify_with(&target, "C:\\ws", &[], &[]), FsWriteClass::SelfEscalation, "{name}");
        }
        assert_eq!(
            classify_with("C:\\x\\GATE-DECISIONS.JSON", "C:\\ws", &[], &[]),
            FsWriteClass::SelfEscalation,
        );
    }

    #[test]
    fn an_ambiguous_target_never_classifies_in_workspace() {
        // RED-proof #6: control chars (NUL truncation could write a different path than classified) and a `..`
        // that escapes the Workspace both fail-closed to the never-silent catch-all. Remove the guards -> red.
        let control = classify_with("C:\\ws\\evil\0.txt", "C:\\ws", &[], &[]);
        assert_eq!(control, FsWriteClass::OutsideRoot);
        assert_ne!(control, FsWriteClass::InWorkspace);
        // `..` traversal out of the Workspace normalizes OUT (no string-prefix false match).
        assert_eq!(classify_with("C:\\ws\\..\\secret\\f.txt", "C:\\ws", &[], &[]), FsWriteClass::OutsideRoot);
        // empty target.
        assert_eq!(classify_with("", "C:\\ws", &[], &[]), FsWriteClass::OutsideRoot);
    }

    #[test]
    fn traversal_back_into_the_workspace_is_in_workspace() {
        // `..` collapses lexically, so a path that resolves back inside is correctly in-workspace (no false OutsideRoot).
        assert_eq!(classify_with("C:\\ws\\sub\\..\\notes.txt", "C:\\ws", &[], &[]), FsWriteClass::InWorkspace);
    }

    #[test]
    fn the_class_keys_match_the_governance_registry() {
        assert_eq!(FsWriteClass::Sensitive.class_key(), "fs-write:sensitive");
        assert_eq!(FsWriteClass::SelfEscalation.class_key(), "fs-write:self-escalation");
        assert_eq!(FsWriteClass::InWorkspace.class_key(), "fs-write:in-workspace");
        assert_eq!(FsWriteClass::SkillHook.class_key(), "fs-write:skill-hook");
        assert_eq!(FsWriteClass::OutsideRoot.class_key(), "fs-write:outside-root");
        assert_eq!(FsWriteClass::DirRoot("C:\\A".into()).class_key(), "fs-write:dir-root:C:\\A");
    }

    #[test]
    fn distinct_roots_produce_distinct_full_keys() {
        // RED-proof #3 (key half, R1): two authorized roots produce two distinct full keys — the per-root memory
        // boundary. Cross-root leakage is impossible because the keys never collide.
        let a = classify_with("C:\\A\\f", "C:\\ws", &["C:\\A", "C:\\B"], &[]);
        let b = classify_with("C:\\B\\f", "C:\\ws", &["C:\\A", "C:\\B"], &[]);
        assert_eq!(a.class_key(), "fs-write:dir-root:C:\\A");
        assert_eq!(b.class_key(), "fs-write:dir-root:C:\\B");
        assert_ne!(a.class_key(), b.class_key());
    }
}
