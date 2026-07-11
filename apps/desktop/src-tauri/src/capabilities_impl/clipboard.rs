//! INPUT:  gate-authorized clipboard-read (no input) / clipboard-write ({ text }) requests
//! OUTPUT: ClipboardReadExec -> ClipboardReadOutput Value; ClipboardWriteExec -> ClipboardWriteOutput ack Value
//! POS:    shell/capabilities — the clipboard capabilities (two names, independently gated); reachable ONLY via the gate

use arboard::Clipboard;
use serde_json::Value;

use crate::capabilities_impl::{CapabilityExec, ExecError};
use crate::protocol::{ClipboardReadOutput, ClipboardWriteOutput};

const READ: &str = "clipboard-read";
const WRITE: &str = "clipboard-write";

/// Reads the clipboard text. create-use-drop within the blocking run (the Windows global-clipboard pattern, ruling 6).
pub struct ClipboardReadExec;

impl CapabilityExec for ClipboardReadExec {
    fn capability(&self) -> &str {
        READ
    }

    fn run(&self, _input: &Value) -> Result<Value, ExecError> {
        let mut clipboard = Clipboard::new().map_err(|error| ExecError::failed(error.to_string()))?;
        // An empty clipboard (or one holding no text) is a clean "" success, not a failure (ruling 6).
        let text = match clipboard.get_text() {
            Ok(text) => text,
            Err(arboard::Error::ContentNotAvailable) => String::new(),
            Err(error) => return Err(ExecError::failed(error.to_string())),
        };
        serde_json::to_value(ClipboardReadOutput { text }).map_err(|error| ExecError::failed(error.to_string()))
    }
}

/// Replaces the clipboard text. The input `{ text }` is content — it is written to the OS but never logged.
pub struct ClipboardWriteExec;

impl CapabilityExec for ClipboardWriteExec {
    fn capability(&self) -> &str {
        WRITE
    }

    fn run(&self, input: &Value) -> Result<Value, ExecError> {
        let text = input
            .get("text")
            .and_then(Value::as_str)
            .ok_or_else(|| ExecError::failed("clipboard-write requires a string `text`"))?;
        let mut clipboard = Clipboard::new().map_err(|error| ExecError::failed(error.to_string()))?;
        clipboard.set_text(text).map_err(|error| ExecError::failed(error.to_string()))?;
        serde_json::to_value(ClipboardWriteOutput { ok: true }).map_err(|error| ExecError::failed(error.to_string()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn write_requires_a_string_text() {
        // Pure input validation — needs no real clipboard.
        assert!(ClipboardWriteExec.run(&json!({})).is_err());
        assert!(ClipboardWriteExec.run(&json!({ "text": 42 })).is_err());
    }

    #[test]
    fn set_then_get_round_trips() {
        // T14: a real set→get round-trip on the Shell's clipboard. A headless environment with no clipboard
        // (Clipboard::new / set_text errors) is not a failure of this code — skip rather than flake.
        let unique = format!("taki-clip-{}", std::process::id());
        if ClipboardWriteExec.run(&json!({ "text": unique })).is_err() {
            return;
        }
        let output = ClipboardReadExec.run(&Value::Null).expect("read after a successful write");
        assert_eq!(output["text"], unique);
    }
}
