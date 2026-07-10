//! INPUT:  a gate-authorized screenshot request (input ignored; primary monitor, v1)
//! OUTPUT: ScreenshotExec: xcap capture -> PNG -> base64 CapabilityOutput
//! POS:    shell/capabilities — the screenshot capability; reachable ONLY via the gate; blocking (run off-reactor)

use std::io::Cursor;

use serde_json::Value;
use xcap::Monitor;

use crate::capabilities_impl::{CapabilityExec, ExecError};
use crate::protocol::CapabilityOutput;

const CAPABILITY: &str = "screenshot";

/// Captures the primary monitor via xcap and returns a base64 PNG. The core persists it (invariant 2).
pub struct ScreenshotExec;

impl CapabilityExec for ScreenshotExec {
    fn capability(&self) -> &str {
        CAPABILITY
    }

    fn run(&self, _input: &Value) -> Result<CapabilityOutput, ExecError> {
        let monitor = primary_monitor()?;
        let image = monitor.capture_image().map_err(|error| ExecError::failed(error.to_string()))?;
        let (width, height) = (image.width(), image.height());

        let mut png = Cursor::new(Vec::new());
        image
            .write_to(&mut png, xcap::image::ImageFormat::Png)
            .map_err(|error| ExecError::failed(error.to_string()))?;

        Ok(CapabilityOutput {
            media_type: "image/png".to_string(),
            data_base64: base64_encode(png.get_ref()),
            width,
            height,
        })
    }
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
    use super::base64_encode;

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
