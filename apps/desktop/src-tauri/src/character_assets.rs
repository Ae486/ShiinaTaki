//! INPUT: the native-selected Core profile and an actual Home/Pet command caller.
//! OUTPUT: one captured Character resource root and lazy asset-protocol access to that subtree only.
//! POS: shell resource bridge; no renderer-selected path, directory creation, Core connection or credential read.

use std::path::PathBuf;
use tauri::{Manager, State};

pub(crate) struct CharacterAssets {
    root: Result<PathBuf, String>,
}

impl CharacterAssets {
    pub(crate) fn capture() -> Self {
        Self::from_profile(crate::local_auth::selected_profile())
    }

    fn from_profile(profile: Result<PathBuf, String>) -> Self {
        let root = profile.and_then(|profile| {
            if profile.as_os_str().is_empty() {
                return Err("Character asset profile is unavailable".into());
            }
            std::path::absolute(profile)
                .map(|root| root.join("workspace").join("characters"))
                .map_err(|_| "Character asset profile is unavailable".into())
        });
        // Failed bootstrap selection affects this feature only; Home still starts.
        Self { root }
    }

    fn resolve(&self, scope: &tauri::scope::fs::Scope) -> Result<String, String> {
        let root = self.root.as_ref().map_err(Clone::clone)?;
        let path = root
            .to_str()
            .ok_or("Character asset path cannot be represented")?;
        // Tauri canonicalizes existing ancestors, so an absent first-import directory
        // remains usable after Core creates it. The literal path is glob-escaped by Tauri.
        scope
            .allow_directory(root, true)
            .map_err(|_| "Character asset access is unavailable")?;
        Ok(path.to_owned())
    }
}

#[tauri::command]
pub(crate) fn local_characters_root(
    window: tauri::WebviewWindow,
    assets: State<'_, CharacterAssets>,
) -> Result<String, String> {
    crate::local_auth_commands::permitted_window(&window)?;
    assets.resolve(&window.asset_protocol_scope())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn absent_import_root_is_captured_without_creating_profile_or_requiring_core() {
        let fixture = tempfile::tempdir().unwrap();
        let profile = fixture.path().join("profile");
        let assets = CharacterAssets::from_profile(Ok(profile.clone()));
        let root = assets.root.unwrap();
        assert!(root.is_absolute());
        assert_eq!(root, profile.join("workspace").join("characters"));
        assert!(!profile.exists());
    }

    #[test]
    fn relative_profile_is_frozen_as_an_absolute_path_with_literal_components() {
        let profile = PathBuf::from("native-profile[1]");
        let assets = CharacterAssets::from_profile(Ok(profile.clone()));
        assert_eq!(
            assets.root.unwrap(),
            std::path::absolute(profile)
                .unwrap()
                .join("workspace/characters")
        );
    }

    #[test]
    fn unavailable_or_empty_profile_remains_a_feature_error() {
        for profile in [Err("profile unavailable".into()), Ok(PathBuf::new())] {
            let assets = CharacterAssets::from_profile(profile);
            assert!(assets.root.is_err());
        }
    }

    #[test]
    fn packaged_configuration_has_no_implicit_default_profile_grant() {
        let config: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        assert_eq!(
            config["app"]["security"]["assetProtocol"]["scope"],
            serde_json::json!([])
        );
    }
}
