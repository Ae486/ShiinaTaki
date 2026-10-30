use super::*;
use crate::browser_playback_protocol::{BrowserAttachmentFrame, BrowserPlaybackControl};
use futures_util::{SinkExt, StreamExt};
use serde_json::json;
use tokio_tungstenite::tungstenite::{Message, client::IntoClientRequest};
use std::time::Duration;

const TOKEN: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
#[test]
fn shared_local_wire_fixtures_match_shell_validation() {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../packages/shared/fixtures/browser-playback");
    let mut count = 0;
    for file in std::fs::read_dir(root).unwrap() {
        let path = file.unwrap().path();
        if path.extension().and_then(|value| value.to_str()) != Some("json") { continue; }
        let name = path.file_name().unwrap().to_str().unwrap();
        let valid = serde_json::from_slice::<BrowserAttachmentFrame>(&std::fs::read(&path).unwrap()).is_ok_and(|value| value.validate());
        assert_eq!(valid, name.ends_with(".valid.json"), "{name}"); count += 1;
    }
    assert_eq!(count, 9);
}
fn sample(sequence: u64) -> serde_json::Value {
    json!({"kind":"sample","sequence":sequence,"observedAgeMs":0,
        "source":{"tabId":1,"frameId":0,"documentId":"65AC7F3F61AF6FF1EA1451137F00A91B",
            "playerId":"22222222-2222-4222-8222-222222222222", "media":{"kind":"bilibili","bvid":"BV1UEaq6qEZt","cid":"42265479965","page":1}},
        "sample":{"state":"playing","positionSeconds":1,"durationSeconds":299.3,"playbackRate":1,"visible":true,"pictureInPicture":false}})
}

#[test]
fn local_reports_do_not_supply_core_authority_and_unknown_numbers_stay_required() {
    let good: BrowserAttachmentFrame = serde_json::from_value(sample(1)).unwrap();
    assert!(good.validate());
    let mut authority = sample(1); authority["hostId"] = json!(uuid::Uuid::new_v4());
    assert!(serde_json::from_value::<BrowserAttachmentFrame>(authority).is_err());
    let mut missing = sample(1); missing["sample"].as_object_mut().unwrap().remove("positionSeconds");
    assert!(serde_json::from_value::<BrowserAttachmentFrame>(missing).is_err());
    let mut impossible = sample(1); impossible["sample"]["positionSeconds"] = json!(999);
    assert!(!serde_json::from_value::<BrowserAttachmentFrame>(impossible).unwrap().validate());
}

#[test]
fn chromium_document_tokens_remain_opaque_and_do_not_relax_player_identity() {
    let valid = sample(1);
    assert!(serde_json::from_value::<BrowserAttachmentFrame>(valid.clone()).unwrap().validate());
    for document in ["Z".repeat(32), "A".repeat(31), "A".repeat(33), String::new()] {
        let mut invalid = valid.clone(); invalid["source"]["documentId"] = json!(document);
        assert!(!serde_json::from_value::<BrowserAttachmentFrame>(invalid).unwrap().validate());
    }
    let mut wrong_player = valid; wrong_player["source"]["playerId"] = json!("65AC7F3F61AF6FF1EA1451137F00A91B");
    assert!(!serde_json::from_value::<BrowserAttachmentFrame>(wrong_player).unwrap().validate());
}

#[test]
fn dedicated_token_and_actual_core_generation_control_both_gate_collection() {
    let sensor = BrowserAttachment::new(Some(18793), TOKEN.into());
    assert!(sensor.claim(&"b".repeat(64)).is_none());
    let client = sensor.claim(TOKEN).unwrap();
    assert!(sensor.claim(TOKEN).is_none());
    assert!(sensor.receive(&client, serde_json::from_value(sample(1)).unwrap()));
    assert!(sensor.subscribe().borrow().is_none());
    sensor.set_core_enabled(true);
    assert!(sensor.receive(&client, serde_json::from_value(sample(2)).unwrap()));
    let first = sensor.subscribe().borrow().as_ref().unwrap().attachment_id.clone();
    sensor.set_core_enabled(false);
    assert!(sensor.subscribe().borrow().is_none());
    sensor.set_core_enabled(true);
    assert!(sensor.receive(&client, serde_json::from_value(sample(3)).unwrap()));
    assert_ne!(sensor.subscribe().borrow().as_ref().unwrap().attachment_id, first);
    sensor.release(&client); assert!(sensor.subscribe().borrow().is_none());
    let control = BrowserPlaybackControl { schema_version: "taki.browser-playback-control.v1".into(), host_id: "host".into(),
        connection_generation: 2, catalog_generation: 1, revision: 3, enabled: true };
    assert!(control.matches("host", 2, 1, 2));
    assert!(!control.matches("host", 1, 1, 2)); assert!(!control.matches("host", 2, 1, 3));
}

#[test]
fn expiry_and_source_replacement_create_new_attachment_identity() {
    let sensor = BrowserAttachment::new(Some(18793), TOKEN.into()); sensor.set_core_enabled(true);
    let client = sensor.claim(TOKEN).unwrap();
    sensor.receive(&client, serde_json::from_value(sample(1)).unwrap());
    let first = sensor.subscribe().borrow().as_ref().unwrap().attachment_id.clone();
    sensor.state.lock().unwrap().observation.as_mut().unwrap().received -= Duration::from_secs(6);
    sensor.expire(); assert!(sensor.subscribe().borrow().is_none());
    sensor.receive(&client, serde_json::from_value(sample(2)).unwrap());
    assert_ne!(sensor.subscribe().borrow().as_ref().unwrap().attachment_id, first);
    let mut changed = sample(3); changed["source"]["media"]["page"] = json!(2);
    changed["source"]["media"]["cid"] = json!("999");
    let previous = sensor.subscribe().borrow().as_ref().unwrap().attachment_id.clone();
    sensor.receive(&client, serde_json::from_value(changed).unwrap());
    assert_ne!(sensor.subscribe().borrow().as_ref().unwrap().attachment_id, previous);
}

#[tokio::test]
async fn real_loopback_rejects_web_origins_and_drains_the_exact_authenticated_client() {
    let free = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = free.local_addr().unwrap().port(); drop(free);
    let sensor = BrowserAttachment::new(Some(port), TOKEN.into());
    let server = tokio::spawn(sensor.clone().run());
    let endpoint = format!("ws://127.0.0.1:{port}/taki-browser");
    let mut request = endpoint.clone().into_client_request().unwrap();
    request.headers_mut().insert("Origin", "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa".parse().unwrap());
    let mut connected = None;
    for _ in 0..40 {
        if let Ok((socket, _)) = tokio_tungstenite::connect_async(request.clone()).await { connected = Some(socket); break; }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    let mut socket = connected.unwrap();
    assert!(tokio_tungstenite::connect_async(endpoint.clone()).await.is_err());
    socket.send(Message::text(json!({"kind":"hello","protocol":"taki.browser-attachment.v1","token":TOKEN}).to_string())).await.unwrap();
    let first = tokio::time::timeout(Duration::from_secs(2), socket.next()).await.unwrap().unwrap().unwrap();
    assert!(first.to_text().unwrap().contains("false"));
    sensor.set_core_enabled(true);
    let mut samples = sensor.subscribe();
    socket.send(Message::text(sample(1).to_string())).await.unwrap();
    tokio::time::timeout(Duration::from_secs(2), samples.changed()).await.unwrap().unwrap();
    assert!(samples.borrow().is_some());
    sensor.close();
    tokio::time::timeout(Duration::from_secs(5), server).await.unwrap().unwrap().unwrap();
    assert!(sensor.state.lock().unwrap().active_client.is_none());
    assert!(sensor.subscribe().borrow().is_none());
    assert!(tokio::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, port)).await.is_ok());
}
