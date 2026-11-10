use super::*;

pub(crate) fn fixture() -> (LocalChallenge, LocalDescriptor) {
    let descriptor = LocalDescriptor { version: 1,
        core_id: "550e8400-e29b-41d4-a716-446655440000".into(),
        instance_id: "550e8400-e29b-41d4-a716-446655440001".into(), endpoint: "ws://127.0.0.1:8974".into() };
    let mut challenge = LocalChallenge { version: 1, core_id: descriptor.core_id.clone(), instance_id: descriptor.instance_id.clone(),
        endpoint: descriptor.endpoint.clone(), nonce: "01".repeat(32), client_nonce: "02".repeat(32),
        device_id: "550e8400-e29b-41d4-a716-446655440002".into(), role: crate::protocol::Role::Operator,
        expires_at: 30_001, server_proof: String::new() };
    challenge.server_proof = mac(&[7; 32], "server", &challenge).unwrap().finalize().into_bytes().iter().map(|b| format!("{b:02x}")).collect();
    (challenge, descriptor)
}

#[test]
fn server_and_client_domains_have_cross_language_golden_proofs() {
    let (challenge, descriptor) = fixture();
    assert_eq!(challenge.server_proof, "f37286ea575712330d5b187b9a7a40a84b39a4b894e4a650739f45f3d53e9079");
    assert_eq!(verify_and_sign(&challenge, &descriptor, (&[7; 32], 1)).unwrap(), "df194023c31033e94eac024d43cf3810184bd3686be1a2d352db1ac5a6c39af7");
}

#[test]
fn rejects_changed_endpoint_profile_instance_expiry_proof_and_nonce() {
    let (challenge, descriptor) = fixture();
    for field in ["endpoint", "coreId", "instanceId", "expiresAt", "serverProof", "clientNonce", "role"] {
        let mut value = serde_json::to_value(&challenge).unwrap();
        value[field] = match field {
            "endpoint" => serde_json::json!("ws://127.0.0.1:9999"),
            "expiresAt" => serde_json::json!(1),
            "role" => serde_json::json!("node"),
            _ => serde_json::json!("00".repeat(32)),
        };
        let altered: LocalChallenge = serde_json::from_value(value).unwrap();
        assert!(verify_and_sign(&altered, &descriptor, (&[7; 32], 1)).is_err(), "{field}");
    }
    assert!(verify_and_sign(&challenge, &descriptor, (&[8; 32], 1)).is_err());
    assert!(verify_and_sign(&challenge, &descriptor, (&[7; 32], 30_001)).is_err());
}

#[test]
fn endpoints_allow_only_local_websockets_without_credential_query_or_path() {
    for endpoint in ["ws://127.0.0.1:8974", "ws://localhost:9080", "ws://[::1]:8974"] { assert!(validate_endpoint(endpoint).is_ok(), "{endpoint}"); }
    for endpoint in ["wss://example.com", "ws://127.0.0.1.evil.test:8974", "ws://user@localhost:8974", "ws://localhost:8974/path", "ws://localhost:8974?token=secret"] {
        assert!(validate_endpoint(endpoint).is_err(), "{endpoint}");
    }
    assert!(is_local_endpoint("ws://127.0.0.1:9999"));
    assert!(!is_local_endpoint("ws://remote.example:8974"));
    assert!(!is_local_endpoint("broken"));
}
