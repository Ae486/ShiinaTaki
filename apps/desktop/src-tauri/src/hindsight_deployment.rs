//! INPUT:  protected registered C2 owner and the actual post-gate execution context
//! OUTPUT: two registered handlers sharing one resident process/state-lock lifetime
//! POS:    shell/capabilities — Home lifetime and ordinary caller JSON never own deployment authority

use std::path::Path;
use std::sync::{Arc, Mutex};
use serde_json::{json, Value};
use crate::capabilities_impl::{CapabilityExec, ExecError, TrustedHostInvocationContext};
use crate::protocol::{DeploymentInput, DEPLOYMENT_CAPABILITY, DEPLOYMENT_OBSERVE_CAPABILITY,
    parse_deployment_effect, parse_deployment_observe};

pub(crate) struct DeploymentResident {
    #[cfg(windows)]
    owner: Mutex<crate::hindsight_windows::DeploymentInstallation>,
}
impl DeploymentResident {
    pub fn registered(path: &Path, host_id: &str) -> Option<Arc<Self>> {
        #[cfg(windows)]
        { Some(Arc::new(Self { owner: Mutex::new(crate::hindsight_windows::DeploymentInstallation::open(path, host_id).ok()?) })) }
        #[cfg(not(windows))]
        { let _ = (path, host_id); None }
    }
    fn execute(&self, input: DeploymentInput, context: &TrustedHostInvocationContext) -> Value {
        #[cfg(windows)]
        {
            let result = self.owner.try_lock().map_err(|_| crate::protocol::HindsightRefusal::HostUnavailable)
                .and_then(|mut owner| owner.invoke(input, context));
            match result { Ok(status) => status, Err(reason) => json!({"version":1,"state":"unavailable","reason":reason,"deploymentReady":false}) }
        }
        #[cfg(not(windows))]
        { let _ = (self, input, context); json!({"version":1,"state":"unavailable","reason":"unsupported-installation","deploymentReady":false}) }
    }
}
pub(crate) struct HindsightDeploymentExec { pub resident: Arc<DeploymentResident>, pub observe: bool }
impl CapabilityExec for HindsightDeploymentExec {
    fn capability(&self) -> &str { if self.observe { DEPLOYMENT_OBSERVE_CAPABILITY } else { DEPLOYMENT_CAPABILITY } }
    fn run(&self, _input: &Value) -> Result<Value, ExecError> { Err(ExecError::failed("deployment requires authenticated Host context")) }
    fn run_with_context(&self, input: &Value, context: &TrustedHostInvocationContext) -> Result<Value, ExecError> {
        let input = if self.observe { parse_deployment_observe(input.clone()).map(DeploymentInput::Observe) }
            else { parse_deployment_effect(input.clone()).map(Box::new).map(DeploymentInput::Effect) }
            .map_err(|_| ExecError::failed("deployment input refused"))?;
        Ok(self.resident.execute(input, context))
    }
}
