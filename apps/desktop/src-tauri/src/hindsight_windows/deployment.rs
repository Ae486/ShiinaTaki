//! INPUT:  C1 protected installation, C2 registration and authenticated post-gate context
//! OUTPUT: exclusive mutable-state lifetime, hidden resident and current-session checkpoint relay
//! POS:    shell/hindsight_windows — keeps OS protection live across effects and original-resource observation

use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;
use std::time::{Duration, Instant};
use serde_json::Value;
use sha2::{Digest, Sha256};
use crate::capabilities_impl::TrustedHostInvocationContext;
use crate::protocol::{DeploymentInput, DeploymentInvocation, DeploymentRegistration, HindsightOwner, HindsightRefusal,
    CUSTODY_REQUEST_BYTES, parse_deployment_checkpoint, parse_deployment_registration, parse_deployment_status, parse_timestamp};
use super::catalog::CatalogSnapshot;
use super::installation::VerifiedInstallation;
use super::objects::{HeldObject, local_path, open_catalog_object, open_state_lock};
use super::process::sanitized_command;
use super::resident::ResidentProcess;

pub(crate) struct DeploymentInstallation {
    installation: VerifiedInstallation, registration: DeploymentRegistration, registration_path: PathBuf,
    registration_sha256: String, state_root: PathBuf, _lock: HeldObject, process: Option<ResidentProcess>,
}
impl Drop for DeploymentInstallation {
    fn drop(&mut self) {
        // Field-order destruction would release the installation guards and writer lock first.
        // Reap the helper, its Job and pipe readers before another owner can acquire that lock.
        drop(self.process.take());
    }
}
impl DeploymentInstallation {
    pub fn open(path: &Path, host_id: &str) -> Result<Self, HindsightRefusal> {
        let mut installation = VerifiedInstallation::open(path, host_id)?;
        installation.verify_runtime()?;
        let registration_path = installation.registration_path.parent().ok_or(HindsightRefusal::UnsafeInstallation)?.join("deployment-registration.json");
        installation.objects.hold(&registration_path, false)?;
        let bytes = installation.objects.read(&registration_path, CUSTODY_REQUEST_BYTES)?;
        let registration_sha256 = format!("{:x}", Sha256::digest(&bytes));
        let registration = parse_deployment_registration(serde_json::from_slice(&bytes).map_err(|_| HindsightRefusal::UnsafeInstallation)?)
            .map_err(|_| HindsightRefusal::UnsafeInstallation)?;
        let c1 = &installation.registration;
        if registration.execution_host_id != c1.execution_host_id || registration.core_host_id != c1.core_host_id
            || registration.installation_id != c1.installation_id { return Err(HindsightRefusal::UnsafeInstallation); }
        let docker = local_path(Path::new(&registration.docker.path))?;
        installation.objects.hold(&docker, false)?;
        if installation.objects.digest(&docker)? != registration.docker.sha256 { return Err(HindsightRefusal::UnsafeInstallation); }
        let state_root = local_path(Path::new(&registration.state_directory))?;
        if state_root.starts_with(local_path(Path::new(&c1.installation_root))?) { return Err(HindsightRefusal::UnsafeInstallation); }
        installation.objects.hold_catalog_directory(&state_root)?;
        installation.objects.hold(&state_root.join("docker-config"), true)?;
        let lock = open_state_lock(&state_root.join("deployment.lock"), &installation.sid)?;
        let result = Self { installation, registration, registration_path, registration_sha256, state_root, _lock: lock, process: None };
        result.validate()?;
        Ok(result)
    }

    fn validate(&self) -> Result<(), HindsightRefusal> {
        self.installation.objects.validate()?;
        if std::fs::read_dir(self.state_root.join("docker-config")).map_err(|_| HindsightRefusal::UnsafeInstallation)?.next().is_some() {
            return Err(HindsightRefusal::UnsafeInstallation);
        }
        let registry = open_catalog_object(&self.state_root.join("deployment.json"), &self.installation.sid)?;
        if registry.file.metadata().map_err(|_| HindsightRefusal::UnsafeInstallation)?.len() > 1024 * 1024 { return Err(HindsightRefusal::InputOversize); }
        Ok(())
    }

    pub fn invoke(&mut self, input: DeploymentInput, context: &TrustedHostInvocationContext) -> Result<Value, HindsightRefusal> {
        self.validate()?;
        let remaining = parse_timestamp(&context.control.deadline_at).map_err(|_| HindsightRefusal::SnapshotStale)? - time::OffsetDateTime::now_utc();
        let budget = Duration::try_from(remaining).map_err(|_| HindsightRefusal::SnapshotStale)?;
        if budget > Duration::from_secs(90) || !context.live.load(Ordering::Acquire) { return Err(HindsightRefusal::SnapshotStale); }
        let deadline = Instant::now() + budget;
        let catalog = if let DeploymentInput::Effect(effect) = &input {
            if effect.plan.deployment_registration_sha256 != self.registration_sha256 || effect.plan.image_id != self.registration.image.id
                || effect.plan.engine_id != self.registration.docker.engine_id { return Err(HindsightRefusal::SnapshotStale); }
            Some(CatalogSnapshot::open(&mut self.installation.objects, Path::new(&self.installation.registration.core_data_directory),
                &self.installation.sid, &effect.custody.input.sealed_envelope_sha256)?)
        } else { None };
        let invocation = DeploymentInvocation { version: 1, request_id: context.request_id.clone(), control: context.control.clone(),
            authorization: context.authorization.clone(), input,
            owner: HindsightOwner::WindowsToken { token_user_sha256: format!("{:x}", Sha256::digest(&self.installation.sid)) } };
        invocation.validate().map_err(|_| HindsightRefusal::SnapshotStale)?;
        if self.process.as_mut().is_none_or(|process| !process.alive()) {
            self.process.take();
            let c1 = &self.installation.registration;
            let mut command = sanitized_command(&c1.runtime.path)?;
            command.current_dir(&c1.installation_root).arg(Path::new(&c1.installation_root).join("app/main.js"))
                .arg("deployment-host").arg("--registration").arg(&self.installation.registration_path)
                .arg("--deployment-registration").arg(&self.registration_path);
            self.process = Some(ResidentProcess::start(command, &self.installation.sid)?);
        }
        let result = self.exchange(&invocation, context, deadline, catalog.as_ref());
        if result.is_err() { self.process.take(); }
        result
    }

    fn exchange(&mut self, invocation: &DeploymentInvocation, context: &TrustedHostInvocationContext,
        deadline: Instant, catalog: Option<&CatalogSnapshot>) -> Result<Value, HindsightRefusal> {
        let bytes = serde_json::to_vec(invocation).map_err(|_| HindsightRefusal::InputOversize)?;
        self.process.as_mut().ok_or(HindsightRefusal::OutcomeUnknown)?.send(bytes, deadline, &context.live)?;
        let mut checkpoint_used = false;
        loop {
            let bytes = self.process.as_mut().ok_or(HindsightRefusal::OutcomeUnknown)?.receive(deadline, &context.live)?;
            let value: Value = serde_json::from_slice(&bytes).map_err(|_| HindsightRefusal::OutcomeUnknown)?;
            self.validate()?;
            if let Some(catalog) = catalog { catalog.validate(&self.installation.sid)?; }
            if value.get("kind").and_then(Value::as_str) == Some("checkpoint") && !checkpoint_used {
                require_keys(&value, &["kind", "checkpoint"])?;
                let checkpoint = parse_deployment_checkpoint(value["checkpoint"].clone()).map_err(|_| HindsightRefusal::SnapshotStale)?;
                if checkpoint.request_id != invocation.request_id || checkpoint.control != invocation.control
                    || serde_json::to_value(&checkpoint.authorization).ok() != serde_json::to_value(&invocation.authorization).ok() {
                    return Err(HindsightRefusal::SnapshotStale);
                }
                checkpoint_used = true;
                let answer = context.checkpoint.as_ref().ok_or(HindsightRefusal::SnapshotStale)?(checkpoint)?;
                self.validate()?;
                if let Some(catalog) = catalog { catalog.validate(&self.installation.sid)?; }
                let bytes = serde_json::to_vec(&answer).map_err(|_| HindsightRefusal::InputOversize)?;
                self.process.as_mut().ok_or(HindsightRefusal::OutcomeUnknown)?.send(bytes, deadline, &context.live)?;
            } else {
                require_keys(&value, &["kind", "requestId", "status"])?;
                if value["kind"] != "result" || value["requestId"] != invocation.request_id { return Err(HindsightRefusal::OutcomeUnknown); }
                let status = parse_deployment_status(value["status"].clone()).map_err(|_| HindsightRefusal::OutcomeUnknown)?;
                return serde_json::to_value(status).map_err(|_| HindsightRefusal::OutcomeUnknown);
            }
        }
    }
}
fn require_keys(value: &Value, names: &[&str]) -> Result<(), HindsightRefusal> {
    if !value.as_object().is_some_and(|object| object.len() == names.len() && names.iter().all(|name| object.contains_key(*name))) {
        return Err(HindsightRefusal::OutcomeUnknown);
    }
    Ok(())
}
