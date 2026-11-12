//! INPUT: actual local observation age and the current Core-negotiated Host/catalog connection
//! OUTPUT: monotonic attachment/report bindings for the existing authenticated Node socket
//! POS: shell/browser_attachment — no buffered tick replay across source or Core connection replacement

use super::Observation;
use crate::browser_playback_protocol::BrowserPlaybackReport;

#[derive(Default)]
pub(crate) struct Forwarder { attachment: Option<String>, generation: u64, sequence: u64 }

impl Forwarder {
    pub(crate) fn frame(&mut self, observation: Option<Observation>, catalog: u64) -> Option<BrowserPlaybackReport> {
        let observation = observation.filter(|value| value.received.elapsed().as_secs_f64() * 1000.0 + value.observed_age_ms < 5_000.0);
        match observation {
            Some(value) => {
                if self.attachment.as_deref() != Some(&value.attachment_id) {
                    self.generation += 1; self.sequence = 0; self.attachment = Some(value.attachment_id.clone());
                }
                self.sequence += 1;
                Some(BrowserPlaybackReport::Sample { schema_version: "taki.browser-playback.v1", catalog_generation: catalog,
                    attachment_id: value.attachment_id, attachment_generation: self.generation, sequence: self.sequence,
                    observed_age_ms: value.received.elapsed().as_secs_f64() * 1000.0 + value.observed_age_ms,
                    source: Box::new(value.source), sample: value.sample })
            },
            None => {
                let attachment_id = self.attachment.take()?;
                self.sequence += 1;
                Some(BrowserPlaybackReport::Retired { schema_version: "taki.browser-playback.v1", catalog_generation: catalog,
                    attachment_id, attachment_generation: self.generation, sequence: self.sequence })
            },
        }
    }
}
