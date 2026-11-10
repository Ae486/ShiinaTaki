//! INPUT: Tauri build configuration and the finite app command inventory.
//! OUTPUT: generated command ACLs and native application/example resources.
//! POS: desktop native build; examples reuse the Windows manifest needed by WebView dependencies.

fn main() {
    // An app manifest enables ACL enforcement for ALL app commands. Preserve the
    // three legacy commands via their own local-only capability; QQMM stays Home-only.
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "ping",
            "get_status",
            "local_core_endpoint",
            "local_operator_identity",
            "local_operator_proof",
            "local_characters_root",
            "browser_attachment_setup",
            "browser_attachment_pair",
            "submit_pairing_code",
            "qqmm_open",
            "qqmm_request",
            "qqmm_close",
        ]),
    ))
    .expect("desktop build configuration is invalid");

    // tauri-build links resource.lib only to bins. Without the Common Controls
    // v6 manifest, Windows cannot load TaskDialogIndirect for the fixture example.
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows")
        && std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc")
    {
        let resource =
            std::path::PathBuf::from(std::env::var_os("OUT_DIR").unwrap()).join("resource.lib");
        println!("cargo:rustc-link-arg-examples={}", resource.display());
    }
}
