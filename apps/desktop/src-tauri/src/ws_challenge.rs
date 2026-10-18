//! INPUT:  Host ask evidence, the sealed capability request, and inbound capability.resume frames
//! OUTPUT: sealed challenge frames, redacted presentations, and exact one-shot authorization validation
//! POS:    shell/ws_challenge — pure Host ask helpers shared by ws_client; raw input never enters a frame or log

use serde_json::Value;

use crate::protocol::{
    approval_decision_scope_digest, challenge_digest, control_digest, parse_timestamp,
};
use crate::protocol::{
    CapabilityChallenge, CapabilityRequest, HostChallengePresentation,
    HostChallengePresentationField, HostChallengePresentationSection, HostGovernanceEvidence,
};
use crate::host_session::PendingChallengeRecord;

/// Seals the Host ask into one challenge frame: immutable control digests, the canonical remembered
/// decision scope, trusted classification evidence, and a redacted presentation with no raw input.
pub(crate) fn build_challenge(
    host_id: &str,
    evidence: HostGovernanceEvidence,
    request: &CapabilityRequest,
    descriptor: &crate::protocol::HostCapabilityDescriptor,
) -> Result<CapabilityChallenge, String> {
    let control = &request.control;
    let scope_digest = approval_decision_scope_digest(
        &control.capability_id,
        host_id,
        control.governance_projection.descriptor_revision,
        &descriptor.governance.classifier_id,
        control.governance_projection.classifier_revision,
        &evidence.cell_key,
    );
    let challenge = CapabilityChallenge {
        request_id: request.request_id.clone(),
        control: control.clone(),
        challenge_id: uuid::Uuid::new_v4().to_string(),
        control_digest: control_digest(control)?,
        challenge_digest: String::new(),
        decision_scope_digest: scope_digest,
        governance: evidence,
        presentation: challenge_presentation(&control.capability_id),
    };
    let digest = challenge_digest(&challenge)?;
    Ok(CapabilityChallenge { challenge_digest: digest, ..challenge })
}

/// Bounded, redacted, classification-only presentation. The exact raw input never enters the frame.
pub(crate) fn challenge_presentation(capability: &str) -> HostChallengePresentation {
    let risk = match capability {
        "exec" => "The Host classified this shell command as requiring operator approval; the command itself is not included.",
        "shell-open" => "The Host classified this open-target as requiring operator approval; the target itself is not included.",
        _ => "The Host classified this request as requiring operator approval.",
    };
    HostChallengePresentation {
        revision: 1,
        title: "Allow Host capability".into(),
        capability_label: capability.into(),
        subject_label: None,
        risk_summary: risk.into(),
        sections: vec![HostChallengePresentationSection {
            title: "Classification".into(),
            fields: vec![HostChallengePresentationField {
                label: "Decided by".into(),
                value: "Execution Host classification plus Core governance policy".into(),
            }],
        }],
    }
}

/// Exact single-use authorization validation against the stored challenge. Any mismatch voids the slot.
pub(crate) fn matches_pending_authorization(
    pending: &PendingChallengeRecord,
    resume: &crate::protocol::CapabilityResume,
) -> Result<(), String> {
    let challenge = &pending.challenge;
    let authorization = &resume.authorization;
    if challenge.request_id != resume.request_id || challenge.challenge_id != resume.challenge_id {
        return Err("resume ids do not match the pending challenge".into());
    }
    if challenge.control != resume.control {
        return Err("resume control is not the sealed control".into());
    }
    if authorization.control_digest != challenge.control_digest
        || authorization.challenge_digest != challenge.challenge_digest
        || authorization.decision_scope_digest != challenge.decision_scope_digest
    {
        return Err("authorization digests do not match the pending challenge".into());
    }
    let sealed = challenge.control.approval_generation;
    if authorization.approval_generation != sealed && sealed.checked_add(1) != Some(authorization.approval_generation) {
        return Err("authorization approval generation is outside the sealed lineage".into());
    }
    let issued = parse_timestamp(&authorization.issued_at)?;
    let expires = parse_timestamp(&authorization.expires_at)?;
    if challenge.control.capability_id == crate::protocol::CUSTODY_CAPABILITY
        && (authorization.decision_scope != crate::protocol::CapabilityDecisionScope::Once
            || issued < parse_timestamp(&challenge.control.dispatched_at)?
            || issued > time::OffsetDateTime::now_utc()
            || expires > parse_timestamp(&challenge.control.deadline_at)?) {
        return Err("custody authorization is outside its once-only original window".into());
    }
    if issued >= expires || time::OffsetDateTime::now_utc() >= expires {
        return Err("authorization window is expired".into());
    }
    Ok(())
}

/// The raw input stays behind in memory-only session state; this record type is the only holder.
pub(crate) fn pending_challenge_record(challenge: CapabilityChallenge, input: Value) -> PendingChallengeRecord {
    PendingChallengeRecord { challenge, input }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::fs;
    use std::path::PathBuf;
    use time::format_description::well_known::Rfc3339;

    fn fixture(name: &str) -> Value {
        let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../../packages/shared/fixtures/protocol")
            .join(name);
        serde_json::from_str(&fs::read_to_string(path).expect("read Host Approval fixture"))
            .expect("parse fixture JSON")
    }

    fn descriptor_for(capability: &str) -> crate::protocol::HostCapabilityDescriptor {
        let classifier_id = match capability {
            "exec" => "exec-command",
            "shell-open" => "shell-open-target",
            _ => "fixed-risk",
        };
        crate::protocol::HostCapabilityDescriptor {
            capability_id: capability.into(),
            execution: crate::protocol::CapabilityExecutionKind::Read,
            cancellation: crate::protocol::CapabilityCancellation::Cooperative,
            governance: crate::protocol::HostCapabilityGovernanceSupport {
                descriptor_revision: 1,
                classifier_id: classifier_id.into(),
                classifier_revision: 1,
            },
        }
    }

    #[test]
    fn built_challenge_validates_and_carries_no_raw_input() {
        let challenge = crate::protocol::parse_capability_challenge(
            fixture("capability-challenge.screenshot.valid.json"),
        )
        .expect("fixture challenge");
        let request = CapabilityRequest {
            request_id: challenge.request_id.clone(),
            control: challenge.control.clone(),
            input: json!({ "describePrompt": "SENTINEL-RAW-INPUT" }),
        };
        let evidence = challenge.governance.clone();
        let built = build_challenge(
            "11111111-1111-4111-8111-111111111111",
            evidence,
            &request,
            &descriptor_for("screenshot"),
        )
        .expect("sealed challenge");
        assert_eq!(built.control_digest, challenge.control_digest);
        assert_eq!(
            built.decision_scope_digest,
            "8a44516d89973f6f59dbf9b308d05effb3dbc37362f53e2f369f42202e0a6c69"
        );
        let frame = serde_json::to_string(&built).expect("serialize challenge");
        assert!(!frame.contains("SENTINEL-RAW-INPUT"));
        assert!(!frame.contains("describePrompt"));
        // A built challenge must itself parse under the strict cross-language schema.
        crate::protocol::parse_capability_challenge(
            serde_json::to_value(&built).expect("challenge value"),
        )
        .expect("built challenge validates");
    }

    #[test]
    fn resume_authorization_is_validated_exactly_against_the_pending_challenge() {
        let challenge = crate::protocol::parse_capability_challenge(
            fixture("capability-challenge.screenshot.valid.json"),
        )
        .expect("fixture challenge");
        let resume = crate::protocol::parse_capability_resume(
            fixture("capability-resume.screenshot.valid.json"),
        )
        .expect("fixture resume");
        let now = time::OffsetDateTime::now_utc();
        let issued = now
            .format(&Rfc3339)
            .expect("issue time");
        let expires = (now + time::Duration::seconds(60))
            .format(&Rfc3339)
            .expect("expiry time");
        let valid = crate::protocol::CapabilityResume {
            request_id: resume.request_id.clone(),
            control: challenge.control.clone(),
            challenge_id: resume.challenge_id.clone(),
            authorization: crate::protocol::CapabilityAuthorization {
                authorization_id: resume.authorization.authorization_id.clone(),
                approval_generation: challenge.control.approval_generation,
                decision_scope: resume.authorization.decision_scope,
                control_digest: challenge.control_digest.clone(),
                challenge_digest: challenge.challenge_digest.clone(),
                decision_scope_digest: challenge.decision_scope_digest.clone(),
                issued_at: issued.clone(),
                expires_at: expires.clone(),
            },
        };
        let pending = pending_challenge_record(challenge.clone(), Value::Null);
        assert!(matches_pending_authorization(&pending, &valid).is_ok());

        let mut stale = valid.clone();
        stale.authorization.approval_generation = challenge.control.approval_generation + 2;
        assert!(matches_pending_authorization(&pending, &stale).is_err());
        let mut tampered = valid.clone();
        tampered.authorization.challenge_digest = "f".repeat(64);
        assert!(matches_pending_authorization(&pending, &tampered).is_err());
        let mut wrong_ids = valid.clone();
        wrong_ids.challenge_id = "99999999-9999-4999-8999-999999999999".into();
        assert!(matches_pending_authorization(&pending, &wrong_ids).is_err());
        let mut expired = valid.clone();
        expired.authorization.expires_at = issued;
        assert!(matches_pending_authorization(&pending, &expired).is_err());
    }
}
