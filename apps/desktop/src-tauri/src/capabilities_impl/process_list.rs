//! INPUT:  a gate-authorized process-list request (input ignored; whole-system snapshot)
//! OUTPUT: ProcessListExec: a sysinfo snapshot -> ProcessListOutput Value (pid/name/parentPid/memoryBytes/startTime)
//! POS:    shell/capabilities — the process-list capability; reachable ONLY via the gate; read-only by construction (ruling 5)

use serde_json::Value;
use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, System};

use crate::capabilities_impl::{CapabilityExec, ExecError};
use crate::protocol::{ProcessInfo, ProcessListOutput};

const CAPABILITY: &str = "process-list";

/// Snapshots the running processes. Stateless per call (`System::new()`) — matches the stateless screenshot exec (KISS).
/// cmd/argv is deliberately NOT requested (leaks URLs/tokens; keeps the tier Medium — ruling 5). No kill path exists.
pub struct ProcessListExec;

impl CapabilityExec for ProcessListExec {
    fn capability(&self) -> &str {
        CAPABILITY
    }

    fn run(&self, _input: &Value) -> Result<Value, ExecError> {
        let mut system = System::new();
        // remove_dead=true keeps the snapshot clean; only memory is refreshed (pid/name/parent/start_time are free).
        system.refresh_processes_specifics(ProcessesToUpdate::All, true, ProcessRefreshKind::nothing().with_memory());

        let processes: Vec<ProcessInfo> = system
            .processes()
            .iter()
            .map(|(pid, process)| ProcessInfo {
                pid: pid.as_u32(),
                name: process.name().to_string_lossy().into_owned(),
                parent_pid: process.parent().map(|parent| parent.as_u32()),
                memory_bytes: process.memory(),
                start_time: process.start_time(),
            })
            .collect();

        let output = ProcessListOutput { count: processes.len(), processes };
        serde_json::to_value(output).map_err(|error| ExecError::failed(error.to_string()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn snapshot_has_processes_with_expected_fields_and_no_cmd() {
        // T13: the real snapshot must carry pid/name/memoryBytes and MUST NOT leak cmd/argv (ruling 5).
        let output = ProcessListExec.run(&Value::Null).expect("snapshot");
        assert!(output["count"].as_u64().unwrap() > 0, "a running system has processes");
        let first = &output["processes"][0];
        assert!(first.get("pid").is_some());
        assert!(first.get("name").is_some());
        assert!(first.get("memoryBytes").is_some());
        assert!(first.get("startTime").is_some());
        assert!(first.get("cmd").is_none(), "argv must be excluded in v1");
    }
}
