//! INPUT:  an already-verified absolute runtime command, bounded private input and live original deadline
//! OUTPUT: bounded stdout, actual child-token proof and reaped execution with descendants in an owned Job
//! POS:    shell/hindsight_windows — fixed environment, hidden direct spawn, no shell or ambient Node preload

use std::io::{Read, Write};
use std::mem::size_of;
use std::os::windows::{process::CommandExt, io::AsRawHandle};
use std::process::{Command, Stdio};
use std::sync::{Arc, atomic::{AtomicBool, Ordering}};
use std::time::{Duration, Instant};
use windows::core::PCWSTR;
use windows::Win32::Foundation::{HANDLE, CloseHandle};
use windows::Win32::System::JobObjects::{CreateJobObjectW, AssignProcessToJobObject, SetInformationJobObject,
    JobObjectExtendedLimitInformation, JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE};
use windows::Win32::System::SystemInformation::GetSystemWindowsDirectoryW;
use crate::protocol::{CUSTODY_RESULT_BYTES, HindsightRefusal};

pub(super) struct OwnedJob(HANDLE);
// SAFETY: this uniquely owned kernel handle may move between threads; access is
// serialized by its resident's mutex and Drop closes it exactly once.
unsafe impl Send for OwnedJob {}
impl OwnedJob {
    pub(super) fn new() -> Result<Self, HindsightRefusal> {
        // SAFETY: no inherited attributes or global name; the returned job belongs only to this invocation.
        let job = Self(unsafe { CreateJobObjectW(None, PCWSTR::null()) }.map_err(|_| HindsightRefusal::UnsafeInstallation)?);
        let mut info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        // SAFETY: job and initialized settings remain live and the size matches the information class.
        unsafe { SetInformationJobObject(job.0, JobObjectExtendedLimitInformation,
            (&info as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION).cast(), size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32) }
            .map_err(|_| HindsightRefusal::UnsafeInstallation)?;
        Ok(job)
    }
    pub(super) fn assign(&self, child: &std::process::Child, sid: &[u8]) -> Result<(), HindsightRefusal> {
        let handle = HANDLE(child.as_raw_handle());
        // SAFETY: both handles remain live; no private command has been sent.
        unsafe { AssignProcessToJobObject(self.0, handle) }.map_err(|_| HindsightRefusal::UnsafeInstallation)?;
        if !crate::secrets::process_user_sid(handle).is_ok_and(|actual| actual == sid) { return Err(HindsightRefusal::UnsafeInstallation); }
        Ok(())
    }
}
impl Drop for OwnedJob {
    fn drop(&mut self) {
        // SAFETY: this is the only owned job handle. Closing kills every still-running child in this job.
        let _ = unsafe { CloseHandle(self.0) };
    }
}

pub(super) fn sanitized_command(runtime: &str) -> Result<Command, HindsightRefusal> {
    let mut buffer = [0u16; 4096];
    // SAFETY: fixed output buffer; no environment value chooses the Windows system directory.
    let length = unsafe { GetSystemWindowsDirectoryW(Some(&mut buffer)) } as usize;
    if length == 0 || length >= buffer.len() { return Err(HindsightRefusal::UnsafeInstallation); }
    let system_root = String::from_utf16(&buffer[..length]).map_err(|_| HindsightRefusal::UnsafeInstallation)?;
    let mut command = Command::new(runtime);
    command.env_clear().env("SystemRoot", &system_root).env("WINDIR", &system_root)
        .env("WS_NO_BUFFER_UTIL", "1").env("WS_NO_UTF_8_VALIDATE", "1")
        .args(["--no-addons", "--no-global-search-paths"]).creation_flags(0x0800_0000)
        .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
    Ok(command)
}

pub(super) struct ProcessBudget<'a> { pub deadline: Instant, pub live: &'a AtomicBool, pub owner_sid: &'a [u8] }

/// Assign the child to the job before writing stdin. The audited entrypoint waits for complete input before
/// opening custody, so no key-adapter child can escape the owned job while launch assignment is in progress.
pub(super) fn run_bounded(mut command: Command, input: Vec<u8>, budget: ProcessBudget<'_>) -> Result<Vec<u8>, HindsightRefusal> {
    if Instant::now() >= budget.deadline || !budget.live.load(Ordering::Acquire) { return Err(HindsightRefusal::SnapshotStale); }
    let job = OwnedJob::new()?;
    let mut child = command.spawn().map_err(|_| HindsightRefusal::UnsafeInstallation)?;
    let child_handle = HANDLE(child.as_raw_handle());
    // SAFETY: both handles remain alive until process completion and job teardown.
    let assigned = unsafe { AssignProcessToJobObject(job.0, child_handle) }.is_ok();
    let correct_user = crate::secrets::process_user_sid(child_handle).is_ok_and(|sid| sid == budget.owner_sid);
    if !assigned || !correct_user {
        let _ = child.kill(); let _ = child.wait();
        return Err(HindsightRefusal::UnsafeInstallation);
    }
    let Some(mut stdin) = child.stdin.take() else { let _ = child.kill(); let _ = child.wait(); return Err(HindsightRefusal::UnsafeInstallation); };
    let Some(stdout) = child.stdout.take() else { let _ = child.kill(); let _ = child.wait(); return Err(HindsightRefusal::UnsafeInstallation); };
    let Some(stderr) = child.stderr.take() else { let _ = child.kill(); let _ = child.wait(); return Err(HindsightRefusal::UnsafeInstallation); };
    let invalid = Arc::new(AtomicBool::new(false));
    let write_invalid = invalid.clone();
    let writer = std::thread::spawn(move || { if stdin.write_all(&input).is_err() { write_invalid.store(true, Ordering::Release); } });
    let out_invalid = invalid.clone();
    let reader = std::thread::spawn(move || read_bounded(stdout, out_invalid, true));
    let err_invalid = invalid.clone();
    let error_reader = std::thread::spawn(move || read_bounded(stderr, err_invalid, false));
    let status = loop {
        if invalid.load(Ordering::Acquire) || !budget.live.load(Ordering::Acquire) || Instant::now() >= budget.deadline { break None; }
        match child.try_wait() { Ok(Some(status)) => break Some(status), Ok(None) => std::thread::sleep(Duration::from_millis(10)), Err(_) => break None }
    };
    // Closing the job also kills a misbehaving adapter descendant before joining output readers. This avoids
    // an inherited-pipe hang and guarantees cancellation does not leave a credential adapter running.
    drop(job);
    let _ = child.kill();
    let reaped = child.wait().is_ok();
    let written = writer.join().is_ok();
    let output = reader.join().map_err(|_| HindsightRefusal::OutcomeUnknown)?;
    let errors_drained = error_reader.join().is_ok();
    if !reaped || !written || !errors_drained || invalid.load(Ordering::Acquire)
        || status.is_none_or(|status| !status.success()) || !budget.live.load(Ordering::Acquire) || Instant::now() >= budget.deadline {
        return Err(HindsightRefusal::OutcomeUnknown);
    }
    Ok(output)
}

fn read_bounded(mut stream: impl Read, invalid: Arc<AtomicBool>, retain: bool) -> Vec<u8> {
    let mut output = Vec::new(); let mut total = 0usize; let mut buffer = [0u8; 4096];
    loop {
        let count = match stream.read(&mut buffer) { Ok(0) => break, Ok(count) => count, Err(_) => { invalid.store(true, Ordering::Release); break; } };
        total = total.saturating_add(count);
        if total > CUSTODY_RESULT_BYTES { invalid.store(true, Ordering::Release); }
        else if retain { output.extend_from_slice(&buffer[..count]); }
    }
    output
}
