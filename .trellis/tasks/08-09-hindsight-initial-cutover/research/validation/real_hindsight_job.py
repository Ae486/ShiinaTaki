"""Contain the Windows validation process tree before admitting resource access.

The unnamed, non-inheritable Job handle belongs only to the outer supervisor.
KILL_ON_JOB_CLOSE contains descendants if that supervisor dies; ordinary owned
shutdown still happens first. No process is ever terminated by a recovered PID.
"""

from __future__ import annotations

import ctypes
import msvcrt
import os
import subprocess
import time
from collections.abc import Callable
from contextlib import ExitStack
from ctypes import wintypes
from dataclasses import dataclass, field
from typing import Any

ADMISSION_LINE = b"D78-START\n"
KILL_ON_JOB_CLOSE = 0x2000


class BasicLimitInformation(ctypes.Structure):
    # Microsoft Learn: ns-winnt-jobobject_basic_limit_information. LARGE_INTEGER
    # is signed 64-bit, SIZE_T/ULONG_PTR follow the process pointer width.
    _fields_ = [
        ("PerProcessUserTimeLimit", ctypes.c_longlong),
        ("PerJobUserTimeLimit", ctypes.c_longlong),
        ("LimitFlags", wintypes.DWORD),
        ("MinimumWorkingSetSize", ctypes.c_size_t),
        ("MaximumWorkingSetSize", ctypes.c_size_t),
        ("ActiveProcessLimit", wintypes.DWORD),
        ("Affinity", ctypes.c_size_t),
        ("PriorityClass", wintypes.DWORD),
        ("SchedulingClass", wintypes.DWORD),
    ]


class IoCounters(ctypes.Structure):
    _fields_ = [(name, ctypes.c_ulonglong) for name in (
        "ReadOperationCount", "WriteOperationCount", "OtherOperationCount",
        "ReadTransferCount", "WriteTransferCount", "OtherTransferCount",
    )]


class ExtendedLimitInformation(ctypes.Structure):
    # https://learn.microsoft.com/windows/win32/api/winnt/ns-winnt-jobobject_extended_limit_information
    _fields_ = [
        ("BasicLimitInformation", BasicLimitInformation),
        ("IoInfo", IoCounters),
        ("ProcessMemoryLimit", ctypes.c_size_t),
        ("JobMemoryLimit", ctypes.c_size_t),
        ("PeakProcessMemoryUsed", ctypes.c_size_t),
        ("PeakJobMemoryUsed", ctypes.c_size_t),
    ]


class BasicAccountingInformation(ctypes.Structure):
    _fields_ = [(name, ctypes.c_longlong) for name in (
        "TotalUserTime", "TotalKernelTime", "ThisPeriodTotalUserTime", "ThisPeriodTotalKernelTime",
    )] + [(name, wintypes.DWORD) for name in (
        "TotalPageFaultCount", "TotalProcesses", "ActiveProcesses", "TotalTerminatedProcesses",
    )]


@dataclass
class JobCleanup:
    forced: bool = False
    all_exited: bool = False
    remaining: int | None = None
    handle_closed: bool = False
    errors: list[str] = field(default_factory=list)


@dataclass
class ContainedProcessResult:
    pid: int | None = None
    returncode: int | None = None
    reason: str = "job_creation_failed"
    admission_started: bool = False
    worker_pid: int | None = None
    errors: list[str] = field(default_factory=list)
    cleanup: JobCleanup = field(default_factory=JobCleanup)


class WorkerControlFrames:
    """Private pipe frames bound shutdown timing, never completion acceptance."""

    def __init__(self, identity: str) -> None:
        self.identity = identity.encode("ascii")
        self.buffer = bytearray()
        self.discarding = False
        self.state = "running"

    def read(self, process: SuspendedProcess) -> str:
        for byte in process.read_available():
            if byte == 10:
                if not self.discarding:
                    parts = self.buffer.removesuffix(b"\r").split(b" ")
                    if (len(parts) == 3 and parts[:2] == [b"D78-STATE", self.identity]
                            and parts[2] in (b"stopping", b"finished")):
                        if self.state != "finished":
                            self.state = parts[2].decode("ascii")
                self.buffer.clear()
                self.discarding = False
            elif len(self.buffer) < 128:
                self.buffer.append(byte)
            else:
                self.discarding = True
        return self.state


class OwnedProcessJob:
    def __init__(self) -> None:
        # This task's native Python/pg0 toolchain is Windows x64. Refuse an
        # unreviewed ABI rather than guessing structure packing on another host.
        if ctypes.sizeof(ctypes.c_void_p) != 8 or ctypes.sizeof(ExtendedLimitInformation) != 144:
            raise RuntimeError("D78_JOB_ABI_REFUSED")
        self.kernel: Any = ctypes.WinDLL("kernel32", use_last_error=True)
        self.kernel.CreateJobObjectW.argtypes = [ctypes.c_void_p, wintypes.LPCWSTR]
        self.kernel.CreateJobObjectW.restype = wintypes.HANDLE
        self.kernel.SetInformationJobObject.argtypes = [wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD]
        self.kernel.SetInformationJobObject.restype = wintypes.BOOL
        self.kernel.QueryInformationJobObject.argtypes = [wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p,
                                                         wintypes.DWORD, ctypes.POINTER(wintypes.DWORD)]
        self.kernel.QueryInformationJobObject.restype = wintypes.BOOL
        self.kernel.AssignProcessToJobObject.argtypes = [wintypes.HANDLE, wintypes.HANDLE]
        self.kernel.AssignProcessToJobObject.restype = wintypes.BOOL
        self.kernel.TerminateJobObject.argtypes = [wintypes.HANDLE, wintypes.UINT]
        self.kernel.TerminateJobObject.restype = wintypes.BOOL
        self.kernel.SetHandleInformation.argtypes = [wintypes.HANDLE, wintypes.DWORD, wintypes.DWORD]
        self.kernel.SetHandleInformation.restype = wintypes.BOOL
        self.kernel.CloseHandle.argtypes = [wintypes.HANDLE]
        self.kernel.CloseHandle.restype = wintypes.BOOL
        # NULL security attributes make the handle non-inheritable; enforce it
        # again explicitly so no child can keep containment alive after we die.
        self.handle = self.kernel.CreateJobObjectW(None, None)
        self.cleanup: JobCleanup | None = None
        self.creation_errors: list[str] = []
        if not self.handle:
            raise ctypes.WinError(ctypes.get_last_error())
        try:
            limits = ExtendedLimitInformation()
            limits.BasicLimitInformation.LimitFlags = KILL_ON_JOB_CLOSE
            if not self.kernel.SetInformationJobObject(self.handle, 9, ctypes.byref(limits), ctypes.sizeof(limits)):
                raise ctypes.WinError(ctypes.get_last_error())
            if not self.kernel.SetHandleInformation(self.handle, 1, 0):
                raise ctypes.WinError(ctypes.get_last_error())
        except BaseException:
            self.kernel.CloseHandle(self.handle)
            self.handle = None
            raise

    def assign(self, process: subprocess.Popen[bytes] | SuspendedProcess) -> None:
        if self.handle is None or process.poll() is not None:
            raise RuntimeError("D78_JOB_ASSIGNMENT_REFUSED")
        # CPython's Windows Popen retains the actual CreateProcess handle. It
        # already has SET_QUOTA/TERMINATE rights; do not reopen a PID from disk.
        process_handle = wintypes.HANDLE(int(getattr(process, "_handle")))
        if not self.kernel.AssignProcessToJobObject(self.handle, process_handle):
            raise ctypes.WinError(ctypes.get_last_error())

    def process_ids(self) -> set[int]:
        # The kernel's exact Job membership is the authority. A venv redirector
        # PID, an ancestor relation, or membership in some other Job is not proof.
        capacity = 16
        for _ in range(4):
            storage = ctypes.create_string_buffer(8 + ctypes.sizeof(ctypes.c_size_t) * capacity)
            success = self.kernel.QueryInformationJobObject(self.handle, 3, storage, ctypes.sizeof(storage), None)
            assigned = wintypes.DWORD.from_buffer(storage, 0).value
            count = wintypes.DWORD.from_buffer(storage, 4).value
            if success:
                if count > capacity:
                    raise RuntimeError("D78_JOB_MEMBERSHIP_INVALID")
                return set((ctypes.c_size_t * count).from_buffer(storage, 8))
            if ctypes.get_last_error() != 234 or assigned > 4096:
                raise ctypes.WinError(ctypes.get_last_error())
            capacity = max(2 * capacity, assigned)
        raise RuntimeError("D78_JOB_MEMBERSHIP_UNSTABLE")

    def active_processes(self) -> int:
        if self.handle is None:
            raise RuntimeError("D78_JOB_ALREADY_CLOSED")
        accounting = BasicAccountingInformation()
        if not self.kernel.QueryInformationJobObject(self.handle, 1, ctypes.byref(accounting),
                                                      ctypes.sizeof(accounting), None):
            raise ctypes.WinError(ctypes.get_last_error())
        return int(accounting.ActiveProcesses)

    def finish(self, *, timeout: float = 5, launcher_exited: bool = False) -> JobCleanup:
        if self.cleanup is not None:
            return self.cleanup
        result = self.cleanup = JobCleanup(errors=list(self.creation_errors))
        started = time.monotonic()
        deadline = started + max(0, timeout)
        # A signaled launcher handle does not mean its last Job member has
        # finished exiting. Spend at most half the existing cleanup budget on
        # natural drain, and retain the other half for force plus confirmation.
        # The caller must have observed exit through the original process handle;
        # a completion file or worker control frame cannot authorize this grace.
        natural_deadline = started + max(0, timeout) / 2 if launcher_exited else started
        try:
            try:
                result.remaining = self.active_processes()
                while result.remaining and time.monotonic() < natural_deadline:
                    time.sleep(min(0.05, max(0, natural_deadline - time.monotonic())))
                    result.remaining = self.active_processes()
            except OSError:
                result.remaining = None
                result.errors.append("job_query_failed")
            if result.remaining != 0:
                result.forced = True
                if not self.kernel.TerminateJobObject(self.handle, 1):
                    result.errors.append("job_termination_failed")
                while True:
                    try:
                        result.remaining = self.active_processes()
                    except OSError:
                        result.remaining = None
                        result.errors.append("job_query_failed")
                        break
                    if result.remaining == 0 or time.monotonic() >= deadline:
                        break
                    time.sleep(min(0.05, max(0, deadline - time.monotonic())))
            result.all_exited = result.remaining == 0 and not result.errors
            if not result.all_exited:
                result.errors.append("job_exit_unconfirmed")
        finally:
            result.handle_closed = bool(self.kernel.CloseHandle(self.handle))
            self.handle = None
            if not result.handle_closed:
                result.errors.append("job_handle_close_failed")
        return result


class ProcessStartupFailure(RuntimeError):
    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


class SuspendedProcess:
    """The pinned CPython Windows CreateProcess seam, retaining both original handles.

    Popen closes the primary thread handle before returning, which makes a later
    suspended-start repair unsafe. Calling its installed _winapi seam directly
    retains hp/ht without a global hook or reopening a PID/TID. CPython 3.11.5
    supplies STARTUPINFOEX and Unicode environment conversion itself.
    """

    def __init__(self, command: list[str], *, job: OwnedProcessJob, environment: dict[str, str], cwd: str) -> None:
        self.api: Any = getattr(subprocess, "_winapi")
        self.kernel = job.kernel
        self.kernel.ResumeThread.argtypes = [wintypes.HANDLE]
        self.kernel.ResumeThread.restype = wintypes.DWORD
        self.kernel.PeekNamedPipe.argtypes = [wintypes.HANDLE, ctypes.c_void_p, wintypes.DWORD,
                                             ctypes.POINTER(wintypes.DWORD), ctypes.POINTER(wintypes.DWORD),
                                             ctypes.POINTER(wintypes.DWORD)]
        self.kernel.PeekNamedPipe.restype = wintypes.BOOL
        self.pid = 0
        self.returncode: int | None = None
        self._handle: Any = None
        self.stdin: Any = None
        self.stdout: Any = None
        thread_handle: int | None = None
        stage = "child_spawn_failed"
        try:
            with ExitStack() as pipes:
                child_in, parent_in = os.pipe()
                for descriptor in (child_in, parent_in):
                    pipes.callback(os.close, descriptor)
                parent_out, child_out = os.pipe()
                for descriptor in (parent_out, child_out):
                    pipes.callback(os.close, descriptor)
                self.stdin = os.fdopen(os.dup(parent_in), "wb", buffering=0)
                self.stdout = os.fdopen(os.dup(parent_out), "rb", buffering=0)
                os.set_inheritable(child_in, True)
                os.set_inheritable(child_out, True)
                startup = subprocess.STARTUPINFO()
                startup.dwFlags = self.api.STARTF_USESTDHANDLES
                startup.hStdInput = msvcrt.get_osfhandle(child_in)
                startup.hStdOutput = startup.hStdError = msvcrt.get_osfhandle(child_out)
                startup.lpAttributeList = {"handle_list": [startup.hStdInput, startup.hStdOutput]}
                hp, thread_handle, self.pid, _ = self.api.CreateProcess(
                    command[0], subprocess.list2cmdline(command), None, None, True,
                    subprocess.CREATE_NO_WINDOW | 0x00000004, environment, cwd, startup,
                )
                self._handle = getattr(subprocess, "Handle")(hp)
                stage = "job_assignment_failed"
                job.assign(self)
                if self.pid not in job.process_ids():
                    raise RuntimeError("D78_JOB_ASSIGNMENT_UNPROVEN")
                stage = "primary_thread_resume_failed"
                if self.kernel.ResumeThread(thread_handle) != 1:
                    raise RuntimeError("D78_PRIMARY_THREAD_STATE_REFUSED")
                self.api.CloseHandle(thread_handle)
                thread_handle = None
                stage = "child_pipe_close_failed"
        except BaseException as error:
            if self._handle is not None:
                try:
                    if not terminate_held_child(self):
                        job.creation_errors.append("suspended_child_exit_unconfirmed")
                except BaseException:
                    # The Job remains the outer lifetime owner's final fallback.
                    job.creation_errors.append("suspended_child_cleanup_incomplete")
            try:
                self.close()
            except BaseException:
                # Preserve the startup/cancellation cause. The outer Job close
                # remains a second cleanup boundary for any resumed descendant.
                job.creation_errors.append("child_handle_close_failed")
            if stage == "child_pipe_close_failed":
                job.creation_errors.append(stage)
            if not isinstance(error, Exception):
                raise
            raise ProcessStartupFailure(stage) from None
        finally:
            if thread_handle is not None:
                try:
                    self.api.CloseHandle(thread_handle)
                except OSError:
                    # Close was attempted with the actual creation handle; no
                    # thread identifier is reopened to retry a failed close.
                    job.creation_errors.append("primary_thread_close_failed")

    def poll(self) -> int | None:
        if self.returncode is None and self.api.WaitForSingleObject(self._handle, 0) == self.api.WAIT_OBJECT_0:
            self.returncode = int(self.api.GetExitCodeProcess(self._handle))
        return self.returncode

    def wait(self, timeout: float = 5) -> int:
        if self.returncode is None:
            if self.api.WaitForSingleObject(self._handle, max(0, int(timeout * 1000))) == self.api.WAIT_TIMEOUT:
                raise subprocess.TimeoutExpired("D78_OWNED_CHILD", timeout)
            self.returncode = int(self.api.GetExitCodeProcess(self._handle))
        return self.returncode

    def terminate(self) -> None:
        if self.poll() is None:
            self.api.TerminateProcess(self._handle, 1)

    kill = terminate

    def read_available(self) -> bytes:
        available = wintypes.DWORD()
        pipe = msvcrt.get_osfhandle(self.stdout.fileno())
        if not self.kernel.PeekNamedPipe(pipe, None, 0, None, ctypes.byref(available), None):
            if ctypes.get_last_error() in (109, 232, 233):
                return b""
            raise ctypes.WinError(ctypes.get_last_error())
        # This is an unbuffered pipe and its only reader. Never issue a blocking
        # read for bytes that the kernel has not reported as already available.
        return self.stdout.read(min(available.value, 4096)) if available.value else b""

    def close(self) -> None:
        try:
            if self.stdin is not None and not self.stdin.closed:
                self.stdin.close()
        finally:
            try:
                if self.stdout is not None and not self.stdout.closed:
                    self.stdout.close()
            finally:
                if self._handle is not None:
                    self._handle.Close()


def verify_worker(process: SuspendedProcess, job: OwnedProcessJob, identity: str, *, timeout: float = 5) -> int:
    deadline = time.monotonic() + timeout
    header = bytearray()
    while time.monotonic() < deadline:
        header.extend(process.read_available())
        if b"\n" in header:
            line, _, _extra = header.partition(b"\n")
            # Windows TextIOWrapper emits CRLF; accept that exact framing as
            # well as LF, without stripping arbitrary bytes from the identity.
            line = line.removesuffix(b"\r")
            parts = line.split(b" ")
            if (len(line) >= 128 or len(parts) != 3 or parts[0] != b"D78-WORKER"
                    or parts[2] != identity.encode("ascii") or len(parts[1]) > 10
                    or not parts[1].isdigit() or not 0 < int(parts[1]) <= 0xFFFFFFFF):
                raise RuntimeError("D78_WORKER_REGISTRATION_REFUSED")
            worker = int(parts[1])
            if worker not in job.process_ids():
                raise RuntimeError("D78_WORKER_OUTSIDE_OWNED_JOB")
            return worker
        if len(header) >= 128 or process.poll() is not None:
            raise RuntimeError("D78_WORKER_REGISTRATION_REFUSED")
        time.sleep(0.01)
    raise RuntimeError("D78_WORKER_REGISTRATION_TIMEOUT")


def admit_child(process: subprocess.Popen[bytes] | SuspendedProcess) -> None:
    if process.stdin is None:
        raise RuntimeError("D78_JOB_ADMISSION_PIPE_MISSING")
    # The Windows venv redirector creates a different Python worker PID. Bind
    # its record to the held launcher handle through this private admission pipe.
    admission = ADMISSION_LINE + f"{process.pid}\n".encode("ascii")
    if process.stdin.write(admission) != len(admission):
        raise RuntimeError("D78_JOB_ADMISSION_INCOMPLETE")
    process.stdin.flush()
    process.stdin.close()


def terminate_held_child(process: subprocess.Popen[bytes] | SuspendedProcess, *, timeout: float = 5) -> bool:
    try:
        if process.poll() is not None:
            return True
    except OSError:
        return False
    for terminate in (process.terminate, process.kill):
        try:
            terminate()
        except OSError:
            # Windows can reject TerminateProcess once exit has begun, before
            # the process handle becomes signaled. Still wait on that exact hp;
            # Job membership reaching zero alone does not complete this reap.
            try:
                if process.poll() is not None:
                    return True
            except OSError:
                return False
        try:
            process.wait(timeout=timeout)
            return True
        except subprocess.TimeoutExpired:
            continue
        except OSError:
            return False
    try:
        return process.poll() is not None
    except OSError:
        return False


def run_contained_process(command: list[str], *, environment: dict[str, str], cwd: str,
                           output: Any, observe: Callable[[int, int], str],
                           stopping: Callable[[ContainedProcessResult], None],
                           request_stop: Callable[[], None],
                           exit_timeout: float = 5, stop_timeout: float = 120) -> ContainedProcessResult:
    """Admit once, watch durable terminal progress, then reap the held process tree.

    The short finished deadline covers non-daemon executor threads that survive
    asyncio cancellation. The longer stopping deadline allows the native graceful
    stages before OS containment becomes the final, explicitly forced fallback.
    """
    result = ContainedProcessResult()
    job: OwnedProcessJob | None = None
    process: SuspendedProcess | None = None
    deadline: float | None = None
    frames = WorkerControlFrames(environment["TAKI_D78_SUPERVISOR_ID"])

    def apply_state(state: str) -> None:
        nonlocal deadline
        if state in ("stopping", "finished"):
            candidate = time.monotonic() + (exit_timeout if state == "finished" else stop_timeout)
            deadline = candidate if deadline is None else min(deadline, candidate)

    try:
        job = OwnedProcessJob()
        result.reason = "child_spawn_failed"
        process = SuspendedProcess(command, job=job, environment=environment, cwd=cwd)
        result.pid = process.pid
        result.reason = "worker_registration_failed"
        worker_pid = verify_worker(process, job, environment["TAKI_D78_SUPERVISOR_ID"])
        result.worker_pid = worker_pid
        result.reason = "child_admission_failed"
        # flush/close may fail after START became visible. From this point onward
        # failure must never be interpreted as proof that no resources were used.
        result.admission_started = True
        admit_child(process)
        result.reason = "supervisor_metadata_failed"
        while process.poll() is None:
            # A disk failure cannot erase the shutdown deadline. These frames
            # carry no success proof; the final receipt must still be durable.
            apply_state(frames.read(process))
            apply_state(observe(process.pid, worker_pid))
            now = time.monotonic()
            if deadline is not None and now >= deadline:
                result.reason = "supervisor_exit_timeout"
                break
            time.sleep(0.05)
        else:
            result.reason = "child_exited"
        result.returncode = process.poll()
    except BaseException as error:
        if isinstance(error, ProcessStartupFailure):
            result.reason = error.reason
        elif not isinstance(error, Exception):
            result.reason = "supervisor_interrupted"
    finally:
        if process is not None and process.poll() is None:
            if result.admission_started:
                try:
                    request_stop()
                except BaseException:
                    result.errors.append("supervisor_stop_request_failed")
                if deadline is None:
                    deadline = time.monotonic() + stop_timeout
            else:
                deadline = time.monotonic() + exit_timeout
            if process.stdin is not None and not process.stdin.closed:
                try:
                    process.stdin.close()
                except OSError:
                    result.errors.append("child_pipe_close_failed")
            while process.poll() is None and time.monotonic() < deadline:
                try:
                    apply_state(frames.read(process))
                    if result.worker_pid is not None:
                        apply_state(observe(process.pid, result.worker_pid))
                except BaseException:
                    if "supervisor_metadata_failed" not in result.errors:
                        result.errors.append("supervisor_metadata_failed")
                time.sleep(0.05)
        try:
            stopping(result)
        except BaseException:
            result.errors.append("supervisor_metadata_failed")
        if job is not None:
            try:
                # SuspendedProcess sets returncode only after its retained
                # creation handle is signaled. An earlier failure remains in
                # result.reason even when these final members drain naturally.
                result.cleanup = job.finish(launcher_exited=process is not None and process.returncode is not None)
            except BaseException:
                result.cleanup = job.cleanup or JobCleanup()
                result.cleanup.errors.append("job_cleanup_failed")
        if process is not None:
            # Assignment can fail before the process entered the Job. Reap that
            # still-gated process through the original handle as well.
            if not terminate_held_child(process):
                result.cleanup.all_exited = False
                result.cleanup.errors.append("child_exit_unconfirmed")
            result.returncode = process.poll()
            try:
                process.close()
            except OSError:
                result.cleanup.errors.append("child_handle_close_failed")
    return result
