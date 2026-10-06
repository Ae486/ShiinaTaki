"""Independent Windows custody/socket checks; no PG, corpus or model execution."""

from __future__ import annotations

import asyncio
import json
import os
import subprocess
import threading
import time
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from unittest.mock import patch

import pytest

import w5_actual_embedding_control as control
import w5_http_inventory as inventory

entry = control.load("w5_http_independent_entry", "w5-http-diagnostic.py")
v2 = control.load("w5_http_independent_v2", "w5-candidate-actual-embedding-v2.py")
EVIDENCE = control.HERE / "w5-http-independent-checks"
SOURCE_SHA = "921a6dc4ac0b3d80f880bca3a2b3679314be3800b3c77ffdbafa9584ab93d415"


@contextmanager
def owned_python():
    # Use the real direct Windows executable, not the venv launcher's descendant.
    child = subprocess.Popen(
        [str(v2.BASE_PYTHON), "-B", "-s", "-c", "import time; time.sleep(90)"],
        env=v2.direct_environment(control.clean_environment()),
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        creationflags=subprocess.CREATE_NO_WINDOW,
    )
    try:
        yield child
    finally:
        if child.poll() is None:
            child.terminate()
        child.wait(timeout=10)


@contextmanager
def local_refusal():
    paths = []

    class Refusal(BaseHTTPRequestHandler):
        def do_GET(self):
            paths.append(self.path)
            body = json.dumps({"error": "owned-independent-refusal"}).encode()
            self.send_response(503)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *_args):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Refusal)
    port = server.server_address[1]
    assert port not in {18495, 18496}
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield port, paths
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)
        assert not thread.is_alive()
        assert control.port_released(port)


def ready_job(root, child, port):
    job = root / "job"
    job.mkdir()
    clone = root / "w5-candidate-native-clone-independent-no-database"
    clone.mkdir()
    # Ownership-only fixture: no data directory, pg_ctl invocation or PG process.
    pointer = {
        "clone": str(clone),
        "data": str(clone / "data"),
        "port": 9,
        "postgres": str(control.POSTGRES),
    }
    control.write_json(
        clone / "ownership.json",
        {"data": pointer["data"], "port": 9, "kind": "candidate-diagnostic-clone"},
    )
    control.write_json(job / "clone.json", pointer)
    identity = control.ProcessIdentity(child.pid)
    try:
        control.write_json(job / "child.json", identity.value)
        endpoint = f"http://127.0.0.1:{port}"
        control.write_json(
            job / "http-input.json",
            {"endpoint": endpoint, "bank": "owned", "transition": "owned"},
        )
        control.write_json(
            job / "http-ready.json",
            {
                "job": str(job.resolve()),
                "python": identity.value,
                "clone": str(clone.resolve()),
                "endpoint": endpoint,
                "actorVerified": True,
                "inputSha256": control.digest(job / "http-input.json"),
            },
        )
    finally:
        identity.close()
    return job


def test_real_windows_node_admission_and_refusal_cleanup(tmp_path):
    """Actual final client verifies all sources, waits for parent and sends one GET."""
    source = inventory.verify_inventory(SOURCE_SHA)
    with owned_python() as python, local_refusal() as (port, paths):
        job = ready_job(tmp_path, python, port)
        owned = entry.NodeSupervisor(job, source, python)
        with patch.object(control, "RUNTIME", tmp_path):
            try:
                started = time.monotonic()
                admission_ms = None
                while True:
                    owned.poll()
                    if owned.admitted and admission_ms is None:
                        admission_ms = (time.monotonic() - started) * 1000
                    if owned.child is not None and owned.child.poll() is not None:
                        break
                    assert time.monotonic() - started < 35
                    time.sleep(0.025)
                assert owned.admitted and admission_ms < 10000
                assert owned.child.returncode == 1
                assert paths == ["/health"]
                assert control.read_json(job / "inventory-node-before.json") == source
                assert control.read_json(job / "inventory-node-after.json") == source
                node_self = control.read_json(job / "node-self.json")
                assert node_self["parentPid"] == os.getpid()
                assert node_self["pid"] == owned.child.pid != python.pid
                result = control.read_json(job / "http-node-result.json")
                assert not result["diagnosticSucceeded"]
                assert not result["completeHttpBudgetPassed"]
                assert result["claims"] == result["applyPosts"] == 0
            finally:
                owned.close()
        cleanup = control.read_json(job / "node-cleanup.json")
        assert cleanup["stopped"] and cleanup["admitted"] and cleanup["exitCode"] == 1
        assert owned.identity.handle is None
        assert python.poll() is None
        EVIDENCE.mkdir(exist_ok=True)
        control.write_json(
            EVIDENCE / "windows-handshake.json",
            {
                "source": source,
                "admissionMilliseconds": admission_ms,
                "nodeSelf": node_self,
                "nodeCleanup": cleanup,
                "nodeResult": result,
                "socketPaths": paths,
                "pythonSiblingStillLiveBeforeOwnCleanup": True,
                "meaning": "Actual NodeSupervisor and final Node client; owned refusal socket; no PG/model/corpus",
            },
        )


def test_real_node_handshake_timeout_reaps_original_handle(tmp_path):
    """Fast-forward only the deadline after real Popen; no source-verifier bypass."""
    source = {"sha256": SOURCE_SHA, "entries": 5084, "verified": True}
    with owned_python() as python, local_refusal() as (port, paths):
        job = ready_job(tmp_path, python, port)
        owned = entry.NodeSupervisor(job, source, python)
        with patch.object(control, "RUNTIME", tmp_path):
            try:
                owned.poll()
                assert owned.child.poll() is None and not owned.admitted
                owned.started -= 11
                with pytest.raises(AssertionError, match="HANDSHAKE_TIMEOUT"):
                    owned.poll()
            finally:
                owned.close()
        assert not (job / "node-admission.json").exists()
        assert not paths
        assert owned.child.poll() is not None and owned.identity.handle is None
        cleanup = control.read_json(job / "node-cleanup.json")
        assert cleanup["terminatedHeldChild"] and cleanup["stopped"]
        assert python.poll() is None


def test_late_ready_cannot_reset_initialization_anchor(tmp_path):
    control.write_json(
        tmp_path / "http-initialization.json",
        {
            "monotonic": 0,
            "ready": False,
        },
    )
    assert entry.continuous_phase(
        tmp_path, {"phase": "initialized", "monotonic": 179}
    ) == {
        "phase": "initializing",
        "monotonic": 0,
    }
    for elapsed in (180000, 180001):
        control.write_json(
            tmp_path / "http-initialization.json",
            {
                "monotonic": 0,
                "ready": True,
                "milliseconds": elapsed,
            },
        )
        with pytest.raises(AssertionError, match="COMPLETED_LATE"):
            entry.continuous_phase(tmp_path, {"phase": "initialized", "monotonic": 179})


@pytest.mark.asyncio
@pytest.mark.skipif(
    "TAKI_G1_FIXTURE_PORT" not in os.environ, reason="owned PG runner only"
)
async def test_independent_owned_pg_with_sealed_evidence_preserved(
    tmp_path, monkeypatch
):
    """Reuse the genuine fixture while redirecting only its evidence destination."""
    import test_w5_http_diagnostic as delivered

    sealed = control.HERE / "w5-http-checks/fixture-wiring.json"
    before = control.digest(sealed)
    original_write = control.write_json
    writes = []

    def independent_write(path, value):
        if path.resolve() == sealed.resolve():
            path = EVIDENCE / "fixture-wiring.json"
            writes.append(str(path))
        original_write(path, value)

    EVIDENCE.mkdir(exist_ok=True)
    try:
        with patch.object(control, "write_json", independent_write):
            await asyncio.wait_for(
                delivered.test_owned_pg_actual_uvicorn_and_core_client(
                    tmp_path, monkeypatch
                ),
                timeout=120,
            )
        assert writes == [str(EVIDENCE / "fixture-wiring.json")]
        report = control.read_json(EVIDENCE / "fixture-wiring.json")
        assert report["http"]["diagnosticSucceeded"]
        assert report["http"]["completeHttpBudgetPassed"]
        assert report["http"]["claims"] == report["http"]["applyPosts"] == 1
        assert report["http"]["exactLookupMatches"]
        assert report["serverDrained"] and report["httpPortReleased"]
    finally:
        assert control.digest(sealed) == before


@pytest.mark.parametrize(
    "fault",
    [
        "duration",
        "negative",
        "string",
        "null",
        "nan",
        "infinity",
        "bool",
        "lookup",
        "apply-incomplete",
        "apply-not-returned",
        "duplicate-post",
        "duplicate-claim",
        "bool-count",
        "missing-duration",
        "missing-count",
        "request-hash",
        "result-hash",
        "proof-count",
        "input-missing",
        "input-digest",
        "transport-post",
        "transport-path",
        "transport-incomplete",
        "transport-status",
        "transport-status-missing",
    ],
)
def test_complete_report_rejects_contradictory_http_evidence(tmp_path, fault):
    """Self-reported success flags cannot override missing or contradictory proof."""
    import test_w5_http_diagnostic as delivered

    source = delivered.complete_reports(tmp_path)
    actual = control.read_json(EVIDENCE / "fixture-wiring.json")["http"]
    assert actual["diagnosticSucceeded"] and actual["completeHttpBudgetPassed"]
    original = control.read_json(tmp_path / "result.json")
    original["childReport"]["persistedDelta"] = {
        key: actual[key]
        for key in ("requestHash", "resultHash", "mappings", "artifacts")
    }
    control.write_json(
        tmp_path / "http-input.json", {"requestHash": actual["requestHash"]}
    )
    control.write_json(
        tmp_path / "http-ready.json",
        {
            "inputSha256": control.digest(tmp_path / "http-input.json"),
        },
    )
    original["childReport"]["http"] = actual
    control.write_json(tmp_path / "result.json", original)
    control.write_json(tmp_path / "http-node-result.json", actual)
    assert entry.finish_reports(tmp_path, source)["completeHttpBudgetPassed"]
    if fault == "duration":
        actual["publicMilliseconds"] = 60000
    elif fault in ("negative", "string", "null", "nan", "infinity", "bool"):
        actual["publicMilliseconds"] = {
            "negative": -1,
            "string": "5",
            "null": None,
            "nan": float("nan"),
            "infinity": float("inf"),
            "bool": True,
        }[fault]
    elif fault == "lookup":
        actual["exactLookupMatches"] = False
    elif fault == "apply-incomplete":
        actual["applyCompleted"] = False
    elif fault == "apply-not-returned":
        actual["applyReturned"] = False
    elif fault == "duplicate-post":
        actual["applyPosts"] = 2
    elif fault == "duplicate-claim":
        actual["claims"] = 2
    elif fault == "bool-count":
        actual["claims"] = True
    elif fault == "missing-duration":
        actual.pop("publicMilliseconds")
    elif fault == "missing-count":
        actual.pop("claims")
    elif fault == "request-hash":
        actual["requestHash"] = "0" * 64
    elif fault == "result-hash":
        actual["resultHash"] = "0" * 64
    elif fault == "proof-count":
        actual["mappings"] += 1
    elif fault == "input-missing":
        (tmp_path / "http-input.json").unlink()
    elif fault == "input-digest":
        control.write_json(tmp_path / "http-ready.json", {"inputSha256": "0" * 64})
    elif fault == "transport-post":
        actual["transports"].append(
            {
                "method": "POST",
                "path": "/extra/executor/delta",
                "completed": True,
                "status": 200,
            }
        )
    elif fault == "transport-path":
        actual["transports"][0]["path"] = None
    elif fault == "transport-incomplete":
        actual["transports"][0]["completed"] = False
    elif fault == "transport-status":
        actual["transports"][0]["status"] = 503
    elif fault == "transport-status-missing":
        actual["transports"][0].pop("status")
    else:
        raise AssertionError("unknown fault")
    control.write_json(tmp_path / "result.json", original)
    control.write_json(tmp_path / "http-node-result.json", actual)
    final = entry.finish_reports(tmp_path, source)
    assert not final["diagnosticSucceeded"] and not final["completeHttpBudgetPassed"]
