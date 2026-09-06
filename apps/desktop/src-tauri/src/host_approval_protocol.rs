//! INPUT:  Host challenge/resume JSON plus immutable HostOperationControl and trusted governance evidence
//! OUTPUT: protocol-v3 Approval DTOs with optional command disclosure, canonical bytes and SHA-256 helpers
//! POS:    shell/protocol — nested Core authorization contract; raw capability input is deliberately absent

use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use time::{format_description::well_known::Rfc3339, OffsetDateTime};
use uuid::{Variant, Version, Uuid};

use super::host_control_protocol::{HostGovernanceEvidence, HostGovernanceProjection, HostOperationControl};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct HostChallengePresentationField {
    pub label: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct HostChallengePresentationSection {
    pub title: String,
    pub fields: Vec<HostChallengePresentationField>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct HostCommandDisclosure {
    pub revision: u64,
    pub complete: bool,
    pub encoding: String,
    pub reconstruction: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct HostChallengePresentation {
    pub revision: u64,
    pub title: String,
    #[serde(rename = "capabilityLabel")]
    pub capability_label: String,
    #[serde(rename = "subjectLabel", skip_serializing_if = "Option::is_none")]
    pub subject_label: Option<String>,
    #[serde(rename = "riskSummary")]
    pub risk_summary: String,
    pub sections: Vec<HostChallengePresentationSection>,
    #[serde(rename = "commandDisclosure", default, skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_command_disclosure")]
    pub command_disclosure: Option<HostCommandDisclosure>,
}

fn deserialize_command_disclosure<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<HostCommandDisclosure>, D::Error> {
    // Missing is legacy-compatible; explicit null is not the Shared optional-object contract.
    HostCommandDisclosure::deserialize(deserializer).map(Some)
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum CapabilityDecisionScope {
    Once,
    Session,
    Always,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct CapabilityAuthorization {
    #[serde(rename = "authorizationId")]
    pub authorization_id: String,
    #[serde(rename = "approvalGeneration")]
    pub approval_generation: u64,
    #[serde(rename = "decisionScope")]
    pub decision_scope: CapabilityDecisionScope,
    #[serde(rename = "controlDigest")]
    pub control_digest: String,
    #[serde(rename = "challengeDigest")]
    pub challenge_digest: String,
    #[serde(rename = "decisionScopeDigest")]
    pub decision_scope_digest: String,
    #[serde(rename = "issuedAt")]
    pub issued_at: String,
    #[serde(rename = "expiresAt")]
    pub expires_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct CapabilityChallenge {
    #[serde(rename = "requestId")]
    pub request_id: String,
    pub control: HostOperationControl,
    #[serde(rename = "challengeId")]
    pub challenge_id: String,
    #[serde(rename = "controlDigest")]
    pub control_digest: String,
    #[serde(rename = "challengeDigest")]
    pub challenge_digest: String,
    #[serde(rename = "decisionScopeDigest")]
    pub decision_scope_digest: String,
    pub governance: HostGovernanceEvidence,
    pub presentation: HostChallengePresentation,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct CapabilityResume {
    #[serde(rename = "requestId")]
    pub request_id: String,
    pub control: HostOperationControl,
    #[serde(rename = "challengeId")]
    pub challenge_id: String,
    pub authorization: CapabilityAuthorization,
}

pub fn parse_capability_challenge(value: Value) -> Result<CapabilityChallenge, String> {
    let challenge: CapabilityChallenge = serde_json::from_value(value).map_err(|error| error.to_string())?;
    validate_challenge(&challenge)?;
    Ok(challenge)
}

pub fn parse_capability_resume(value: Value) -> Result<CapabilityResume, String> {
    let resume: CapabilityResume = serde_json::from_value(value).map_err(|error| error.to_string())?;
    validate_control(&resume.control)?;
    validate_uuid(&resume.request_id)?;
    validate_uuid(&resume.challenge_id)?;
    validate_authorization(&resume.authorization)?;
    Ok(resume)
}

pub fn control_digest(control: &HostOperationControl) -> Result<String, String> {
    let canonical = canonical_control(control)?;
    Ok(format!("{:x}", Sha256::digest(canonical.as_bytes())))
}

pub fn challenge_digest(challenge: &CapabilityChallenge) -> Result<String, String> {
    let canonical = canonical_challenge(challenge)?;
    Ok(format!("{:x}", Sha256::digest(canonical.as_bytes())))
}

/// Canonical remembered-scope digest over the trusted classification identity. Mirrors
/// `canonicalApprovalDecisionScope` in @taki/shared: same domain, revision, field order, and
/// SHA-256, with no raw input, display label, or sensitive classifier payload.
pub fn approval_decision_scope_digest(
    capability_id: &str,
    owner_host_id: &str,
    descriptor_revision: u64,
    classifier_id: &str,
    classifier_revision: u64,
    cell_key: &str,
) -> String {
    #[derive(Serialize)]
    struct Identity<'a> {
        #[serde(rename = "capabilityId")]
        capability_id: &'a str,
        #[serde(rename = "ownerHostId")]
        owner_host_id: &'a str,
    }
    #[derive(Serialize)]
    struct Canonical<'a> {
        domain: &'static str,
        revision: u64,
        identity: Identity<'a>,
        #[serde(rename = "descriptorRevision")]
        descriptor_revision: u64,
        #[serde(rename = "classifierId")]
        classifier_id: &'a str,
        #[serde(rename = "classifierRevision")]
        classifier_revision: u64,
        #[serde(rename = "cellKey")]
        cell_key: &'a str,
    }
    let canonical = Canonical {
        domain: "taki.approval.decision-scope",
        revision: 1,
        identity: Identity { capability_id, owner_host_id },
        descriptor_revision,
        classifier_id,
        classifier_revision,
        cell_key,
    };
    let bytes = serde_json::to_vec(&canonical).expect("canonical decision scope serializes");
    format!("{:x}", Sha256::digest(bytes))
}

fn canonical_control(control: &HostOperationControl) -> Result<String, String> {
    // Keep this byte shape aligned with shared/src/host-approval-schema.ts. Core-owned correlation fields are
    // deliberately excluded from the Host authorization digest: they identify the enclosing lifecycle record but
    // are not part of the Host-local operation authority lineage.
    #[derive(Serialize)]
    struct CanonicalControl<'a> {
        #[serde(rename = "runId")]
        run_id: &'a str,
        #[serde(rename = "operationId")]
        operation_id: &'a str,
        #[serde(rename = "attemptId")]
        attempt_id: &'a str,
        #[serde(rename = "targetHostId")]
        target_host_id: &'a str,
        #[serde(rename = "connectionGeneration")]
        connection_generation: u64,
        #[serde(rename = "catalogGeneration")]
        catalog_generation: u64,
        #[serde(rename = "policyGeneration")]
        policy_generation: u64,
        #[serde(rename = "governanceProjection")]
        governance_projection: &'a HostGovernanceProjection,
        #[serde(rename = "approvalGeneration")]
        approval_generation: u64,
        #[serde(rename = "capabilityId")]
        capability_id: &'a str,
        #[serde(rename = "inputDigest")]
        input_digest: &'a str,
        #[serde(rename = "idempotencyKey")]
        idempotency_key: &'a str,
        #[serde(rename = "dispatchedAt")]
        dispatched_at: &'a str,
        #[serde(rename = "deadlineAt")]
        deadline_at: &'a str,
        #[serde(rename = "expiresAt", skip_serializing_if = "Option::is_none")]
        expires_at: &'a Option<String>,
    }
    #[derive(Serialize)]
    struct Canonical<'a> {
        domain: &'static str,
        revision: u64,
        control: CanonicalControl<'a>,
    }
    serde_json::to_string(&Canonical {
        domain: "taki.host.operation-control",
        revision: 1,
        control: CanonicalControl {
            run_id: &control.run_id,
            operation_id: &control.operation_id,
            attempt_id: &control.attempt_id,
            target_host_id: &control.target_host_id,
            connection_generation: control.connection_generation,
            catalog_generation: control.catalog_generation,
            policy_generation: control.policy_generation,
            governance_projection: &control.governance_projection,
            approval_generation: control.approval_generation,
            capability_id: &control.capability_id,
            input_digest: &control.input_digest,
            idempotency_key: &control.idempotency_key,
            dispatched_at: &control.dispatched_at,
            deadline_at: &control.deadline_at,
            expires_at: &control.expires_at,
        },
    })
    .map_err(|error| error.to_string())
}

fn canonical_challenge(challenge: &CapabilityChallenge) -> Result<String, String> {
    #[derive(Serialize)]
    struct Canonical<'a> {
        domain: &'static str,
        revision: u64,
        #[serde(rename = "requestId")]
        request_id: &'a str,
        #[serde(rename = "challengeId")]
        challenge_id: &'a str,
        #[serde(rename = "controlDigest")]
        control_digest: &'a str,
        #[serde(rename = "decisionScopeDigest")]
        decision_scope_digest: &'a str,
        governance: &'a HostGovernanceEvidence,
        presentation: &'a HostChallengePresentation,
    }
    serde_json::to_string(&Canonical {
        domain: "taki.host.capability-challenge",
        revision: 1,
        request_id: &challenge.request_id,
        challenge_id: &challenge.challenge_id,
        control_digest: &challenge.control_digest,
        decision_scope_digest: &challenge.decision_scope_digest,
        governance: &challenge.governance,
        presentation: &challenge.presentation,
    })
    .map_err(|error| error.to_string())
}

fn validate_challenge(challenge: &CapabilityChallenge) -> Result<(), String> {
    validate_control(&challenge.control)?;
    validate_uuid(&challenge.request_id)?;
    validate_uuid(&challenge.challenge_id)?;
    validate_sha(&challenge.control_digest)?;
    validate_sha(&challenge.challenge_digest)?;
    validate_sha(&challenge.decision_scope_digest)?;
    validate_presentation(&challenge.presentation)?;
    if control_digest(&challenge.control)? != challenge.control_digest {
        return Err("Host control digest mismatch".into());
    }
    if challenge_digest(challenge)? != challenge.challenge_digest {
        return Err("Host challenge digest mismatch".into());
    }
    Ok(())
}

fn validate_authorization(value: &CapabilityAuthorization) -> Result<(), String> {
    validate_uuid(&value.authorization_id)?;
    if value.approval_generation == 0 {
        return Err("approvalGeneration must be positive".into());
    }
    validate_sha(&value.control_digest)?;
    validate_sha(&value.challenge_digest)?;
    validate_sha(&value.decision_scope_digest)?;
    let issued_at = parse_timestamp(&value.issued_at)?;
    let expires_at = parse_timestamp(&value.expires_at)?;
    if issued_at >= expires_at {
        return Err("authorization expiry must follow issue time".into());
    }
    Ok(())
}

fn validate_control(control: &HostOperationControl) -> Result<(), String> {
    for value in [&control.run_id, &control.operation_id, &control.attempt_id,
        &control.target_host_id, &control.idempotency_key] {
        validate_uuid(value)?;
    }
    if [control.connection_generation, control.catalog_generation, control.policy_generation,
        control.approval_generation].contains(&0) {
        return Err("control generations must be positive".into());
    }
    validate_sha(&control.input_digest)?;
    validate_sha(&control.governance_projection.digest)?;
    validate_timestamp(&control.dispatched_at)?;
    validate_timestamp(&control.deadline_at)?;
    if let Some(expires_at) = &control.expires_at {
        validate_timestamp(expires_at)?;
    }
    Ok(())
}

pub(crate) fn validate_presentation(value: &HostChallengePresentation) -> Result<(), String> {
    if value.command_disclosure.as_ref().is_some_and(|marker| marker.revision != 1
        || !marker.complete || marker.encoding != "visible-escapes"
        || marker.reconstruction != "section-field-concat") {
        return Err("Host command disclosure is invalid".into());
    }
    if value.revision != 1 || value.title.is_empty() || value.title.len() > 120
        || value.capability_label.is_empty() || value.capability_label.len() > 120
        || value.risk_summary.is_empty() || value.risk_summary.len() > 500
        || value.sections.is_empty() || value.sections.len() > 8 {
        return Err("Host Approval presentation is invalid".into());
    }
    if value.subject_label.as_ref().is_some_and(|label| label.is_empty() || label.len() > 160) {
        return Err("Host Approval subject label is invalid".into());
    }
    for section in &value.sections {
        if section.title.is_empty() || section.title.len() > 80
            || section.fields.is_empty() || section.fields.len() > 12 {
            return Err("Host Approval presentation section is invalid".into());
        }
        for field in &section.fields {
            if field.label.is_empty() || field.label.len() > 80
                || field.value.is_empty() || field.value.len() > 500
                || (value.command_disclosure.is_some() && field.value.encode_utf16().count() > 500) {
                return Err("Host Approval presentation field is invalid".into());
            }
        }
    }
    Ok(())
}

fn validate_uuid(value: &str) -> Result<(), String> {
    let parsed = Uuid::parse_str(value).map_err(|_| "invalid UUID".to_string())?;
    let version = parsed.get_version().ok_or_else(|| "invalid UUID version".to_string())?;
    if !matches!(version, Version::Mac | Version::Dce | Version::Md5 | Version::Random
        | Version::Sha1 | Version::SortMac | Version::SortRand | Version::Custom)
        || parsed.get_variant() != Variant::RFC4122
        || !parsed.hyphenated().to_string().eq_ignore_ascii_case(value)
    {
        return Err("invalid RFC UUID".into());
    }
    Ok(())
}

fn validate_sha(value: &str) -> Result<(), String> {
    if value.len() != 64 || !value.bytes().all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte)) {
        return Err("invalid lowercase SHA-256 digest".into());
    }
    Ok(())
}

fn validate_timestamp(value: &str) -> Result<(), String> {
    parse_timestamp(value).map(|_| ())
}

pub fn parse_timestamp(value: &str) -> Result<OffsetDateTime, String> {
    OffsetDateTime::parse(value, &Rfc3339).map_err(|_| "invalid RFC 3339 timestamp".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::fs;
    use std::path::PathBuf;

    fn fixture(name: &str) -> Value {
        let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../../packages/shared/fixtures/protocol")
            .join(name);
        serde_json::from_str(&fs::read_to_string(path).expect("read Host Approval fixture"))
            .expect("parse fixture JSON")
    }

    #[test]
    fn canonical_digests_match_the_shared_fixture() {
        let challenge = parse_capability_challenge(fixture("capability-challenge.screenshot.valid.json"))
            .expect("validated challenge");
        assert_eq!(control_digest(&challenge.control).unwrap(), "c07a2ba3eb72bc8b068c2c388bfee0dc7c9d9a07d1c26ab52ac5573420ffe0e1");
        assert_eq!(challenge_digest(&challenge).unwrap(), "2ae3935fdee2150a2701f5c3730931753012e7dd833c8e2d3d903196d7dde97e");
        assert!(!canonical_challenge(&challenge).unwrap().contains("commandDisclosure"));
    }

    #[test]
    fn command_fixture_pins_marker_order_and_legacy_omission() {
        let value = fixture("capability-challenge.exec-disclosure.valid.json");
        let challenge = parse_capability_challenge(value.clone()).unwrap();
        assert_eq!(control_digest(&challenge.control).unwrap(), "069b39b45514eec068fa71a4ea390e9ceba0d834beb9a1330af9f0483dd126c1");
        assert_eq!(challenge_digest(&challenge).unwrap(), "e84382212f3ad083eacbc2d9a967e4e196109b83411e1a1361a862927debf209");
        let text: String = challenge.presentation.sections.iter()
            .flat_map(|s| s.fields.iter().map(|f| f.value.as_str())).collect();
        assert_eq!(text, "curl -H \"Authorization: Bearer [凭证已隐藏]\" https://example.test/api");
        let mut tampered = challenge.clone();
        tampered.presentation.sections.reverse();
        assert_ne!(challenge_digest(&tampered).unwrap(), challenge.challenge_digest);
        tampered = challenge.clone();
        tampered.presentation.sections[0].fields.reverse();
        assert_ne!(challenge_digest(&tampered).unwrap(), challenge.challenge_digest);
        tampered = challenge.clone();
        tampered.presentation.command_disclosure = None;
        assert_ne!(challenge_digest(&tampered).unwrap(), challenge.challenge_digest);
        for invalid in [Value::Null, json!({"revision": 2, "complete": true, "encoding": "visible-escapes", "reconstruction": "section-field-concat"})] {
            let mut malformed = value.clone();
            malformed["presentation"]["commandDisclosure"] = invalid;
            assert!(parse_capability_challenge(malformed).is_err());
        }
    }

    #[test]
    fn decision_scope_digests_match_the_shared_canonicalizer() {
        // Pinned against @taki/shared canonicalApprovalDecisionScope output for the same inputs.
        assert_eq!(
            approval_decision_scope_digest(
                "screenshot", "11111111-1111-4111-8111-111111111111", 1, "fixed-risk", 1, "screenshot"
            ),
            "8a44516d89973f6f59dbf9b308d05effb3dbc37362f53e2f369f42202e0a6c69"
        );
        assert_eq!(
            approval_decision_scope_digest(
                "exec", "11111111-1111-4111-8111-111111111111", 1, "exec-command", 1, "exec:compound"
            ),
            "f858b0d77839f5dd2d05d279c008d0394e093ad15e6cbcbf6c214e6e8bf61ed6"
        );
    }

    #[test]
    fn resume_validation_rejects_missing_authorization_and_expired_windows() {
        let resume = parse_capability_resume(fixture("capability-resume.screenshot.valid.json"))
            .expect("validated resume");
        let mut expired = resume.clone();
        expired.authorization.expires_at = expired.authorization.issued_at.clone();
        assert!(parse_capability_resume(serde_json::to_value(expired).unwrap()).is_err());
        let mut missing = serde_json::to_value(resume).unwrap();
        missing["authorization"].take();
        assert!(parse_capability_resume(missing).is_err());
    }
}
