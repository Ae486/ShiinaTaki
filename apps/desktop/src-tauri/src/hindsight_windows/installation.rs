//! INPUT:  explicitly protected Host registration and the current authenticated device identity
//! OUTPUT: a complete locked installation tree and actual credential-owner identity
//! POS:    shell/hindsight_windows — external registration is the trust root; manifest cannot attest itself

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use sha2::{Digest, Sha256};
use super::objects::{HeldObjects, local_path};
use super::process::{run_bounded, sanitized_command, ProcessBudget};
use crate::protocol::{CUSTODY_ENVELOPE_BYTES, CUSTODY_REQUEST_BYTES, HindsightCredentialSource,
    HindsightManifest, HindsightRefusal, HindsightRegistration, parse_hindsight_manifest, parse_hindsight_registration};

pub(crate) struct VerifiedInstallation {
    pub registration: HindsightRegistration,
    pub registration_path: PathBuf,
    pub registration_sha256: String,
    pub sid: Vec<u8>,
    pub(super) objects: HeldObjects,
}

impl VerifiedInstallation {
    pub fn open(registration_path: &Path, host_id: &str) -> Result<Self, HindsightRefusal> {
        let sid = crate::secrets::current_user_sid().map_err(|_| HindsightRefusal::UnsafeInstallation)?;
        let registration_path = local_path(registration_path)?;
        let mut objects = HeldObjects::new(sid.clone());
        objects.hold(&registration_path, false)?;
        let bytes = objects.read(&registration_path, CUSTODY_REQUEST_BYTES)?;
        let registration_sha256 = format!("{:x}", Sha256::digest(&bytes));
        let registration = parse_hindsight_registration(serde_json::from_slice(&bytes).map_err(|_| HindsightRefusal::UnsafeInstallation)?)
            .map_err(|_| HindsightRefusal::UnsafeInstallation)?;
        let root = local_path(Path::new(&registration.installation_root))?;
        if registration.execution_host_id != host_id || registration_path.starts_with(&root) { return Err(HindsightRefusal::UnsafeInstallation); }
        let HindsightCredentialSource::WindowsKeyring { token_user_sha256, adapter, .. } = &registration.custody else {
            return Err(HindsightRefusal::UnsupportedInstallation);
        };
        if format!("{:x}", Sha256::digest(&sid)) != *token_user_sha256
            || local_path(Path::new(&adapter.path))? != root.join("bin/taki-secret-key.exe") { return Err(HindsightRefusal::UnsafeInstallation); }
        objects.hold(&root, true)?;
        let manifest_path = root.join("manifest.json");
        objects.hold(&manifest_path, false)?;
        if objects.digest(&manifest_path)? != registration.manifest_sha256 { return Err(HindsightRefusal::UnsafeInstallation); }
        let manifest = parse_hindsight_manifest(serde_json::from_slice(&objects.read(&manifest_path, CUSTODY_ENVELOPE_BYTES)?)
            .map_err(|_| HindsightRefusal::UnsafeInstallation)?).map_err(|_| HindsightRefusal::UnsafeInstallation)?;
        let architecture = if cfg!(target_arch = "x86_64") { "x64" } else if cfg!(target_arch = "aarch64") { "arm64" } else { "unsupported" };
        if manifest.platform != "win32" || manifest.architecture != architecture { return Err(HindsightRefusal::UnsupportedInstallation); }
        hold_tree(&root, &manifest, &mut objects)?;
        for artifact in &manifest.files {
            if objects.digest(&root.join(&artifact.path))? != artifact.sha256 { return Err(HindsightRefusal::UnsafeInstallation); }
        }
        let runtime_path = Path::new(&registration.runtime.path);
        objects.hold(runtime_path, false)?;
        if objects.digest(runtime_path)? != registration.runtime.sha256 || objects.digest(Path::new(&adapter.path))? != adapter.sha256 {
            return Err(HindsightRefusal::UnsafeInstallation);
        }
        objects.validate()?;
        Ok(Self { registration, registration_path, registration_sha256, sid, objects })
    }

    pub fn verify_runtime(&self) -> Result<(), HindsightRefusal> {
        let mut command = sanitized_command(&self.registration.runtime.path)?;
        command.arg("--version").current_dir(&self.registration.installation_root);
        let live = std::sync::atomic::AtomicBool::new(true);
        let output = run_bounded(command, Vec::new(), ProcessBudget { deadline: std::time::Instant::now() + std::time::Duration::from_secs(10), live: &live, owner_sid: &self.sid })?;
        let version = std::str::from_utf8(&output).map_err(|_| HindsightRefusal::UnsafeInstallation)?.trim();
        if version != self.registration.runtime.version { return Err(HindsightRefusal::UnsafeInstallation); }
        self.objects.validate()
    }
}

fn hold_tree(root: &Path, manifest: &HindsightManifest, objects: &mut HeldObjects) -> Result<(), HindsightRefusal> {
    let mut expected: HashSet<_> = manifest.files.iter().map(|file| local_path(&root.join(&file.path))).collect::<Result<_, _>>()?;
    if expected.len() != manifest.files.len() || !expected.contains(&root.join(&manifest.entrypoint)) { return Err(HindsightRefusal::UnsafeInstallation); }
    expected.insert(root.join("manifest.json"));
    let mut pending = vec![root.to_path_buf()];
    while let Some(directory) = pending.pop() {
        objects.hold(&directory, true)?;
        for entry in std::fs::read_dir(directory).map_err(|_| HindsightRefusal::UnsafeInstallation)? {
            let entry = entry.map_err(|_| HindsightRefusal::UnsafeInstallation)?;
            let kind = entry.file_type().map_err(|_| HindsightRefusal::UnsafeInstallation)?;
            let path = local_path(&entry.path())?;
            if kind.is_symlink() { return Err(HindsightRefusal::UnsafeInstallation); }
            if kind.is_dir() { pending.push(path); }
            else if kind.is_file() && expected.remove(&path) { objects.hold(&path, false)?; }
            else { return Err(HindsightRefusal::UnsafeInstallation); }
        }
    }
    if !expected.is_empty() { return Err(HindsightRefusal::UnsafeInstallation); }
    Ok(())
}
