//! INPUT: Shell-local optional adapter configuration, repair requests and one process-owned listener task.
//! OUTPUT: retryable failed configuration, live enable/disable replacement and one active listener.
//! POS: shell/browser_attachment — independent adapter lifecycle; never restarts the execution Node.

use std::path::{Path, PathBuf};
use std::sync::{Arc, atomic::Ordering};
use std::time::Duration;
use tokio::sync::watch;
use super::{Binding, BrowserAttachment};
use crate::secrets::SecretStore;

pub(super) struct Loader { data_dir: PathBuf, secrets: Arc<dyn SecretStore> }

impl BrowserAttachment {
    pub(crate) fn load_recoverable(data_dir: &Path, secrets: Arc<dyn SecretStore>) -> Arc<Self> {
        let attachment = Self::disabled();
        if let Ok(mut loader) = attachment.loader.lock() {
            *loader = Some(Loader { data_dir: data_dir.to_path_buf(), secrets });
        }
        attachment.refresh_configuration();
        attachment
    }

    pub(crate) fn is_unavailable(&self) -> bool { self.unavailable.load(Ordering::Relaxed) }
    pub(crate) fn configuration_changes(&self) -> watch::Receiver<()> { self.configuration.subscribe() }
    pub(crate) fn reload_configuration(&self) { self.reload.send_replace(()); }

    fn refresh_configuration(&self) {
        let result = self.loader.lock().map_err(|_| ()).and_then(|loader| {
            let Some(loader) = loader.as_ref() else { return Ok(None); };
            let candidate = Self::load(&loader.data_dir, loader.secrets.as_ref()).map_err(|_| ())?;
            let binding = candidate.binding.lock().map_err(|_| ())?.clone();
            Ok(Some(binding))
        });
        match result {
            Ok(Some(binding)) => {
                if let Ok(mut current) = self.binding.lock() { *current = binding; }
                self.unavailable.store(false, Ordering::Relaxed);
                self.configuration.send_replace(());
            }
            Ok(None) => {}
            Err(()) => self.mark_unavailable(),
        }
    }

    fn mark_unavailable(&self) {
        self.unavailable.store(true, Ordering::Relaxed);
        self.set_core_enabled(false);
        if let Ok(mut binding) = self.binding.lock() { *binding = Binding { port: None, token: String::new() }; }
        tracing::warn!(code = "BROWSER_ATTACHMENT_UNAVAILABLE", "Browser attachment unavailable; Home and other Shell features remain available");
    }

    pub(super) async fn run_owned(self: Arc<Self>) {
        let mut reload = self.reload.subscribe();
        let mut stop = self.stop.subscribe();
        loop {
            if *stop.borrow() { break; }
            if self.is_unavailable() {
                tokio::select! {
                    _ = stop.changed() => break,
                    _ = reload.changed() => {},
                    _ = tokio::time::sleep(Duration::from_secs(5)) => {},
                }
            } else if self.configured() {
                tokio::select! {
                    _ = stop.changed() => break,
                    _ = reload.changed() => {},
                    result = self.clone().run() => { if result.is_err() { self.mark_unavailable(); continue; } },
                }
            } else {
                tokio::select! { _ = stop.changed() => break, _ = reload.changed() => {} }
            }
            self.set_core_enabled(false);
            if let Ok(mut state) = self.state.lock() { state.active_client = None; }
            self.refresh_configuration();
        }
    }
}
