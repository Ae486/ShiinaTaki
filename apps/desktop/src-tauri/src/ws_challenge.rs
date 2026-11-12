//! INPUT:  Host ask evidence, the sealed capability request, and inbound capability.resume frames
//! OUTPUT: sealed challenge frames, complete exec disclosure, and exact one-shot authorization validation
//! POS:    shell/ws_challenge — pure Host preflight adapter; display is never execution input or log content

use serde_json::Value;

use crate::protocol::{
    approval_decision_scope_digest, challenge_digest, control_digest, parse_timestamp,
};
use crate::protocol::{
    CapabilityChallenge, CapabilityRequest, HostChallengePresentation,
    HostChallengePresentationField, HostChallengePresentationSection, HostGovernanceEvidence,
};
use crate::host_session::PendingChallengeRecord;
use crate::exec_command_disclosure::{project_exec_command, CommandDisclosureError};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ChallengeBuildError {
    MissingDescriptor,
    InvalidBinding,
    Disclosure(CommandDisclosureError),
}

/// Seals the trusted preflight and permitted display while retaining original input only for execution.
pub(crate) fn build_challenge(
    host_id: &str,
    evidence: &HostGovernanceEvidence,
    request: &CapabilityRequest,
    descriptor: &crate::protocol::HostCapabilityDescriptor,
) -> Result<CapabilityChallenge, ChallengeBuildError> {
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
        control_digest: control_digest(control).map_err(|_| ChallengeBuildError::InvalidBinding)?,
        challenge_digest: String::new(),
        decision_scope_digest: scope_digest,
        governance: evidence.clone(),
        presentation: if control.capability_id == "exec"
            && evidence.effective_posture == crate::protocol::HostGovernancePosture::Ask {
            project_exec_command(crate::capabilities_impl::exec::command_of(&request.input))
                .map_err(ChallengeBuildError::Disclosure)?
        } else { challenge_presentation(&control.capability_id) },
    };
    let digest = challenge_digest(&challenge).map_err(|_| ChallengeBuildError::InvalidBinding)?;
    Ok(CapabilityChallenge { challenge_digest: digest, ..challenge })
}

/// Ordinary Host prompts keep the existing bounded shape and disclose no raw non-exec target.
pub(crate) fn challenge_presentation(capability: &str) -> HostChallengePresentation {
    // Keep the fixed Host vocabulary aligned with shared/governance-presentation.ts. Unknown IDs
    // receive a generic label; display copy never substitutes for capability identity or policy.
    let (label, risk) = match capability {
        "exec" => ("执行命令", "将在设备上执行命令，执行仍受当前权限设置约束。"),
        "shell-open" => ("打开外部目标", "将使用设备上的应用打开外部目标。"),
        "screenshot" => ("屏幕截图", "将读取当前屏幕画面，画面可能包含个人信息。"),
        "screenshot-ambient" => ("屏幕采样", "将读取屏幕画面，用于后台采样。"),
        "process-list" => ("查看进程", "将读取设备上当前运行的进程信息。"),
        "clipboard-read" => ("读取剪贴板", "将读取剪贴板中的文字，可能包含个人信息。"),
        "clipboard-write" => ("写入剪贴板", "将替换设备剪贴板中的文字内容。"),
        "foreground-window" => ("读取前台窗口", "将读取当前前台窗口的标题和所属进程。"),
        _ => ("设备操作", "将在设备上执行此操作，执行仍受当前权限设置约束。"),
    };
    HostChallengePresentation {
        revision: 1,
        title: format!("允许{label}？"),
        capability_label: label.into(),
        subject_label: None,
        risk_summary: risk.into(),
        sections: vec![HostChallengePresentationSection {
            title: "操作说明".into(),
            fields: vec![HostChallengePresentationField {
                label: "操作".into(),
                value: label.into(),
            }],
        }],
        command_disclosure: None,
    }
}

/// Exact single-use validation. The caller retires invalid authority only for the matching sealed
/// request/control/challenge tuple; a foreign tuple must not void a reused request's pending slot.
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
            &evidence,
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

    #[test]
    fn same_masked_command_never_shares_raw_input_or_authorization_identity() {
        use sha2::{Digest, Sha256};
        let template = crate::protocol::parse_capability_challenge(
            fixture("capability-challenge.exec-disclosure.valid.json"),
        ).unwrap();
        let build = |secret: &str| {
            let input = json!({"command": format!("tool --token={secret} --file=C:\\workspace\\ordinary.txt tail")});
            let mut request = CapabilityRequest { request_id: template.request_id.clone(), control: template.control.clone(), input };
            let canonical = json!({"capabilityId": "exec", "input": request.input}).to_string();
            request.control.input_digest = format!("{:x}", Sha256::digest(canonical.as_bytes()));
            let mut challenge = build_challenge(&request.control.target_host_id, &template.governance, &request, &descriptor_for("exec")).unwrap();
            // Pin every unrelated variable. Only the secret and its correctly recomputed input digest differ.
            challenge.challenge_id = template.challenge_id.clone();
            challenge.challenge_digest = challenge_digest(&challenge).unwrap();
            (challenge, request)
        };
        let (first, first_request) = build("SYNTHETIC_ALPHA");
        let (second, second_request) = build("SYNTHETIC_BRAVO");
        assert_eq!(first.presentation, second.presentation);
        let text: String = first.presentation.sections.iter().flat_map(|s| s.fields.iter().map(|f| f.value.as_str())).collect();
        assert_eq!(text, r"tool --token=[凭证已隐藏] --file=C:\\workspace\\ordinary.txt tail");
        assert_ne!(first.control.input_digest, second.control.input_digest);
        assert_ne!(first.control_digest, second.control_digest);
        assert_ne!(first.challenge_digest, second.challenge_digest);
        let now = time::OffsetDateTime::now_utc();
        let resume = crate::protocol::CapabilityResume {
            request_id: first.request_id.clone(), control: first.control.clone(), challenge_id: first.challenge_id.clone(),
            authorization: crate::protocol::CapabilityAuthorization {
                authorization_id: "88888888-8888-4888-8888-888888888888".into(),
                approval_generation: first.control.approval_generation, decision_scope: crate::protocol::CapabilityDecisionScope::Once,
                control_digest: first.control_digest.clone(), challenge_digest: first.challenge_digest.clone(), decision_scope_digest: first.decision_scope_digest.clone(),
                issued_at: now.format(&Rfc3339).unwrap(), expires_at: (now + time::Duration::seconds(60)).format(&Rfc3339).unwrap(),
            },
        };
        assert!(matches_pending_authorization(&pending_challenge_record(first, first_request.input), &resume).is_ok());
        assert!(matches_pending_authorization(&pending_challenge_record(second, second_request.input), &resume).is_err());
    }

    #[test]
    fn only_effective_ask_exec_uses_the_disclosure_capacity_gate() {
        let template = crate::protocol::parse_capability_challenge(fixture("capability-challenge.exec-disclosure.valid.json")).unwrap();
        let request = CapabilityRequest { request_id: template.request_id, control: template.control,
            input: json!({"command": "x".repeat(48_001)}) };
        assert_eq!(build_challenge(&request.control.target_host_id, &template.governance, &request, &descriptor_for("exec")),
            Err(ChallengeBuildError::Disclosure(CommandDisclosureError::PresentationTooLarge)));
        let mut auto = template.governance;
        auto.effective_posture = crate::protocol::HostGovernancePosture::Auto;
        let built = build_challenge(&request.control.target_host_id, &auto, &request, &descriptor_for("exec")).unwrap();
        assert!(built.presentation.command_disclosure.is_none());
    }

    #[test]
    fn ordinary_host_prompts_have_bounded_chinese_copy_without_changing_legacy_shape() {
        for (capability, label) in [("exec", "执行命令"), ("shell-open", "打开外部目标"),
            ("screenshot", "屏幕截图"), ("screenshot-ambient", "屏幕采样"), ("process-list", "查看进程"),
            ("clipboard-read", "读取剪贴板"), ("clipboard-write", "写入剪贴板"), ("foreground-window", "读取前台窗口"),
            ("unknown-private-capability", "设备操作")] {
            let presentation = challenge_presentation(capability);
            assert_eq!(presentation.capability_label, label);
            assert_eq!(presentation.title, format!("允许{label}？"));
            assert_eq!(presentation.sections[0].fields[0].value, label);
            assert!(presentation.command_disclosure.is_none());
            crate::protocol::validate_presentation(&presentation).unwrap();
        }
    }
}
