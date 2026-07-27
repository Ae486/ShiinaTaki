//! INPUT:  a gate-authorized screenshot / screenshot-ambient request (input ignored; primary monitor, v1)
//! OUTPUT: ScreenshotExec + ScreenshotAmbientExec: xcap capture -> PNG -> base64 ScreenshotOutput Value
//! POS:    shell/capabilities — the two screen-capture capabilities (one on-demand, one ambient) sharing ONE capture
//!         implementation but NOT one grant; reachable ONLY via the gate; blocking (run off-reactor)

use std::io::Cursor;

use serde_json::Value;
use xcap::Monitor;

use crate::capabilities_impl::{CapabilityExec, ExecError};
use crate::protocol::ScreenshotOutput;

const CAPABILITY: &str = "screenshot";
const AMBIENT_CAPABILITY: &str = "screenshot-ambient";

/// Captures the primary monitor via xcap and returns a base64 PNG. The core persists it (invariant 2).
pub struct ScreenshotExec;

impl CapabilityExec for ScreenshotExec {
    fn capability(&self) -> &str {
        CAPABILITY
    }

    fn run(&self, _input: &Value) -> Result<Value, ExecError> {
        capture_primary_monitor()
    }
}

/// The AMBIENT screen sample (T3b): the SAME pixels, a DELIBERATELY DIFFERENT capability name — so its grant (gate
/// cell + decision memory) is separate from the on-demand `screenshot` one. A user's "always allow screenshot" must
/// never silently authorize perpetual background capture (the A1-class escalation T2b exists to prevent); the risk
/// profiles differ completely (a user-present single frame vs whatever happens to be on screen, forever).
/// Capture logic is delegated, never duplicated — the two names differ in governance, not in behaviour.
pub struct ScreenshotAmbientExec;

impl CapabilityExec for ScreenshotAmbientExec {
    fn capability(&self) -> &str {
        AMBIENT_CAPABILITY
    }

    fn run(&self, _input: &Value) -> Result<Value, ExecError> {
        capture_primary_monitor()
    }

    // Dialog-only disclosure (NEVER logged): this dialog IS the informed-consent surface for ambient capture, so it
    // must say that capture REPEATS in the background — a name-only "screenshot-ambient?" prompt would understate it.
    fn detail(&self, _input: &Value) -> Option<String> {
        Some("periodically captures your screen in the background while ambient sensing stays on".to_string())
    }
}

/// The one capture implementation both capabilities run.
fn capture_primary_monitor() -> Result<Value, ExecError> {
    let monitor = primary_monitor()?;
    let image = monitor.capture_image().map_err(|error| ExecError::failed(error.to_string()))?;
    let (width, height) = (image.width(), image.height());
    // Dimensions only — the pixels/base64 are content and never enter a log (R4).
    tracing::info!(width, height, "screenshot captured");

    let mut png = Cursor::new(Vec::new());
    image
        .write_to(&mut png, xcap::image::ImageFormat::Png)
        .map_err(|error| ExecError::failed(error.to_string()))?;

    let output = ScreenshotOutput {
        media_type: "image/png".to_string(),
        data_base64: base64_encode(png.get_ref()),
        width,
        height,
    };
    serde_json::to_value(output).map_err(|error| ExecError::failed(error.to_string()))
}

// The primary monitor, or the first available if none reports primary (a headless/odd setup still degrades to a shot).
fn primary_monitor() -> Result<Monitor, ExecError> {
    let monitors = Monitor::all().map_err(|error| ExecError::failed(error.to_string()))?;
    monitors
        .iter()
        .find(|monitor| monitor.is_primary().unwrap_or(false))
        .or_else(|| monitors.first())
        .cloned()
        .ok_or_else(|| ExecError::failed("no monitor available"))
}

const B64: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

// Standard base64 (with padding). Hand-rolled to avoid a dep outside the pinned set; encode-only, the core decodes.
fn base64_encode(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = *chunk.get(1).unwrap_or(&0) as u32;
        let b2 = *chunk.get(2).unwrap_or(&0) as u32;
        let n = (b0 << 16) | (b1 << 8) | b2;
        out.push(B64[(n >> 18) as usize & 63] as char);
        out.push(B64[(n >> 12) as usize & 63] as char);
        out.push(if chunk.len() > 1 { B64[(n >> 6) as usize & 63] as char } else { '=' });
        out.push(if chunk.len() > 2 { B64[n as usize & 63] as char } else { '=' });
    }
    out
}

#[cfg(test)]
mod tests {
    use super::{base64_encode, ScreenshotAmbientExec, ScreenshotExec};
    use crate::capabilities_impl::CapabilityExec;
    use serde_json::Value;

    #[test]
    fn ambient_capture_is_a_distinct_capability_name() {
        // The whole point of the ambient split: two names => two gate cells => two independent grants. RED if the
        // ambient exec ever reports "screenshot" (an always-allow on chat screenshots would then cover it).
        assert_eq!(ScreenshotAmbientExec.capability(), "screenshot-ambient");
        assert_ne!(ScreenshotAmbientExec.capability(), ScreenshotExec.capability());
    }

    #[test]
    fn the_ambient_dialog_detail_discloses_repeated_background_capture() {
        let detail = ScreenshotAmbientExec.detail(&Value::Null).expect("a disclosure line");
        assert!(detail.contains("periodically"), "the grant must disclose that capture repeats");
        assert!(detail.contains("background"));
        // The on-demand capture keeps its name-only dialog (a user-present, in-the-moment consent).
        assert_eq!(ScreenshotExec.detail(&Value::Null), None);
    }

    #[test]
    fn base64_matches_known_vectors() {
        // RFC 4648 test vectors — proves the encoder is byte-faithful (the core decodes these).
        assert_eq!(base64_encode(b""), "");
        assert_eq!(base64_encode(b"f"), "Zg==");
        assert_eq!(base64_encode(b"fo"), "Zm8=");
        assert_eq!(base64_encode(b"foo"), "Zm9v");
        assert_eq!(base64_encode(b"foob"), "Zm9vYg==");
        assert_eq!(base64_encode(b"fooba"), "Zm9vYmE=");
        assert_eq!(base64_encode(b"foobar"), "Zm9vYmFy");
    }
}
