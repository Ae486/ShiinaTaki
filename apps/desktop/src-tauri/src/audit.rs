//! INPUT:  a gate decision (requestId, capability, closed decision vocabulary)
//! OUTPUT: AuditSink trait + FileAuditor (append one JSONL line) + Decision enum; a test MemoryAuditor
//! POS:    shell/audit — the Shell-owned, agent-unreachable decision trail (D10); NO payload/paths, NO tauri:: types

use std::fs::OpenOptions;
use std::io::Write;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;

/// The closed audit decision vocabulary (D10) — distinguishes auto vs asked, and the fail-closed timeout.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Decision {
    AllowedOnce,
    AllowedSession,
    AllowedAlways,
    Denied,
    AutoAllowed,
    AutoDenied,
    DeniedTimeout,
}

/// One append per gate decision. Records only names — never the input, the image, or a path (logging spec).
pub trait AuditSink: Send + Sync {
    fn record(&self, request_id: &str, capability: &str, decision: Decision);
}

#[derive(Serialize)]
struct AuditLine<'a> {
    ts: String,
    #[serde(rename = "requestId")]
    request_id: &'a str,
    capability: &'a str,
    decision: Decision,
}

/// Appends JSONL to a Shell-owned file (app_data_dir); reopen-per-append, single writer, no locking (D10).
pub struct FileAuditor {
    path: PathBuf,
}

impl FileAuditor {
    pub fn new(path: PathBuf) -> Self {
        Self { path }
    }

    fn try_append(&self, line: &AuditLine) -> std::io::Result<()> {
        let mut serialized = serde_json::to_string(line)?;
        serialized.push('\n');
        let mut file = OpenOptions::new().create(true).append(true).open(&self.path)?;
        file.write_all(serialized.as_bytes())
    }
}

impl AuditSink for FileAuditor {
    fn record(&self, request_id: &str, capability: &str, decision: Decision) {
        let line = AuditLine { ts: iso8601_utc(SystemTime::now()), request_id, capability, decision };
        // A failed append must not crash a gated action; it is a diagnostic event, not a control-flow one.
        if let Err(error) = self.try_append(&line) {
            tracing::error!(error = %error, "failed to append audit line");
        }
    }
}

/// A dependency-free UTC ISO-8601 timestamp (millisecond precision) — no chrono/time crate in the pinned set.
pub(crate) fn iso8601_utc(now: SystemTime) -> String {
    let duration = now.duration_since(UNIX_EPOCH).unwrap_or_default();
    let secs = duration.as_secs();
    let millis = duration.subsec_millis();
    let days = secs / 86_400;
    let tod = secs % 86_400;
    let (hour, minute, second) = (tod / 3600, (tod % 3600) / 60, tod % 60);
    let (year, month, day) = civil_from_days(days as i64);
    format!(
        "{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}.{millis:03}Z"
    )
}

/// Howard Hinnant's days-from-civil, inverted: days since 1970-01-01 -> (year, month, day).
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let year = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let month = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if month <= 2 { year + 1 } else { year }, month, day)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn iso_timestamp_formats_the_unix_epoch() {
        assert_eq!(iso8601_utc(UNIX_EPOCH), "1970-01-01T00:00:00.000Z");
        let one = UNIX_EPOCH + std::time::Duration::from_millis(1_700_000_000_123);
        assert_eq!(iso8601_utc(one), "2023-11-14T22:13:20.123Z");
    }

    #[test]
    fn file_auditor_writes_one_jsonl_line_per_decision() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("audit.jsonl");
        let auditor = FileAuditor::new(path.clone());

        auditor.record("req-1", "screenshot", Decision::AllowedOnce);
        auditor.record("req-2", "screenshot", Decision::DeniedTimeout);

        let contents = std::fs::read_to_string(&path).unwrap();
        let lines: Vec<&str> = contents.lines().collect();
        assert_eq!(lines.len(), 2);

        let first: serde_json::Value = serde_json::from_str(lines[0]).unwrap();
        assert_eq!(first["requestId"], "req-1");
        assert_eq!(first["capability"], "screenshot");
        assert_eq!(first["decision"], "allowed-once");
        assert!(first["ts"].as_str().unwrap().ends_with('Z'));
        // No payload/content ever leaks into the audit trail.
        assert!(first.get("input").is_none());
        assert!(first.get("output").is_none());

        let second: serde_json::Value = serde_json::from_str(lines[1]).unwrap();
        assert_eq!(second["decision"], "denied-timeout");
    }
}
