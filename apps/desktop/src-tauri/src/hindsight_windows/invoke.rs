//! INPUT:  retained installation and the actual authenticated Host request/control/authorization tuple
//! OUTPUT: non-secret prepared/unavailable result for the original snapshot; never deployment authority
//! POS:    shell/hindsight_windows — stdin is private control, stdout is bounded status, key reads stay in helper

use std::sync::atomic::Ordering;
use std::time::{Duration, Instant};
use sha2::{Digest, Sha256};
use crate::capabilities_impl::TrustedHostInvocationContext;
use crate::protocol::{CUSTODY_REQUEST_BYTES, HindsightCustodyResult, HindsightInvocation, HindsightOwner,
    HindsightPrepare, HindsightRefusal, parse_hindsight_result, parse_timestamp};
use super::installation::VerifiedInstallation;
use super::catalog::CatalogSnapshot;
use super::process::{ProcessBudget, run_bounded, sanitized_command};

pub(crate) fn prepare(mut installation: VerifiedInstallation, context: &TrustedHostInvocationContext, input: HindsightPrepare) -> Result<HindsightCustodyResult, HindsightRefusal> {
    let deadline = parse_timestamp(&context.control.deadline_at).map_err(|_| HindsightRefusal::SnapshotStale)?;
    let remaining = deadline - time::OffsetDateTime::now_utc();
    if remaining.is_negative() || !context.live.load(Ordering::Acquire) { return Err(HindsightRefusal::SnapshotStale); }
    let budget = Duration::try_from(remaining).map_err(|_| HindsightRefusal::SnapshotStale)?;
    // The control is never allowed to extend the fixed C1 host budget, including for a directly constructed test frame.
    if budget > Duration::from_secs(90) { return Err(HindsightRefusal::SnapshotStale); }
    let execution_deadline = Instant::now() + budget;
    let registered = &installation.registration;
    if context.control.target_host_id != registered.execution_host_id || input.core_host_id != registered.core_host_id
        || input.catalog_store_id != registered.catalog_store_id || input.catalog_key_version != registered.catalog_key_version
        || input.installation_id != registered.installation_id { return Err(HindsightRefusal::SnapshotStale); }
    let invocation = HindsightInvocation { version: 1, request_id: context.request_id.clone(), control: context.control.clone(),
        authorization: context.authorization.clone(), input,
        owner: HindsightOwner::WindowsToken { token_user_sha256: format!("{:x}", Sha256::digest(&installation.sid)) } };
    invocation.validate().map_err(|_| HindsightRefusal::SnapshotStale)?;
    let bytes = serde_json::to_vec(&invocation).map_err(|_| HindsightRefusal::InputOversize)?;
    if bytes.len() > CUSTODY_REQUEST_BYTES { return Err(HindsightRefusal::InputOversize); }
    let catalog = CatalogSnapshot::open(&mut installation.objects, std::path::Path::new(&registered.core_data_directory),
        &installation.sid, &invocation.input.sealed_envelope_sha256)?;
    installation.objects.validate()?;
    let mut command = sanitized_command(&registered.runtime.path)?;
    command.current_dir(&registered.installation_root).arg(std::path::Path::new(&registered.installation_root).join("app/main.js"))
        .arg("prepare").arg("--registration").arg(&installation.registration_path);
    let output = run_bounded(command, bytes, ProcessBudget { deadline: execution_deadline, live: &context.live, owner_sid: &installation.sid })?;
    installation.objects.validate()?;
    catalog.validate(&installation.sid)?;
    let value = serde_json::from_slice(&output).map_err(|_| HindsightRefusal::OutcomeUnknown)?;
    let result = parse_hindsight_result(value).map_err(|_| HindsightRefusal::OutcomeUnknown)?;
    if let HindsightCustodyResult::Prepared { snapshot_id, request_id, host_attempt_id, installation_id,
        sealed_envelope_sha256, configuration_digest, .. } = &result {
        if snapshot_id != &invocation.input.snapshot_id || request_id != &context.request_id || host_attempt_id != &context.control.attempt_id
            || installation_id != &registered.installation_id || sealed_envelope_sha256 != &invocation.input.sealed_envelope_sha256
            || configuration_digest != &invocation.input.configuration_digest { return Err(HindsightRefusal::SnapshotStale); }
    }
    Ok(result)
}
