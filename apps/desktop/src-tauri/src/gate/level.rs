//! INPUT:  permission-level.json under the node data dir (operator-written; the agent has NO write path to it)
//! OUTPUT: load_level(path) -> PermissionLevel — missing file -> Standard; corrupt -> warn + Standard (fail-safe)
//! POS:    shell/gate — the active-Level source, read ONCE at build_node (frozen out of agent reach [H-APR:32-35])

use std::fs;
use std::path::Path;

use crate::protocol::{PermissionLevel, PermissionLevelState};

/// Loads the operator-selected Permission Level. The file shape IS the wire shape (`PermissionLevelState`,
/// invariant 3) — the same payload permission.levelSet will carry (#23). Fail-SAFE, not fail-open: any problem
/// degrades to Standard, never to Relaxed.
pub fn load_level(path: &Path) -> PermissionLevel {
    let raw = match fs::read_to_string(path) {
        Ok(raw) => raw,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return PermissionLevel::Standard,
        Err(error) => {
            tracing::warn!(error = %error, "permission level unreadable; using standard");
            return PermissionLevel::Standard;
        }
    };
    match serde_json::from_str::<PermissionLevelState>(&raw) {
        Ok(state) => state.level,
        Err(_) => {
            tracing::warn!("permission level file malformed; using standard");
            PermissionLevel::Standard
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
            (r#"{ "level": "relaxed" }"#, PermissionLevel::Relaxed),
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
}
