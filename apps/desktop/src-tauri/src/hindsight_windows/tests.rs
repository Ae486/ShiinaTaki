use std::fs;
use std::path::Path;
use super::acl::ObjectRole;
use super::objects::{local_path, open_object};
use windows::core::{BOOL, HSTRING, PWSTR};
use windows::Win32::Foundation::{HLOCAL, LocalFree};
use windows::Win32::Security::{ACL, DACL_SECURITY_INFORMATION, PROTECTED_DACL_SECURITY_INFORMATION, PSID, PSECURITY_DESCRIPTOR, GetSecurityDescriptorDacl};
use windows::Win32::Security::Authorization::{ConvertSidToStringSidW, ConvertStringSecurityDescriptorToSecurityDescriptorW, SDDL_REVISION_1, SE_FILE_OBJECT, SetNamedSecurityInfoW};

fn token_sid() -> Vec<u8> { crate::secrets::current_user_sid().expect("actual test token SID") }
fn sid_string(bytes: &[u8]) -> String {
    let mut text = PWSTR::null();
    unsafe { ConvertSidToStringSidW(PSID(bytes.as_ptr().cast_mut().cast()), &mut text).unwrap(); }
    let result = unsafe { text.to_string().unwrap() };
    unsafe { LocalFree(Some(HLOCAL(text.0.cast()))); }
    result
}

/// Only test-created objects enter this helper. Never make an unsafe existing production ancestor pass by repair.
fn protect_fixture(path: &Path, extra: &str) {
    let sid = sid_string(&token_sid());
    let sddl = HSTRING::from(format!("D:P(A;;FA;;;SY)(A;;FA;;;BA)(A;;FA;;;{sid}){extra}"));
    let mut descriptor = PSECURITY_DESCRIPTOR::default();
    unsafe { ConvertStringSecurityDescriptorToSecurityDescriptorW(&sddl, SDDL_REVISION_1, &mut descriptor, None).unwrap(); }
    let mut present = BOOL::default(); let mut defaulted = BOOL::default(); let mut acl: *mut ACL = std::ptr::null_mut();
    unsafe { GetSecurityDescriptorDacl(descriptor, &mut present, &mut acl, &mut defaulted).unwrap(); }
    assert!(present.as_bool());
    let result = unsafe { SetNamedSecurityInfoW(&HSTRING::from(path.as_os_str()), SE_FILE_OBJECT,
        DACL_SECURITY_INFORMATION | PROTECTED_DACL_SECURITY_INFORMATION, None, None, Some(acl), None).ok() };
    unsafe { LocalFree(Some(HLOCAL(descriptor.0))); }
    result.expect("protect only owned fixture");
}

#[test]
fn retained_file_denies_write_delete_and_rename_until_released() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("payload.js");
    fs::write(&path, b"original bytes").unwrap(); protect_fixture(&path, "");
    // Primitive coverage deliberately opens the owned object itself. The full installed fixture below exercises
    // HeldObjects::hold and its complete ancestor chain; this test does not claim the system Temp parent is safe.
    let original = open_object(&local_path(&path).unwrap(), false, &token_sid(), ObjectRole::Payload).unwrap();
    assert!(fs::write(&path, b"changed bytes").is_err());
    assert!(fs::remove_file(&path).is_err());
    assert!(fs::rename(&path, directory.path().join("replaced.js")).is_err());
    assert_eq!(fs::read(&path).unwrap(), b"original bytes");
    let original_id = original.identity.clone(); drop(original);
    fs::remove_file(&path).unwrap(); fs::write(&path, b"new object").unwrap(); protect_fixture(&path, "");
    let replacement = open_object(&local_path(&path).unwrap(), false, &token_sid(), ObjectRole::Payload).unwrap();
    assert_ne!(replacement.identity, original_id);
}

#[test]
fn actual_dacl_rejects_other_writer_and_unsafe_parent_rights() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("payload.js");
    fs::write(&path, b"fixture").unwrap(); protect_fixture(&path, "(A;;GW;;;WD)");
    assert!(open_object(&local_path(&path).unwrap(), false, &token_sid(), ObjectRole::Payload).is_err());
    protect_fixture(directory.path(), "(A;;SD;;;WD)");
    assert!(open_object(&local_path(directory.path()).unwrap(), true, &token_sid(), ObjectRole::Ancestor).is_err());
    protect_fixture(directory.path(), "(A;;0x00000004;;;WD)");
    assert!(open_object(&local_path(directory.path()).unwrap(), true, &token_sid(), ObjectRole::Ancestor).is_ok());
    assert!(open_object(&local_path(directory.path()).unwrap(), true, &token_sid(), ObjectRole::Payload).is_err());
}

#[test]
fn hard_links_and_wrong_real_owner_refuse() {
    let directory = tempfile::tempdir().unwrap(); let path = directory.path().join("artifact.js");
    fs::write(&path, b"fixture").unwrap(); protect_fixture(&path, "");
    assert!(open_object(&local_path(&path).unwrap(), false, &[], ObjectRole::Payload).is_err());
    fs::hard_link(&path, directory.path().join("alias.js")).unwrap();
    assert!(open_object(&local_path(&path).unwrap(), false, &token_sid(), ObjectRole::Payload).is_err());
}

#[test]
fn ambiguous_windows_paths_refuse_before_open() {
    for value in [r"\\server\share\file", r"\\?\C:\payload", r"C:relative", r"C:\payload:stream", r"C:\a\..\b", r"C:\a.\b", r"C:\a \b"] {
        assert!(local_path(Path::new(value)).is_err(), "{value}");
    }
}

#[test]
fn parent_handle_blocks_directory_rename() {
    let directory = tempfile::tempdir().unwrap(); let parent = directory.path().join("installed");
    fs::create_dir(&parent).unwrap(); protect_fixture(&parent, "");
    let guard = open_object(&local_path(&parent).unwrap(), true, &token_sid(), ObjectRole::Payload).unwrap();
    assert!(fs::rename(&parent, directory.path().join("redirected")).is_err());
    drop(guard); fs::rename(&parent, directory.path().join("redirected")).unwrap();
}

#[test]
#[ignore = "requires the separately built, protected fake-credential C1a copied-install fixture"]
fn copied_installation_prepares_fake_catalog_without_checkout_or_preload() {
    let root = std::env::var_os("TAKI_C1A_FIXTURE_ROOT").expect("explicit owned fixture root");
    let root = std::path::PathBuf::from(root);
    let registration = root.join("registration.json");
    let input: serde_json::Value = serde_json::from_slice(&fs::read(root.join("invocation.json")).unwrap()).unwrap();
    let invocation = crate::protocol::parse_hindsight_invocation(input).unwrap();
    let installed = super::VerifiedInstallation::open(&registration, &invocation.control.target_host_id).expect("complete production Windows install verification");
    installed.verify_runtime().unwrap();
    let context = crate::capabilities_impl::TrustedHostInvocationContext {
        request_id: invocation.request_id, control: invocation.control, authorization: invocation.authorization,
        live: std::sync::Arc::new(std::sync::atomic::AtomicBool::new(true)), checkpoint: None,
    };
    let result = super::prepare(installed, &context, invocation.input).unwrap();
    assert!(matches!(result, crate::protocol::HindsightCustodyResult::Prepared { deployment_ready: false, .. }));
    assert!(!root.join("preload-ran").exists());
    assert!(!serde_json::to_string(&result).unwrap().contains("C1A_FAKE_SENTINEL"));
}

#[test]
#[ignore = "mutates only the separately built, protected fake-credential C1a copied-install fixture"]
fn copied_installation_rejects_missing_and_tampered_artifacts() {
    let root = std::path::PathBuf::from(std::env::var_os("TAKI_C1A_FIXTURE_ROOT").expect("explicit owned fixture root"));
    assert_eq!(fs::read_to_string(root.join(".c1a-owned-fixture")).unwrap(), "C1A_FAKE_ONLY");
    let path = root.join("registration.json");
    let bytes = fs::read(&path).unwrap();
    let registration = crate::protocol::parse_hindsight_registration(serde_json::from_slice(&bytes).unwrap()).unwrap();
    let payload = std::path::PathBuf::from(&registration.installation_root);
    assert!(payload.starts_with(&root));
    let runtime = std::path::PathBuf::from(&registration.runtime.path);
    assert!(runtime.starts_with(&root));
    for artifact in [payload.join("manifest.json"), payload.join("app/main.js"),
        payload.join("bin/taki-secret-key.exe"), payload.join("node_modules/zod/package.json"), runtime] {
        let original = fs::read(&artifact).unwrap();
        let mut changed = original.clone();
        changed.push(b' ');
        fs::write(&artifact, changed).unwrap();
        let tamper_refused = super::VerifiedInstallation::open(&path, &registration.execution_host_id).is_err();
        fs::write(&artifact, original).unwrap();
        assert!(tamper_refused, "tampering refused: {}", artifact.display());
        let absent = root.join("removed-fixture-artifact");
        fs::rename(&artifact, &absent).unwrap();
        let missing_refused = super::VerifiedInstallation::open(&path, &registration.execution_host_id).is_err();
        fs::rename(&absent, &artifact).unwrap();
        assert!(missing_refused, "missing refused: {}", artifact.display());
    }
    // A valid executable with a false registered version must also fail its actual version probe.
    let mut wrong_version: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    wrong_version["runtime"]["version"] = serde_json::json!("v24.0.0");
    fs::write(&path, serde_json::to_vec(&wrong_version).unwrap()).unwrap();
    let version_refused = super::VerifiedInstallation::open(&path, &registration.execution_host_id).unwrap().verify_runtime().is_err();
    fs::write(&path, &bytes).unwrap();
    assert!(version_refused);
    assert!(!root.join("preload-ran").exists());
}

#[test]
#[ignore = "changes only the separately built fake Catalog fixture's own DACLs"]
fn copied_installation_refuses_unsafe_catalog_objects() {
    let root = std::path::PathBuf::from(std::env::var_os("TAKI_C1A_FIXTURE_ROOT").expect("explicit owned fixture root"));
    assert_eq!(fs::read_to_string(root.join(".c1a-owned-fixture")).unwrap(), "C1A_FAKE_ONLY");
    let invocation = crate::protocol::parse_hindsight_invocation(serde_json::from_slice(
        &fs::read(root.join("invocation.json")).unwrap()).unwrap()).unwrap();
    let registration_path = root.join("registration.json");
    let registration = crate::protocol::parse_hindsight_registration(serde_json::from_slice(
        &fs::read(&registration_path).unwrap()).unwrap()).unwrap();
    let directory = std::path::PathBuf::from(&registration.core_data_directory);
    assert!(directory.starts_with(&root));
    let catalog = directory.join("secret-catalog.bin");
    let context = crate::capabilities_impl::TrustedHostInvocationContext {
        request_id: invocation.request_id, control: invocation.control, authorization: invocation.authorization,
        live: std::sync::Arc::new(std::sync::atomic::AtomicBool::new(true)), checkpoint: None,
    };
    for object in [&catalog, &directory] {
        protect_fixture(object, "(A;;GW;;;WD)");
        let result = super::VerifiedInstallation::open(&registration_path, &context.control.target_host_id)
            .and_then(|installation| super::prepare(installation, &context, invocation.input.clone()));
        protect_fixture(object, "");
        assert!(matches!(result, Err(crate::protocol::HindsightRefusal::UnsafeInstallation)),
            "unsafe registered Catalog object must refuse: {result:?}");
    }
    let original = fs::read(&registration_path).unwrap();
    let mut redirected: serde_json::Value = serde_json::from_slice(&original).unwrap();
    let junction = root.join("catalog-junction");
    assert!(fs::symlink_metadata(&junction).unwrap().file_type().is_symlink(), "explicit owned junction fixture");
    redirected["coreDataDirectory"] = serde_json::json!(junction);
    fs::write(&registration_path, serde_json::to_vec(&redirected).unwrap()).unwrap();
    let result = super::VerifiedInstallation::open(&registration_path, &context.control.target_host_id)
        .and_then(|installation| super::prepare(installation, &context, invocation.input));
    fs::write(&registration_path, original).unwrap();
    assert!(matches!(result, Err(crate::protocol::HindsightRefusal::UnsafeInstallation)), "Catalog junction must refuse: {result:?}");
}

#[test]
#[ignore = "uses a new subdirectory of the explicitly protected fake-only Catalog fixture"]
fn copied_installation_keeps_catalog_publication_rename_compatible() {
    use sha2::{Digest, Sha256};
    let root = std::path::PathBuf::from(std::env::var_os("TAKI_C1A_FIXTURE_ROOT").expect("explicit owned fixture root"));
    assert_eq!(fs::read_to_string(root.join(".c1a-owned-fixture")).unwrap(), "C1A_FAKE_ONLY");
    let directory = tempfile::Builder::new().prefix("catalog-publication-").tempdir_in(&root).unwrap();
    protect_fixture(directory.path(), "");
    let path = directory.path().join("secret-catalog.bin");
    let bytes = b"fake sealed catalog bytes";
    fs::write(&path, bytes).unwrap(); protect_fixture(&path, "");
    let sid = token_sid();
    let mut objects = super::objects::HeldObjects::new(sid.clone());
    let snapshot = super::catalog::CatalogSnapshot::open(&mut objects, directory.path(), &sid,
        &format!("{:x}", Sha256::digest(bytes))).unwrap();
    assert!(fs::rename(directory.path(), root.join("redirected-catalog-parent")).is_err());
    let staging = directory.path().join("published-stage.bin");
    fs::write(&staging, bytes).unwrap(); protect_fixture(&staging, "");
    // Same-directory rename of a freshly staged envelope is the Core publication operation. The snapshot
    // closes its leaf read before returning, even when replacement bytes are identical to the old snapshot.
    fs::rename(&staging, &path).expect("Core-style atomic Catalog replacement stays available");
    assert_eq!(fs::read(&path).unwrap(), bytes);
    assert!(matches!(snapshot.validate(&sid), Err(crate::protocol::HindsightRefusal::SnapshotStale)));
    objects.validate().unwrap();
}
