"""Parent-only real HTTP diagnostic; default invocation is inert."""

from __future__ import annotations

import argparse
import math
import os
import re
import subprocess
import time
import uuid
from contextlib import contextmanager
from pathlib import Path
from typing import Any

import w5_actual_embedding_control as control
import w5_http_inventory as inventory

ENTRY = Path(__file__).resolve()
NODE = Path("C:/Program Files/nodejs/node.exe").resolve()
CLIENT = ENTRY.with_name("w5-http-client.mjs")


class NodeSupervisor:
    def __init__(self, job: Path, source: dict[str, Any], python: Any) -> None:
        self.job, self.source, self.python = job, source, python
        self.child: Any = None
        self.identity: Any = None
        self.started: float | None = None
        self.admitted = False
        self.port: int | None = None

    def poll(self) -> None:
        ready_path = self.job / "http-ready.json"
        if not ready_path.exists():
            return
        ready = control.read_json(ready_path)
        assert (
            ready["job"] == str(self.job.resolve()) and ready["actorVerified"] is True
        )
        assert ready["python"] == control.read_json(self.job / "child.json")
        pointer = control.read_json(self.job / "clone.json")
        assert Path(ready["clone"]).resolve() == control.validate_pointer(pointer)
        from urllib.parse import urlparse

        endpoint = urlparse(ready["endpoint"])
        assert (
            endpoint.scheme == "http"
            and endpoint.hostname == "127.0.0.1"
            and endpoint.port
        )
        assert endpoint.port not in {18495, 18496, pointer["port"]}
        self.port = endpoint.port
        if self.child is None:
            with_identity = control.ProcessIdentity(self.python.pid)
            try:
                assert (
                    with_identity.value == ready["python"]
                    and self.python.poll() is None
                )
            finally:
                with_identity.close()
            nonce = uuid.uuid4().hex
            control.write_json(
                self.job / "node-launch.json",
                {
                    "job": str(self.job.resolve()),
                    "parentPid": os.getpid(),
                    "nodeExecutable": str(NODE),
                    "clientScript": str(CLIENT),
                    "nonce": nonce,
                    "sourceManifestSha256": self.source["sha256"],
                    "dependencySha256": inventory.DEPENDENCIES_SHA,
                },
            )
            self.child = subprocess.Popen(
                [str(NODE), str(CLIENT), "--owned-job", str(self.job)],
                cwd=control.HERE,
                env=control.clean_environment(),
                stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                creationflags=subprocess.CREATE_NO_WINDOW,
            )
            self.started = time.monotonic()
            self.identity = control.ProcessIdentity(self.child.pid)
            assert Path(str(self.identity.value["executable"])).resolve() == NODE, (
                "HTTP_NODE_IMAGE_MISMATCH"
            )
            control.write_json(self.job / "node-held.json", self.identity.value)
        if self.child.poll() is not None:
            control.write_json(
                self.job / "node-exit.json",
                {"exitCode": self.child.returncode, "admitted": self.admitted},
            )
            return
        if not self.admitted:
            assert self.started is not None and time.monotonic() - self.started < 10, (
                "HTTP_NODE_HANDSHAKE_TIMEOUT"
            )
            self_path = self.job / "node-self.json"
            if self_path.exists():
                self.admit(control.read_json(self_path))

    def admit(self, value: dict[str, Any]) -> None:
        launch = control.read_json(self.job / "node-launch.json")
        assert (
            value["job"] == str(self.job.resolve()) and value["pid"] == self.child.pid
        ), "HTTP_NODE_JOB_MISMATCH"
        assert value["parentPid"] == os.getpid(), "HTTP_NODE_PARENT_MISMATCH"
        assert Path(value["executable"]).resolve() == NODE and value[
            "version"
        ].startswith("v24."), "HTTP_NODE_IMAGE_MISMATCH"
        assert value["nonce"] == launch["nonce"] and value["source"] == self.source, (
            "HTTP_NODE_INVENTORY_MISMATCH"
        )
        live = control.ProcessIdentity(self.child.pid)
        try:
            assert live.value == self.identity.value and self.child.poll() is None, (
                "HTTP_NODE_IDENTITY_CHANGED"
            )
        finally:
            live.close()
        control.write_json(
            self.job / "node-admission.json",
            {
                "pid": self.child.pid,
                "nonce": launch["nonce"],
                "sourceManifestSha256": self.source["sha256"],
                "identity": self.identity.value,
            },
        )
        self.admitted = True

    def close(self) -> None:
        report: dict[str, Any] = {
            "launched": self.child is not None,
            "admitted": self.admitted,
            "stopped": False,
        }
        try:
            if self.child is not None:
                if self.child.poll() is None:
                    # Termination uses the original Popen Windows handle; never
                    # reconstruct a process from a stale PID for termination.
                    self.child.terminate()
                    report["terminatedHeldChild"] = True
                self.child.wait(timeout=10)
                report["exitCode"] = self.child.returncode
                control.write_json(
                    self.job / "node-exit.json",
                    {"exitCode": self.child.returncode, "admitted": self.admitted},
                )
            report["stopped"] = True
        finally:
            if self.identity is not None:
                self.identity.close()
            control.write_json(self.job / "node-cleanup.json", report)


def continuous_phase(job: Path, ordinary: dict[str, Any]) -> dict[str, Any]:
    path = job / "http-initialization.json"
    if path.exists():
        anchor = control.read_json(path)
        if anchor["ready"] is not True:
            return {"phase": "initializing", "monotonic": anchor["monotonic"]}
        assert anchor["milliseconds"] < control.INIT_SECONDS * 1000, (
            "HTTP_INITIALIZATION_COMPLETED_LATE"
        )
    return ordinary


@contextmanager
def source_composition(expected_sha: str) -> Any:
    original_verify, original_manifest = control.verify_sources, control.MANIFEST

    def verify() -> None:
        inventory.verify_inventory(expected_sha)

    setattr(control, "verify_sources", verify)
    control.MANIFEST = inventory.MANIFEST
    try:
        yield
    finally:
        control.verify_sources, control.MANIFEST = original_verify, original_manifest


def finish_reports(job: Path, source: dict[str, Any]) -> dict[str, Any]:
    def object_report(path: Path) -> dict[str, Any]:
        try:
            value = control.read_json(path)
            assert isinstance(value, dict), "INVALID_REPORT_SHAPE"
            return value
        except Exception as error:
            return {"invalidReport": path.name, "errorClass": type(error).__name__}

    def object_field(parent: dict[str, Any], key: str) -> dict[str, Any]:
        value = parent.get(key)
        return value if isinstance(value, dict) else {"invalidReport": key}

    reports = {}
    for name in (
        "inventory-parent-before",
        "inventory-parent-after",
        "inventory-python-before",
        "inventory-python-after",
        "inventory-node-before",
        "inventory-node-after",
    ):
        try:
            reports[name] = control.read_json(job / f"{name}.json")
        except Exception:
            reports[name] = None
    complete = all(value == source for value in reports.values())
    try:
        native_result_sha = control.digest(job / "result.json")
    except Exception:
        native_result_sha = None
    original = object_report(job / "result.json")
    child = object_field(original, "childReport")
    http = object_field(child, "http")
    node = object_report(job / "http-node-result.json")
    cleanup = object_report(job / "node-cleanup.json")
    pg_cleanup = object_field(original, "cleanup")
    watchdog = object_field(original, "watchdog")
    worker_launch = object_report(job / "worker-launch.json")
    worker_self = object_report(job / "worker-self.json")
    node_launch = object_report(job / "node-launch.json")
    node_self = object_report(job / "node-self.json")
    node_held = object_report(job / "node-held.json")
    node_admission = object_report(job / "node-admission.json")
    request_input = object_report(job / "http-input.json")
    ready = object_report(job / "http-ready.json")
    # These are persisted evidence, not trusted success assertions. Require the
    # measured full call, single mutations, exact lookup and database proof to
    # agree even when both copies of a damaged Node report have identical flags.
    http_evidence_complete = False
    try:
        duration = http["publicMilliseconds"]
        assert type(duration) in (int, float) and math.isfinite(duration)
        assert 0 <= duration < 60000
        assert all(
            http.get(key) is True
            for key in ("applyReturned", "applyCompleted", "exactLookupMatches")
        )
        assert child.get("applyCompleted") is True
        assert child.get("exactLookupMatches") is True
        assert all(
            type(http[key]) is int and http[key] == 1
            for key in ("claims", "applyPosts")
        )
        assert all(
            isinstance(http[key], str) and re.fullmatch(r"[a-f0-9]{64}", http[key])
            for key in ("requestHash", "resultHash")
        )
        assert all(
            type(http[key]) is int and http[key] >= 0
            for key in ("mappings", "artifacts")
        )
        assert http["requestHash"] == request_input["requestHash"]
        assert ready["inputSha256"] == control.digest(job / "http-input.json")
        assert child["persistedDelta"] == {
            key: http[key]
            for key in ("requestHash", "resultHash", "mappings", "artifacts")
        }
        events = http["transports"]
        assert isinstance(events, list) and events
        assert all(
            isinstance(event, dict)
            and event.get("completed") is True
            and type(event.get("status")) is int
            and 200 <= event["status"] < 300
            and isinstance(event.get("path"), str)
            and event.get("method") in ("GET", "POST")
            for event in events
        )
        posts = [event for event in events if event.get("method") == "POST"]
        assert len(posts) == 2
        assert sum(event["path"].endswith("/claim") for event in posts) == 1
        assert sum(event["path"].endswith("/executor/delta") for event in posts) == 1
        assert (
            sum(
                event.get("method") == "GET" and event["path"].endswith("/delta")
                for event in events
            )
            == 1
        )
        http_evidence_complete = True
    except (AssertionError, KeyError, TypeError, ValueError, OverflowError, OSError):
        pass
    saved_reports_agree = bool(
        original.get("workerLaunch") == worker_launch
        and original.get("workerSelf") == worker_self
        and worker_self.get("verified") is True
        and child.get("embeddings") == object_report(job / "embedding.json")
        and node_self.get("source") == source
        and node_admission.get("sourceManifestSha256") == source.get("sha256")
        and node_launch.get("sourceManifestSha256") == source.get("sha256")
        and node_launch.get("dependencySha256") == inventory.DEPENDENCIES_SHA
        and isinstance(node_launch.get("nonce"), str)
        and node_launch.get("nonce")
        == node_self.get("nonce")
        == node_admission.get("nonce")
        and node_held == node_admission.get("identity")
        and isinstance(node_held.get("pid"), int)
        and node_held.get("pid") == node_self.get("pid") == node_admission.get("pid")
        and node_self.get("parentPid")
        == node_launch.get("parentPid")
        == worker_launch.get("parentPid")
        and node_self.get("job") == node_launch.get("job") == str(job.resolve())
        and object_report(job / "node-exit.json") == {"exitCode": 0, "admitted": True}
        and object_report(job / "watchdog.json") == watchdog
    )
    preserved = all(
        object_field(original, "preservation").get(key) is True
        for key in (
            "sourcePreserved",
            "inputPreserved",
            "corePreserved",
            "originalPreserved",
            "sourcesPreserved",
        )
    )
    diagnostic = bool(
        complete
        and http_evidence_complete
        and saved_reports_agree
        and source.get("verified") is True
        and original.get("diagnosticSucceeded") is True
        and original.get("directWorkerIdentityVerified") is True
        and native_result_sha is not None
        and node == http
        and http.get("diagnosticSucceeded") is True
        and child.get("serverDrained") is True
        and child.get("httpPortReleased") is True
        and child.get("engineClosed") is True
        and child.get("historicalMaintenancePreserved") is True
        and child.get("actorVerified") is True
        and child.get("deltaRows") == 1
        and child.get("forbiddenDispatches") == []
        and cleanup.get("stopped") is True
        and cleanup.get("admitted") is True
        and cleanup.get("exitCode") == 0
        and pg_cleanup.get("stopped") is True
        and pg_cleanup.get("portReleased") is True
        and watchdog.get("childExitCode") == 0
        and watchdog.get("timeout") is None
        and "errorClass" not in original
        and preserved
    )
    result = {
        "meaning": "Isolated real HTTP diagnostic; separate from authority recovery",
        "reports": reports,
        "source": source,
        "completeInventories": complete,
        "savedReportsAgree": saved_reports_agree,
        "httpEvidenceComplete": http_evidence_complete,
        "diagnosticSucceeded": diagnostic,
        "completeHttpBudgetPassed": diagnostic
        and http.get("completeHttpBudgetPassed") is True,
        "authorityRecoveryProven": False,
        "nodeCleanup": cleanup,
        "http": http,
        "nativeResultSha256": native_result_sha,
    }
    control.write_json(job / "http-result.json", result)
    return result


def _run_reviewed(source: dict[str, Any], active: dict[str, Any]) -> Path:
    original_supervise = control.supervise
    with source_composition(source["sha256"]):
        v2 = control.load("w5_http_v2", "w5-candidate-actual-embedding-v2.py")
        original_runner, original_start = v2.v1_runner, v2.start_worker
        v2.V2_ENTRY = ENTRY

        def runner() -> Any:
            value = original_runner()
            control.MANIFEST = inventory.MANIFEST
            return value

        def start(job: Path, **kwargs: Any) -> Any:
            assert not active, "HTTP_ONE_WORKER_ONLY"
            active["job"] = job
            control.write_json(job / "inventory-parent-before.json", source)
            return original_start(job, **kwargs)

        def supervise(child: Any, phase_reader: Any, **kwargs: Any) -> Any:
            owned = NodeSupervisor(active["job"], source, child)
            active["node"] = owned

            def phase() -> Any:
                owned.poll()
                return continuous_phase(active["job"], phase_reader())

            try:
                return original_supervise(child, phase, **kwargs)
            finally:
                owned.close()

        v2.v1_runner, v2.start_worker = runner, start
        setattr(control, "supervise", supervise)
        try:
            job = v2.run_reviewed()
        finally:
            control.supervise = original_supervise
            if "job" in active:
                try:
                    after = inventory.verify_inventory(source["sha256"])
                except BaseException as error:
                    after = {"verified": False, "errorClass": type(error).__name__}
                control.write_json(active["job"] / "inventory-parent-after.json", after)
    return job


def run_reviewed() -> Path:
    source: dict[str, Any] = {"verified": False}
    active: dict[str, Any] = {}
    failure = None
    try:
        source = inventory.verify_inventory()
        job = _run_reviewed(source, active)
    except BaseException as error:
        failure = type(error).__name__
        job = active.get("job")
        if job is None:
            job = control.RUNTIME / f"w5-http-refused-{uuid.uuid4().hex}"
            job.mkdir()
        control.write_json(job / "http-parent-failure.json", {"errorClass": failure})
    result = finish_reports(job, source)
    if failure is not None:
        result.update(
            diagnosticSucceeded=False,
            completeHttpBudgetPassed=False,
            errorClass=failure,
        )
        control.write_json(job / "http-result.json", result)
    print(f"W5_HTTP_RESULT {job / 'http-result.json'}", flush=True)
    return job


def worker(job: Path) -> None:
    job = job.resolve()
    assert job.parent == control.RUNTIME.resolve() and job.name.startswith(
        "w5-actual-embedding-"
    )
    try:
        source = inventory.verify_inventory(
            control.read_json(job / "job.json")["sourceManifestSha256"]
        )
        v2 = control.load(
            "w5_http_worker_handshake", "w5-candidate-actual-embedding-v2.py"
        )
        v2.worker_handshake(job)
        with source_composition(source["sha256"]):
            from w5_http_composition import run_child

            run_child(job)
    except BaseException as error:
        if not (job / "child-failure.json").exists():
            control.write_json(
                job / "child-failure.json",
                {"errorClass": type(error).__name__, "stage": "http-worker"},
            )
        raise


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run-reviewed-clone", action="store_true")
    parser.add_argument("--owned-job", type=Path, help=argparse.SUPPRESS)
    args = parser.parse_args()
    if args.owned_job is not None:
        worker(args.owned_job)
    elif args.run_reviewed_clone:
        job = run_reviewed()
        result = control.read_json(job / "http-result.json")
        if not (result["diagnosticSucceeded"] and result["completeHttpBudgetPassed"]):
            raise SystemExit(1)
    else:
        print(
            "Parent-only HTTP diagnostic; executed=false; initialization=180s; overall=900s; Core HTTP=60000ms"
        )


if __name__ == "__main__":
    main()
