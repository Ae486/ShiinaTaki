//! INPUT: selected extension playback frames and Core privacy control
//! OUTPUT: strict serde mirrors of shared/browser-playback-schema.ts plus finite/identity validation
//! POS: shell/protocol — data contracts only; no credentials in report/control frames and no consent inference

use serde::{Deserialize, Deserializer, Serialize};

const MAX_SAFE: u64 = 9_007_199_254_740_991;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct BrowserMediaIdentity {
    pub kind: String,
    pub bvid: String,
    pub cid: String,
    pub page: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct BrowserPlayerIdentity {
    pub tab_id: u64,
    pub frame_id: u64,
    pub document_id: String,
    pub player_id: String,
    pub media: BrowserMediaIdentity,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub(crate) enum BrowserPlaybackState { Playing, Paused, Buffering, Seeking, Ended }

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct BrowserPlaybackSample {
    pub state: BrowserPlaybackState,
    #[serde(deserialize_with = "required_nullable")]
    pub position_seconds: Option<f64>,
    #[serde(deserialize_with = "required_nullable")]
    pub duration_seconds: Option<f64>,
    #[serde(deserialize_with = "required_nullable")]
    pub playback_rate: Option<f64>,
    pub visible: bool,
    pub picture_in_picture: bool,
}

fn required_nullable<'de, D, T>(deserializer: D) -> Result<Option<T>, D::Error>
where D: Deserializer<'de>, T: Deserialize<'de> { Option::<T>::deserialize(deserializer) }

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase", deny_unknown_fields)]
pub(crate) enum BrowserAttachmentFrame {
    Sample {
        sequence: u64,
        source: Box<BrowserPlayerIdentity>,
        sample: BrowserPlaybackSample,
        #[serde(rename = "observedAgeMs")]
        observed_age_ms: f64,
    },
    Retired { sequence: u64 },
}

impl BrowserAttachmentFrame {
    pub(crate) fn sequence(&self) -> u64 { match self { Self::Sample { sequence, .. } | Self::Retired { sequence } => *sequence } }
    pub(crate) fn validate(&self) -> bool {
        if self.sequence() == 0 || self.sequence() > MAX_SAFE { return false; }
        match self {
            Self::Sample { source, sample, observed_age_ms, .. } => source.validate() && sample.validate()
                && observed_age_ms.is_finite() && (0.0..=30_000.0).contains(observed_age_ms),
            Self::Retired { .. } => true,
        }
    }
}

impl BrowserPlayerIdentity {
    pub(crate) fn validate(&self) -> bool {
        let media = &self.media;
        self.tab_id <= MAX_SAFE && self.frame_id <= MAX_SAFE && valid_document_id(&self.document_id) && valid_uuid(&self.player_id)
            && media.kind == "bilibili" && media.bvid.len() == 12 && media.bvid.starts_with("BV")
            && media.bvid.bytes().all(|value| value.is_ascii_alphanumeric())
            && !media.cid.is_empty() && media.cid.len() <= 20 && !media.cid.starts_with('0')
            && media.cid.bytes().all(|value| value.is_ascii_digit()) && media.page > 0 && media.page <= MAX_SAFE
    }
}

impl BrowserPlaybackSample {
    pub(crate) fn validate(&self) -> bool {
        self.position_seconds.is_none_or(|value| value.is_finite() && value >= 0.0)
            && self.duration_seconds.is_none_or(|value| value.is_finite() && value >= 0.0)
            && self.playback_rate.is_none_or(|value| value.is_finite() && value > 0.0)
            && self.position_seconds.zip(self.duration_seconds).is_none_or(|(position, duration)| position <= duration)
    }
}

pub(crate) fn valid_uuid(value: &str) -> bool {
    value.len() == 36 && uuid::Uuid::parse_str(value).is_ok_and(|id| id.hyphenated().to_string().eq_ignore_ascii_case(value))
}

// Browser document tokens are opaque identifiers, not extension-minted RFC UUIDs.
// Keep the original token and the existing UUID representation; never change player/Host validation.
fn valid_document_id(value: &str) -> bool {
    (value.len() == 32 && value.bytes().all(|byte| byte.is_ascii_hexdigit())) || valid_uuid(value)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct BrowserPlaybackControl {
    pub schema_version: String,
    pub host_id: String,
    pub connection_generation: u64,
    pub catalog_generation: u64,
    pub revision: u64,
    pub enabled: bool,
}

impl BrowserPlaybackControl {
    pub(crate) fn matches(&self, host_id: &str, connection: u64, catalog: u64, revision: u64) -> bool {
        self.schema_version == "taki.browser-playback-control.v1" && self.host_id == host_id
            && self.connection_generation == connection && self.catalog_generation == catalog
            && self.revision > revision && self.revision <= MAX_SAFE
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub(crate) enum BrowserPlaybackReport {
    Sample {
        #[serde(rename = "schemaVersion")] schema_version: &'static str,
        #[serde(rename = "catalogGeneration")] catalog_generation: u64,
        #[serde(rename = "attachmentId")] attachment_id: String,
        #[serde(rename = "attachmentGeneration")] attachment_generation: u64,
        sequence: u64, source: Box<BrowserPlayerIdentity>, sample: BrowserPlaybackSample,
        #[serde(rename = "observedAgeMs")] observed_age_ms: f64,
    },
    Retired {
        #[serde(rename = "schemaVersion")] schema_version: &'static str,
        #[serde(rename = "catalogGeneration")] catalog_generation: u64,
        #[serde(rename = "attachmentId")] attachment_id: String,
        #[serde(rename = "attachmentGeneration")] attachment_generation: u64,
        sequence: u64,
    },
}
