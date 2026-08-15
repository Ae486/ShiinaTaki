//! INPUT:  permission-level.json under the node data dir (operator-written; the agent has NO write path to it)
//! OUTPUT: read-only LegacyLevelConstraint; missing/relaxed are neutral, strict/standard tighten, errors close authority
//! POS:    shell/gate — Slice-3 compatibility input only; Core projection remains the global policy authority

use std::fs;
use std::path::Path;

use crate::protocol::{PermissionLevel, PermissionLevelState};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LegacyLevelConstraint { None, Standard, Strict, Closed }

/// Loads the operator-selected Permission Level. The file shape IS the wire shape (`PermissionLevelState`,
/// invariant 3) — the same payload permission.levelSet will carry (#23). Fail-SAFE, not fail-open: any problem
/// degrades to Standard, never to Relaxed.
pub fn load_level(path: &Path) -> PermissionLevel {
    match load_legacy_constraint(path) {
        LegacyLevelConstraint::Strict => PermissionLevel::Strict,
        LegacyLevelConstraint::None | LegacyLevelConstraint::Standard | LegacyLevelConstraint::Closed => PermissionLevel::Standard,
    }
}

pub fn load_legacy_constraint(path: &Path) -> LegacyLevelConstraint {
    let raw = match fs::read_to_string(path) {
        Ok(raw) => raw,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return LegacyLevelConstraint::None,
        Err(error) => {
            tracing::warn!(code = "LEGACY_PERMISSION_LEVEL_UNREADABLE", kind = ?error.kind(), "legacy permission level unreadable; Host governance fails closed");
            return LegacyLevelConstraint::Closed;
        }
    };
    match serde_json::from_str::<PermissionLevelState>(&raw) {
        Ok(state) => match state.level {
            PermissionLevel::Strict => LegacyLevelConstraint::Strict,
            PermissionLevel::Standard => LegacyLevelConstraint::Standard,
            PermissionLevel::Relaxed => LegacyLevelConstraint::None,
        },
        Err(_) => {
            tracing::warn!(code = "LEGACY_PERMISSION_LEVEL_MALFORMED", "legacy permission level malformed; Host governance fails closed");
            LegacyLevelConstraint::Closed
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_missing_file_is_standard() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(load_level(&dir.path().join("permission-level.json")), PermissionLevel::Standard);
    }

    #[test]
    fn a_valid_file_selects_its_level() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("permission-level.json");
        for (text, level) in [
            (r#"{ "level": "strict" }"#, PermissionLevel::Strict),
            (r#"{ "level": "standard" }"#, PermissionLevel::Standard),
            (r#"{ "level": "relaxed" }"#, PermissionLevel::Standard),
        ] {
            fs::write(&path, text).unwrap();
            assert_eq!(load_level(&path), level, "{text}");
        }
    }

    #[test]
    fn corrupt_or_unknown_degrades_to_standard_not_relaxed() {
        // Fail-safe: a torn write, a hand-edited "yolo", or an extra key (strictObject parity) must never land
        // on the loosest tier.
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("permission-level.json");
        for text in ["{ not json", r#"{ "level": "yolo" }"#, r#"{ "level": "relaxed", "extra": 1 }"#] {
            fs::write(&path, text).unwrap();
            assert_eq!(load_level(&path), PermissionLevel::Standard, "{text}");
        }
    }

    #[test]
    fn legacy_constraints_are_deny_only() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("permission-level.json");
        assert_eq!(load_legacy_constraint(&path), LegacyLevelConstraint::None);
        for (raw, expected) in [
            (r#"{"level":"strict"}"#, LegacyLevelConstraint::Strict),
            (r#"{"level":"standard"}"#, LegacyLevelConstraint::Standard),
            (r#"{"level":"relaxed"}"#, LegacyLevelConstraint::None),
            ("{bad", LegacyLevelConstraint::Closed),
        ] {
            fs::write(&path, raw).unwrap();
            assert_eq!(load_legacy_constraint(&path), expected);
        }
    }

    #[test]
    fn unreadable_source_fails_closed() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(load_legacy_constraint(dir.path()), LegacyLevelConstraint::Closed);
    }
}
