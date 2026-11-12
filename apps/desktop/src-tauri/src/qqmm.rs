//! INPUT: actual Tauri window identity and the shared native QQMM management runtime.
//! OUTPUT: three finite commands plus source-WebView Channels and helper-only lifecycle cleanup.
//! POS: desktop shell — thin QQMM adapter, independent of the paired execution Node and Core.

use qqmm_management_native::{
    Command, Limits, ManagementRuntime, NativeError, WindowEvent, WindowEvents,
};
use serde::Serialize;
use serde_json::{Map, Value};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::ipc::Channel;
use tauri::{Manager, State, WebviewWindow};

const HOME: &str = "home";
pub type QqmmRuntime = Arc<WindowRuntime>;

struct Delivery {
    window: WebviewWindow,
    channel: Channel<WindowEvent>,
}

pub struct WindowRuntime {
    management: ManagementRuntime,
    // Open/close are serialized separately from delivery. WindowEvents invokes
    // its sink under the shared runtime fence; taking this lock in a sink would
    // reverse the lock order and could deadlock with open/close.
    lifecycle: Mutex<()>,
    delivery: Arc<Mutex<Option<Delivery>>>,
}

pub fn runtime() -> QqmmRuntime {
    Arc::new(WindowRuntime {
        management: ManagementRuntime::from_environment([HOME], Limits::default()),
        lifecycle: Mutex::new(()),
        delivery: Arc::new(Mutex::new(None)),
    })
}

fn internal_error() -> NativeError {
    NativeError {
        code: "NATIVE_IO_ERROR".into(),
        message: "The local management operation could not finish.".into(),
        retryable: true,
    }
}

#[derive(Serialize)]
pub struct Ready {
    ready: bool,
}

fn forward_events(delivery: Arc<Mutex<Option<Delivery>>>, events: WindowEvents) {
    loop {
        let result = events.forward_next(Duration::from_secs(30), |event| {
            // Tauri event targets are filters, not source-WebView isolation:
            // Any listeners bypass them. Channel command decoding instead binds
            // its callback to the actual invoking WebView, including on rebind.
            if let Ok(current) = delivery.lock() {
                if let Some(current) = current.as_ref() {
                    let _ = current.channel.send(event);
                }
            }
        });
        match result {
            Ok(()) => {}
            Err(error) if error.code == "NATIVE_EVENT_TIMEOUT" => {}
            Err(_) => break,
        }
    }
}

#[tauri::command]
pub async fn qqmm_open(
    window: WebviewWindow,
    runtime: State<'_, QqmmRuntime>,
    on_event: Channel<WindowEvent>,
) -> Result<Ready, NativeError> {
    let runtime = runtime.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _lifecycle = runtime.lifecycle.lock().map_err(|_| internal_error())?;
        // is_visible queries this exact native dispatcher. A hidden live window
        // is permitted; an old destroyed Home instance cannot reopen its view.
        window.is_visible().map_err(|_| internal_error())?;
        let label = window.label().to_owned();
        let events = runtime.management.open(&label)?;
        if window.is_visible().is_err() {
            let _ = runtime.management.close(&label);
            *runtime.delivery.lock().map_err(|_| internal_error())? = None;
            return Err(internal_error());
        }
        *runtime.delivery.lock().map_err(|_| internal_error())? = Some(Delivery {
            window,
            channel: on_event,
        });
        if let Some(events) = events {
            let delivery = runtime.delivery.clone();
            let spawned = std::thread::Builder::new()
                .name("qqmm-home-events".into())
                .spawn(move || forward_events(delivery, events));
            if spawned.is_err() {
                let _ = runtime.management.close(&label);
                *runtime.delivery.lock().map_err(|_| internal_error())? = None;
                return Err(internal_error());
            }
        }
        Ok(Ready { ready: true })
    })
    .await
    .map_err(|_| internal_error())?
}

#[tauri::command]
pub async fn qqmm_request(
    window: WebviewWindow,
    runtime: State<'_, QqmmRuntime>,
    command: Command,
    params: Map<String, Value>,
) -> Result<Value, NativeError> {
    let runtime = runtime.inner().clone();
    let label = window.label().to_owned();
    tauri::async_runtime::spawn_blocking(move || {
        window.is_visible().map_err(|_| internal_error())?;
        runtime.management.request(&label, command, params)
    })
    .await
    .map_err(|_| internal_error())?
}

#[tauri::command]
pub async fn qqmm_close(
    window: WebviewWindow,
    runtime: State<'_, QqmmRuntime>,
) -> Result<(), NativeError> {
    let runtime = runtime.inner().clone();
    let label = window.label().to_owned();
    tauri::async_runtime::spawn_blocking(move || {
        let _lifecycle = runtime.lifecycle.lock().map_err(|_| internal_error())?;
        window.is_visible().map_err(|_| internal_error())?;
        runtime.management.close(&label)?;
        *runtime.delivery.lock().map_err(|_| internal_error())? = None;
        Ok(())
    })
    .await
    .map_err(|_| internal_error())?
}

pub fn on_window_event(window: &tauri::Window, event: &tauri::WindowEvent) {
    if matches!(event, tauri::WindowEvent::Destroyed) && window.label() == HOME {
        let runtime = window.state::<QqmmRuntime>().inner().clone();
        let label = window.label().to_owned();
        tauri::async_runtime::spawn_blocking(move || {
            let Ok(_lifecycle) = runtime.lifecycle.lock() else {
                return;
            };
            let owner = runtime
                .delivery
                .lock()
                .ok()
                .and_then(|slot| slot.as_ref().map(|current| current.window.clone()));
            // A late Destroyed callback for an old Home must not close a newly
            // created, live Home with the same label. Native dispatcher identity
            // distinguishes the instances without persisting renderer identity.
            if owner.is_some_and(|current| current.is_visible().is_ok()) {
                return;
            }
            let _ = runtime.management.close(&label);
            if let Ok(mut slot) = runtime.delivery.lock() {
                *slot = None;
            }
        });
    }
}

pub fn on_app_event(handle: &tauri::AppHandle, event: tauri::RunEvent) {
    if matches!(event, tauri::RunEvent::Exit) {
        // This kills only the owned helper, never the persistent Monitor Host.
        let runtime = handle.state::<QqmmRuntime>();
        // shutdown permanently fences shared-runtime opens itself. Do not wait
        // for lifecycle here: an in-flight open may be asking this UI thread
        // about its native window, which would make an exit-time lock cycle.
        let _ = runtime.management.shutdown();
        if let Ok(mut slot) = runtime.delivery.lock() {
            *slot = None;
        };
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_actual_home_window_can_access_management() {
        let runtime = ManagementRuntime::from_environment([HOME], Limits::default());
        for label in ["main", "pet", "other", "home/other"] {
            assert_eq!(
                runtime.open(label).err().unwrap().code,
                "NATIVE_WINDOW_DENIED"
            );
            assert_eq!(
                runtime
                    .request(label, Command::ConfigApply, Map::new())
                    .unwrap_err()
                    .code,
                "NATIVE_WINDOW_DENIED"
            );
            assert_eq!(
                runtime.close(label).unwrap_err().code,
                "NATIVE_WINDOW_DENIED"
            );
        }
    }

    #[test]
    fn management_acl_is_home_only_and_keeps_existing_event_permissions() {
        let home: Value = serde_json::from_str(include_str!("../capabilities/home.json")).unwrap();
        assert_eq!(home["windows"], serde_json::json!([HOME]));
        assert_eq!(
            home["permissions"],
            serde_json::json!([
                "core:event:default",
                "core:window:allow-is-visible",
                "core:window:allow-is-minimized",
                "core:window:allow-is-focused",
                "allow-browser-attachment-setup",
                "allow-browser-attachment-pair",
                "allow-qqmm-open",
                "allow-qqmm-request",
                "allow-qqmm-close"
            ])
        );
        for source in [
            include_str!("../capabilities/default.json"),
            include_str!("../capabilities/pet.json"),
        ] {
            let capability: Value = serde_json::from_str(source).unwrap();
            assert!(capability["permissions"]
                .as_array()
                .unwrap()
                .iter()
                .all(|permission| !permission.as_str().unwrap().contains("qqmm")));
        }
    }

    #[test]
    fn compiled_authority_preserves_local_legacy_commands_and_scopes_qqmm() {
        // Use the actual generated authority, rather than inferring enforcement
        // from the checked-in JSON. AppManifest enables all app-command checks
        // in locked Tauri 2.11.5 src/webview/mod.rs:1820.
        let mut context: tauri::Context<tauri::Wry> = tauri::generate_context!();
        let authority = context.runtime_authority_mut();
        let remote = tauri::ipc::Origin::Remote {
            url: "https://example.invalid".parse().unwrap(),
        };
        for label in ["main", "pet", "home", "other"] {
            for command in ["ping", "get_status", "submit_pairing_code"] {
                assert!(
                    authority
                        .resolve_access(command, label, label, &tauri::ipc::Origin::Local)
                        .is_some(),
                    "legacy {command} denied for {label}"
                );
                assert!(authority
                    .resolve_access(command, label, label, &remote)
                    .is_none());
            }
            for command in ["qqmm_open", "qqmm_request", "qqmm_close", "browser_attachment_setup", "browser_attachment_pair"] {
                assert_eq!(
                    authority
                        .resolve_access(command, label, label, &tauri::ipc::Origin::Local)
                        .is_some(),
                    label == HOME
                );
                assert!(authority
                    .resolve_access(command, label, label, &remote)
                    .is_none());
            }
        }
    }
}
