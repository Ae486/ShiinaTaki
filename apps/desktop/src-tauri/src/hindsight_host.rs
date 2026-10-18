//! INPUT:  explicit protected Host installation registration and an internal post-gate invocation context
//! OUTPUT: registered Windows C1 executor; missing/unsafe installation is omitted from the advertised catalog
//! POS:    shell/hindsight_host — no PATH fallback, plain-input authority, Native deployment or receipt production

use std::path::PathBuf;
use serde_json::Value;
use crate::capabilities_impl::{CapabilityExec, ExecError, TrustedHostInvocationContext};
use crate::protocol::{CUSTODY_CAPABILITY, HindsightCustodyResult, HindsightRefusal, parse_hindsight_prepare};

pub(crate) struct HindsightCustodyExec {
    registration_path: PathBuf,
    host_id: String,
    registration_sha256: String,
}

impl HindsightCustodyExec {
    pub(crate) fn registered(registration_path: PathBuf, host_id: &str) -> Option<Self> {
        #[cfg(windows)]
        {
            let installation = crate::hindsight_windows::VerifiedInstallation::open(&registration_path, host_id).ok()?;
            installation.verify_runtime().ok()?;
            Some(Self { registration_path, host_id: host_id.to_string(), registration_sha256: installation.registration_sha256 })
        }
        #[cfg(not(windows))]
        { let _ = (registration_path, host_id); None }
    }
    fn prepare(&self, input: &Value, context: &TrustedHostInvocationContext) -> Result<HindsightCustodyResult, HindsightRefusal> {
        let input = parse_hindsight_prepare(input.clone()).map_err(|_| HindsightRefusal::InputOversize)?;
        #[cfg(windows)]
        {
            let installation = crate::hindsight_windows::VerifiedInstallation::open(&self.registration_path, &self.host_id)?;
            if installation.registration_sha256 != self.registration_sha256 { return Err(HindsightRefusal::SnapshotStale); }
            crate::hindsight_windows::prepare(installation, context, input)
        }
        #[cfg(not(windows))]
        { let _ = (input, context, &self.registration_path, &self.host_id, &self.registration_sha256); Err(HindsightRefusal::UnsupportedInstallation) }
    }
}

impl CapabilityExec for HindsightCustodyExec {
    fn capability(&self) -> &str { CUSTODY_CAPABILITY }
    fn run(&self, _input: &Value) -> Result<Value, ExecError> {
        Err(ExecError::failed("custody requires authenticated Host invocation context"))
    }
    fn run_with_context(&self, input: &Value, context: &TrustedHostInvocationContext) -> Result<Value, ExecError> {
        let result = self.prepare(input, context).unwrap_or_else(HindsightCustodyResult::unavailable);
        serde_json::to_value(result).map_err(|_| ExecError::failed("custody result could not be encoded"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn plain_input_cannot_supply_invocation_authority_or_advertise_missing_installation() {
        let executor = HindsightCustodyExec { registration_path: PathBuf::from("missing"),
            host_id: "untrusted".into(), registration_sha256: "not-installed".into() };
        assert!(executor.run(&serde_json::json!({"trusted":true,"control":{}})).is_err());
        let directory = tempfile::tempdir().unwrap();
        assert!(HindsightCustodyExec::registered(directory.path().join("missing.json"), "untrusted").is_none());
    }
}
