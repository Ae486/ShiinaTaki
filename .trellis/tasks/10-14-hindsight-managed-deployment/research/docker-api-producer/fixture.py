"""Generated admission for one producer generation; Root explicitly starts the same CID twice."""

import hashlib
import json
import os
import secrets
import signal
import sys
import time
import uuid
from dataclasses import asdict
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, "/opt/taki-c2b-producer")
sys.path.insert(0, "/opt/taki-c2b-application")
from artifact_io import file_fact, tree
from fixture_support import CONFIGURATION, PRODUCER, ROOT, RUNTIME, TOKEN, FixtureFailure, command, encode, exclusive, http_evidence, previous_result, privacy_scan, read, require
from managed_bootstrap.api_artifact import require_artifact
from managed_bootstrap.api_consumer import C2ApiConsumer
from managed_bootstrap.api_state import ProcessIdentity
from managed_bootstrap.bootstrap import Bootstrap, LiveGrant
from managed_bootstrap.protocol import Binding, Credential, FixedSelection, PrivateFrame, Selection, Slot, encode_private


def source_gate() -> dict:
    manifest = json.loads(read(PRODUCER / "producer-manifest.json", 128 * 1024))
    require(manifest["token"] == TOKEN, "source_token")
    for name, fact in manifest["fixtureFiles"].items():
        if name != "install-producer.py":
            require(file_fact(PRODUCER / name) == fact, "fixture_source_changed")
    actual = tree(Path("/opt/taki-c2b-application/managed_bootstrap"))
    require(actual["entries"] == manifest["bootstrap"]["entries"], "bootstrap_changed")
    require_artifact()
    return {"bootstrapSha256": actual["sha256"], "producerManifestSha256": hashlib.sha256(read(PRODUCER / "producer-manifest.json", 128 * 1024)).hexdigest()}


def private_environments(observation, values: dict[Slot, str]) -> dict:
    api_environment = read(Path("/proc") / str(observation.process.pid) / "environ", 256 * 1024)
    expected = b"HINDSIGHT_API_TENANT_API_KEY=" + values[Slot.CONNECTION].encode()
    require(expected in api_environment.split(b"\0"), "api_connection_not_private")
    for slot, value in values.items():
        if slot != Slot.CONNECTION:
            require(value.encode() not in api_environment, "model_slot_applied")
    identities = [observation.process, observation.database.postmaster, observation.database.logger]
    for identity in identities:
        require(identity.same_process(ProcessIdentity.read(identity.pid)), "process_identity_changed")
        raw = read(Path("/proc") / str(identity.pid) / "cmdline", 32768)
        require(not any(value.encode() in raw for value in values.values()), "credential_in_argv")
        if identity.pid != observation.process.pid:
            raw = read(Path("/proc") / str(identity.pid) / "environ", 256 * 1024)
            require(not any(value.encode() in raw for value in values.values()), "postgres_credential_inheritance")
    return {"apiSlots": [Slot.CONNECTION.value], "postgresSlots": [], "modelSlotsApplied": False, "rawEnvironmentEmitted": False}


def phase_admission(request: dict) -> dict | None:
    owner = ROOT / ".c2b-api-producer-fixture"
    require(ROOT.resolve() == ROOT and ROOT.stat().st_uid == ROOT.stat().st_gid == 1000, "volume_owner")
    require(RUNTIME.resolve() == RUNTIME and RUNTIME.stat().st_uid == RUNTIME.stat().st_gid == 1000
            and RUNTIME.stat().st_mode & 0o777 == 0o700, "runtime_owner")
    require(not any(RUNTIME.iterdir()), "runtime_not_fresh")
    if request["phase"] == "first":
        require(not list(ROOT.iterdir()), "volume_not_fresh")
        exclusive(owner, TOKEN.encode())
        previous = None
    else:
        require(read(owner) == TOKEN.encode(), "volume_token")
        raw = read(ROOT / "fixture-first.json")
        previous = previous_result(raw, request["firstSha256"])
    exclusive(ROOT / ("fixture-" + request["phase"] + ".started"), encode(request))
    return previous


def run() -> dict:
    started = time.monotonic()
    work_deadline = started + 140
    hard_deadline = started + 180
    report = {"schema": "c2b-generated-producer-run-v1", "token": TOKEN, "complete": False, "deploymentReady": False,
              "admission": "generated in-process fixture only; no installed Core/Host provenance or setup receipt",
              "failure": None, "cleanupChecked": False}
    owner = None
    consumer = None
    values: dict[Slot, str] = {}
    stopping = False

    def interrupted(_number: int, _frame: object) -> None:
        nonlocal stopping
        if stopping or time.monotonic() >= hard_deadline:
            os._exit(72)
        stopping = True
        signal.setitimer(signal.ITIMER_REAL, max(0.001, hard_deadline - time.monotonic()))
        raise FixtureFailure("fixture_interrupted")

    signal.signal(signal.SIGTERM, interrupted)
    signal.signal(signal.SIGINT, interrupted)
    signal.signal(signal.SIGALRM, interrupted)
    signal.setitimer(signal.ITIMER_REAL, 140)
    try:
        require(len(sys.argv) == 1 and sys.flags.isolated and sys.flags.no_site and sys.dont_write_bytecode
                and sys.platform == "linux" and os.getpid() == 1 and os.getuid() == os.getgid() == 1000, "fixture_context")
        os.environ.clear()
        request = command(sys.stdin.buffer.read(257))
        report["phase"] = request["phase"]
        report["source"] = source_gate()
        previous = phase_admission(request)
        values = {slot: "C2B_GENERATED_" + secrets.token_hex(32) for slot in Slot}

        def consume(credentials):
            require(consumer is not None, "consumer_missing")
            return consumer(credentials)

        owner = Bootstrap(CONFIGURATION, consume)
        consumer = C2ApiConsumer(owner.startup_id, CONFIGURATION, owner.remaining)
        binding = Binding(owner.startup_id, CONFIGURATION, str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4()),
                          (datetime.now(timezone.utc) + timedelta(seconds=80)).isoformat())
        selection = FixedSelection(tuple(Selection(slot, "catalog") for slot in Slot))
        owner.authorize(LiveGrant(binding, selection))
        frame = PrivateFrame(binding, tuple(Credential(slot, "catalog", values[slot]) for slot in Slot))
        accepted_at = time.monotonic()
        accepted = owner.accept(encode_private(frame))
        report["launchAckMs"] = round((time.monotonic() - accepted_at) * 1000)
        require(accepted.state == "running" and accepted.binding == binding and report["launchAckMs"] <= 5000, "launch_ack")
        ready_deadline = min(work_deadline, accepted_at + 65)
        while True:
            require(time.monotonic() < ready_deadline, "producer_ready_deadline")
            observed = consumer.observe()
            require(observed.phase not in {"unavailable", "stopped", "stopping"}, "producer_became_unavailable")
            if observed.native_ready:
                break
            time.sleep(0.05)
        require(observed.database is not None and observed.provider_lineage is not None, "ready_evidence_missing")
        report["ready"] = asdict(observed)
        if previous is not None:
            first = previous["ready"]
            require(observed.startup_id != first["startup_id"] and observed.cluster_id == first["cluster_id"]
                    and observed.provider_lineage == first["provider_lineage"], "restart_lineage_changed")
            require(observed.database.launch.pid == observed.database.postmaster.pid
                    and observed.database.launch.executable.endswith("/bin/postgres"), "restart_not_raw_postgres")
            report["firstSha256"] = request["firstSha256"]
        else:
            require(observed.database.launch.executable.endswith("/pg0/bin/pg0"), "first_not_pg0")
        report["http"] = http_evidence(values[Slot.CONNECTION], work_deadline, observed.provider_lineage)
        report["privacy"] = private_environments(observed, values)
        report["credentialsGenerated"] = len(values)
    except Exception as error:
        report["failure"] = str(error) if isinstance(error, FixtureFailure) else type(error).__name__
    finally:
        signal.setitimer(signal.ITIMER_REAL, max(0.001, hard_deadline - time.monotonic()))
        stopping = True
        stop_started = time.monotonic()
        if owner is not None:
            try:
                status = owner.close()
                require(status.state == "stopped" and status.reason is None, "bootstrap_stop_unproven")
                stopped = consumer.observe()
                require(stopped.phase == "stopped" and stopped.shutdown_checked is True and not stopped.native_ready,
                        "child_stop_unproven")
                require(ProcessIdentity.read(stopped.process.pid) is None, "api_child_remaining")
                require(stopped.database is not None and ProcessIdentity.read(stopped.database.postmaster.pid) is None
                        and ProcessIdentity.read(stopped.database.logger.pid) is None, "pg_writer_remaining")
                require(not (ROOT / "c2b-api-db/data/postmaster.pid").exists(), "postmaster_pid_remaining")
                last_stop = json.loads(read(ROOT / "c2b-api-db/last-stop.json"))
                require(last_stop["startup_id"] == stopped.startup_id and last_stop["cluster_id"] == stopped.cluster_id
                        and last_stop["checked"] is True and last_stop["api_closed"] is True, "last_stop_binding")
                report["stopped"] = asdict(stopped)
                report["lastStop"] = last_stop
                report["closeElapsedMs"] = round((time.monotonic() - stop_started) * 1000)
                require(report["closeElapsedMs"] <= 30000, "outer_close_deadline")
                report["cleanupChecked"] = True
            except Exception as error:
                report["cleanupFailure"] = str(error) if isinstance(error, FixtureFailure) else type(error).__name__
        if report["cleanupChecked"] and values:
            try:
                report["privacyScan"] = privacy_scan([value.encode() for value in values.values()], min(hard_deadline - 2, time.monotonic() + 30))
            except Exception as error:
                report["failure"] = report["failure"] or (str(error) if isinstance(error, FixtureFailure) else type(error).__name__)
        report["complete"] = bool(report["failure"] is None and report["cleanupChecked"] and report.get("privacyScan", {}).get("complete"))
        report["elapsedMs"] = round((time.monotonic() - started) * 1000)
        raw = encode(report)
        require(len(raw) <= 65536 and not any(value.encode() in raw for value in values.values()), "report_credential_or_bound")
        if "phase" in report:
            exclusive(ROOT / ("fixture-" + report["phase"] + ".json"), raw)
        values.clear()
        signal.setitimer(signal.ITIMER_REAL, 0)
    return report


if __name__ == "__main__":
    try:
        outcome = run()
        sys.stdout.buffer.write(encode(outcome))
        raise SystemExit(0 if outcome["complete"] else 2)
    except Exception:
        sys.stdout.buffer.write(encode({"schema": "c2b-generated-producer-run-v1", "token": TOKEN,
                                      "complete": False, "deploymentReady": False, "failure": "fixture_failed_before_final_report"}))
        raise SystemExit(2) from None
