use super::*;
use crate::secrets::InMemoryStore;

#[test]
fn native_source_and_role_guards_reject_arbitrary_windows_origins_and_identities() {
    for label in ["home", "pet"] { assert!(permitted_source(label, "http://tauri.localhost")); }
    for label in ["main", "unknown", "node"] { assert!(!permitted_source(label, "http://tauri.localhost")); }
    for origin in ["null", "http://evil.test", "http://localhost:1420.evil.test", "http://localhost:8974"] { assert!(!permitted_source("home", origin)); }
    let (mut challenge, _) = crate::local_auth::tests::fixture();
    let identity = challenge.device_id.clone();
    assert!(validate_identity(&challenge, &identity).is_ok());
    assert!(validate_identity(&challenge, "550e8400-e29b-41d4-a716-446655440003").is_err());
    challenge.role = crate::protocol::Role::Node;
    assert!(validate_identity(&challenge, &identity).is_err());
}

#[test]
fn operator_identity_is_stable_and_corrupt_state_is_preserved() {
    let store = InMemoryStore::default();
    let first = stable_operator_identity(&store).unwrap();
    assert_eq!(stable_operator_identity(&store).unwrap(), first);
    store.set("operator-device-id", "broken").unwrap();
    assert!(stable_operator_identity(&store).is_err());
    assert_eq!(store.get("operator-device-id").unwrap().as_deref(), Some("broken"));
}
