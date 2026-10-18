//! INPUT:  verified fixed Node command and per-invocation bounded private frames
//! OUTPUT: resident pipes and Job ownership surviving requests, with finite cancellation/reaping
//! POS:    shell/hindsight_windows — C2 lifetime only; C1's one-shot Job behavior stays intact

use std::io::{Read, Write};
use std::process::{Child, ChildStdin, Command};
use std::sync::{mpsc, Arc, atomic::{AtomicBool, Ordering}};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};
use crate::protocol::{CUSTODY_REQUEST_BYTES, CUSTODY_RESULT_BYTES, HindsightRefusal};
use super::process::OwnedJob;

pub(super) struct ResidentProcess {
    child: Child, stdin: Option<ChildStdin>, output: Option<mpsc::Receiver<Vec<u8>>>,
    job: Option<OwnedJob>, readers: Vec<JoinHandle<()>>, invalid: Arc<AtomicBool>,
}
impl ResidentProcess {
    pub fn start(mut command: Command, sid: &[u8]) -> Result<Self, HindsightRefusal> {
        let job = OwnedJob::new()?;
        let mut child = command.spawn().map_err(|_| HindsightRefusal::UnsafeInstallation)?;
        if let Err(error) = job.assign(&child, sid) { let _ = child.kill(); let _ = child.wait(); return Err(error); }
        let Some(stdin) = child.stdin.take() else { let _ = child.kill(); let _ = child.wait(); return Err(HindsightRefusal::UnsafeInstallation); };
        let Some(mut stdout) = child.stdout.take() else { let _ = child.kill(); let _ = child.wait(); return Err(HindsightRefusal::UnsafeInstallation); };
        let Some(mut stderr) = child.stderr.take() else { let _ = child.kill(); let _ = child.wait(); return Err(HindsightRefusal::UnsafeInstallation); };
        let (send, output) = mpsc::sync_channel(2);
        let invalid = Arc::new(AtomicBool::new(false));
        let read_invalid = invalid.clone();
        let reader = std::thread::spawn(move || {
            loop {
                let mut prefix = [0; 4];
                if stdout.read_exact(&mut prefix).is_err() { break; }
                let length = u32::from_le_bytes(prefix) as usize;
                if length > CUSTODY_REQUEST_BYTES { break; }
                let mut frame = vec![0; length];
                if stdout.read_exact(&mut frame).is_err() || send.send(frame).is_err() { break; }
            }
            read_invalid.store(true, Ordering::Release);
        });
        let error_invalid = invalid.clone();
        let error_reader = std::thread::spawn(move || {
            let mut total = 0usize; let mut buffer = [0; 4096];
            loop {
                let count = match stderr.read(&mut buffer) { Ok(0) => break, Ok(count) => count, Err(_) => { error_invalid.store(true, Ordering::Release); break; } };
                total = total.saturating_add(count);
                if total > CUSTODY_RESULT_BYTES { error_invalid.store(true, Ordering::Release); }
            }
        });
        Ok(Self { child, stdin: Some(stdin), output: Some(output), job: Some(job), readers: vec![reader, error_reader], invalid })
    }

    pub fn alive(&mut self) -> bool { !self.invalid.load(Ordering::Acquire) && self.child.try_wait().is_ok_and(|status| status.is_none()) }

    pub fn send(&mut self, bytes: Vec<u8>, deadline: Instant, live: &AtomicBool) -> Result<(), HindsightRefusal> {
        self.check(deadline, live)?;
        if bytes.len() > CUSTODY_REQUEST_BYTES { return Err(HindsightRefusal::InputOversize); }
        let mut stdin = self.stdin.take().ok_or(HindsightRefusal::OutcomeUnknown)?;
        let (send, receive) = mpsc::sync_channel(1);
        let writer = std::thread::spawn(move || {
            let written = stdin.write_all(&(bytes.len() as u32).to_le_bytes()).and_then(|()| stdin.write_all(&bytes)).and_then(|()| stdin.flush());
            let _ = send.send((stdin, written.is_ok()));
        });
        let result = loop {
            if self.check(deadline, live).is_err() { break Err(HindsightRefusal::OutcomeUnknown); }
            match receive.recv_timeout(Duration::from_millis(10)) {
                Ok((stdin, success)) => { self.stdin = Some(stdin); break if success { Ok(()) } else { Err(HindsightRefusal::OutcomeUnknown) }; }
                Err(mpsc::RecvTimeoutError::Timeout) => {},
                Err(_) => break Err(HindsightRefusal::OutcomeUnknown),
            }
        };
        if result.is_err() { self.stop(); }
        let _ = writer.join();
        result
    }

    pub fn receive(&mut self, deadline: Instant, live: &AtomicBool) -> Result<Vec<u8>, HindsightRefusal> {
        loop {
            self.check(deadline, live)?;
            match self.output.as_ref().ok_or(HindsightRefusal::OutcomeUnknown)?.recv_timeout(Duration::from_millis(10)) {
                Ok(bytes) => return Ok(bytes),
                Err(mpsc::RecvTimeoutError::Timeout) => {},
                Err(_) => return Err(HindsightRefusal::OutcomeUnknown),
            }
        }
    }
    fn check(&mut self, deadline: Instant, live: &AtomicBool) -> Result<(), HindsightRefusal> {
        if !live.load(Ordering::Acquire) || Instant::now() >= deadline || !self.alive() { return Err(HindsightRefusal::OutcomeUnknown); }
        Ok(())
    }
    fn stop(&mut self) {
        self.job.take(); self.output.take(); self.stdin.take();
        let _ = self.child.kill(); let _ = self.child.wait();
        for reader in self.readers.drain(..) { let _ = reader.join(); }
    }
}
impl Drop for ResidentProcess { fn drop(&mut self) { self.stop(); } }
