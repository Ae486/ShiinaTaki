"""Read retained relay evidence only; never import or execute the diagnostic packet."""

import base64
import hashlib
import json
from collections import Counter
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = Path(__file__).resolve().parent / "verification.json"
TOKEN = "9a276b18-7fa2-4421-869c-88f0d89aec01"
ARCHIVE = ROOT / ("c2b-relay-run-" + TOKEN)
PACKET = ROOT / "docker-loopback-relay"
EXPECTED = {
    "release.json": "2d3f0c9ad86bcb5e5d956e9d4797edee4e1056b274958ae781b548b4d8cb954f",
    "result.json": "474a4d60d3f4b7a99757b82850dfa9738ab3ac054ee7beefe7ccd393678250c6",
    "commands.json": "3702362c4771c20d1b26c5d86b7e5d576547242964ceed0b0c4821d2c83b49d2",
    "disposition.json": "301e687132732e24de30a0e81ed63ff952867668a4433f9fc18513e7643cfb6c",
}


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def read(path):
    return json.loads(path.read_bytes())


def stamp(value):
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def challenge(label, size):
    return b"".join(hashlib.sha256(f"{TOKEN}:{label}:{i}".encode()).digest()
                    for i in range((size + 31) // 32))[:size]


def lines(raw):
    return [json.loads(line) for line in raw.splitlines() if line]


r = read(ARCHIVE / "result.json")
c = read(ARCHIVE / "commands.json")
d = read(ARCHIVE / "disposition.json")
release = read(PACKET / "release.json")
pre = read(ROOT / "c2b-relay-root-preflight-01a180b6-02.json")
post = read(ROOT / "c2b-relay-root-readback-01a180b6.json")
execution = read(ROOT / "c2b-relay-root-execution-01a180b6.json")
hashes = {path.name: sha(path.read_bytes()) for path in ARCHIVE.iterdir()}
assert set(hashes) == set(d["hashes"]) | {"disposition.json"}
assert all(hashes[name] == value for name, value in EXPECTED.items())
assert all(hashes[name] == value for name, value in d["hashes"].items())
assert sha((PACKET / "release.json").read_bytes()) == EXPECTED["release.json"]
assert r["release"] == release == read(ARCHIVE / "release.json")
assert r["inputs"] == {"release.json": EXPECTED["release.json"], **release["files"]}
assert all(sha((PACKET / name).read_bytes()) == value == hashes[name]
           for name, value in release["files"].items())
assert sha((ROOT / "c2b-plan.md").read_bytes()) == release["acceptedPlanSha256"]
assert sha((ROOT / "c2b-topology-delta-review-2026-10-27.md").read_bytes()) == release["topologyReviewSha256"]
prior_failure = ROOT / "c2b-slice1-run-cb3b3ca9-5a01-4bc4-a734-8b48d7868489/result.json"
assert sha(prior_failure.read_bytes()) == "14f0fdfcb1e486694163b6b8f42662726cc23697bfe6295593d2e941ebe8ed93"
assert (ARCHIVE / ".c2b-relay-owner").read_bytes() == TOKEN.encode()
assert sum((ARCHIVE / name).stat().st_size for name in d["hashes"]) == d["stageBytes"] == 239280
assert not Path(release["evidence"]["stage"]).exists()
assert r["token"] == d["token"] == release["token"] == TOKEN
assert all(item["deploymentReady"] is False for item in [r, d, release, execution])
assert json.loads(execution["stdout"]) == d
assert execution["exitCode"] == 0 and execution["stderr"] == ""
assert execution["pid"] == r["hostPid"] == 31884
assert execution["releaseSha256"] == EXPECTED["release.json"]
assert post["dispositionSha256"] == EXPECTED["disposition.json"]

cid = r["containerId"]
name = "taki-c2b-relay-" + TOKEN
assert r["engine"] == {"Id": release["tools"]["engine"]["id"], "ServerVersion": "29.0.1", "OSType": "linux"}
assert all(json.loads(c[index]["stdout"]) == r["engine"] for index in [0, 6, 9, 12, 15, 18])
assert json.loads(c[1]["stdout"]) == r["image"] == {
    "Id": release["resource"]["imageId"], "Os": "linux", "Architecture": "amd64", "Volumes": None}
prefix = [release["tools"]["docker"]["path"], "--host", release["tools"]["engine"]["endpoint"],
          "--config", str(Path(release["evidence"]["stage"]) / "client-config")]
assert len(c) == 23 and [item["index"] for item in c] == list(range(23))
assert [item["phase"] for item in c] == ["runtime"] * 15 + ["cleanup"] * 8
assert [item["argv"][5] for item in c] == [
    "info", "image", "container", "create", "container", "start", "info", "container",
    "exec", "info", "container", "exec", "info", "container", "exec", "info", "container",
    "stop", "info", "container", "rm", "container", "container"]
command_rows = []
for index, item in enumerate(c):
    assert item["argv"][:5] == prefix
    assert item["code"] == (1 if index in (2, 21, 22) else 0)
    assert item["signal"] is None and item["closeObserved"] and not item["kills"]
    assert not any(item[key] for key in ["timedOut", "overflow", "spawnError", "persistenceError", "streamErrors"])
    out = base64.b64decode(item["stdout"], validate=True) if item["stdoutEncoding"] == "base64" else item["stdout"].encode()
    err = item["stderr"].encode()
    assert len(out) == item["stdoutBytes"] and sha(out) == item["stdoutSha256"]
    assert len(err) == item["stderrBytes"] and sha(err) == item["stderrSha256"]
    assert stamp(item["completedAt"]) >= stamp(item["dispatchedAt"]) >= stamp(r["timing"]["startedAt"])
    if index:
        assert stamp(item["dispatchedAt"]) > stamp(c[index - 1]["dispatchedAt"])
        if index != 6:  # The original attached server remains open until cleanup.
            assert stamp(item["dispatchedAt"]) >= stamp(c[index - 1]["completedAt"])
    command_rows.append({"index": index, "command": item["argv"][5], "pid": item["childPid"],
                         "exit": item["code"], "durationMs": (stamp(item["completedAt"]) - stamp(item["dispatchedAt"])).total_seconds() * 1000,
                         "stdinBytes": item["stdinBytes"], "stdoutBytes": len(out), "stderrBytes": len(err)})

entry = release["tools"]["imagePython"]
expected_create = ["create", "--name", name, "--label", "taki.c2b.relay=" + TOKEN,
                   "--label", "taki.c2b.role=loopback-transport-diagnostic", "--pull", "never", "--network", "none", "--read-only",
                   "--user", "1000:1000", "--interactive", "--log-driver", "none", "--memory", "256m", "--cpus", "1", "--pids-limit", "16",
                   "--cap-drop", "ALL", "--security-opt", "no-new-privileges=true", "--entrypoint", entry,
                   release["resource"]["imageId"], "-I", "-B", "-"]
assert c[3]["argv"][5:] == expected_create and c[3]["stdout"].strip() == cid
assert c[5]["argv"][5:] == ["start", "--attach", "--interactive", cid]
fixture_bytes = (ARCHIVE / "fixture-server.py").read_bytes()
assert c[5]["stdinSha256"] == sha(fixture_bytes) and c[5]["stdinBytes"] == len(fixture_bytes)
assert lines(c[5]["stdout"]) == r["fixtureEvents"]
assert c[17]["argv"][5:] == ["stop", "--time", "3", cid]
assert c[17]["stdout"].splitlines() == ["Flag --time has been deprecated, use --timeout instead", cid]
assert c[20]["argv"][5:] == ["rm", cid] and c[20]["stdout"].strip() == cid
for index, ref in [(2, name), (21, cid), (22, name)]:
    assert c[index]["argv"][5:8] == ["container", "inspect", ref]
    assert c[index]["stdout"].strip() == ""
    assert c[index]["stderr"].strip() == "Error response from daemon: No such container: " + ref

transfers = []
for pos, index, req_label, req_size, response_label, response_size in [
        (0, 8, "request", 32768, "response", 49152), (1, 11, "abort-request", 1024, "abort-ack", 512)]:
    request, response = challenge(req_label, req_size), challenge(response_label, response_size)
    assert c[index]["argv"][5:] == ["exec", "--interactive", "--user", "1000:1000", cid, entry, "-I", "-B", "-c",
                                   (ARCHIVE / "stream-relay.py").read_bytes().decode(), "taki-c2b-relay:" + TOKEN]
    assert base64.b64decode(c[index]["stdout"], validate=True) == response
    assert c[index]["stdinBytes"] == req_size and c[index]["stdinSha256"] == sha(request)
    events = lines(c[index]["stderr"])
    stream = r["streams"][pos]
    assert stream["events"] == events and stream["commandIndex"] == index
    completed = events[-1]
    assert completed["event"] == "complete"
    assert completed["received"] == {"stdin": req_size, "target": response_size}
    assert completed["sent"] == {"stdout": response_size, "target": req_size}
    assert completed["digests"] == {"stdin": sha(request), "target": sha(response)}
    assert sum(completed["readChunks"]["stdin"]) == req_size and sum(completed["readChunks"]["target"]) == response_size
    assert completed["stdinEof"] and completed["targetEof"] and completed["targetHalfClosed"]
    client = r["first" if pos == 0 else "second"]
    assert sum(client["writes"]) == client["requestBytes"] == stream["toChild"] == req_size
    assert client["receivedBytes"] == stream["toClient"] == response_size
    assert client["requestSha256"] == sha(request) and client["receivedSha256"] == sha(response)
    assert client["closeObserved"] and stream["clientClosed"] and not client["errors"]
    assert client["requestHalfClosed"] == stream["clientEnd"] == (pos == 0)
    assert client["abortIssued"] == stream["aborted"] == (pos == 1)
    assert stream["errors"] == ([] if pos == 0 else ["client:ECONNRESET"])
    transfers.append({"commandIndex": index, "requestBytes": req_size, "requestSha256": sha(request),
                      "responseBytes": response_size, "responseSha256": sha(response),
                      "readChunks": completed["readChunks"], "backpressure": stream["backpressure"]})

cases = [event for event in r["fixtureEvents"] if event["event"] == "case-complete"]
assert len(cases) == 2
for case, transfer in zip(cases, transfers):
    assert case["requestBytes"] == transfer["requestBytes"] and case["requestSha256"] == transfer["requestSha256"]
assert cases[0]["responseBytes"] == transfers[0]["responseBytes"] == sum(cases[0]["responseWrites"])
assert cases[0]["responseSha256"] == transfers[0]["responseSha256"] and cases[0]["requestEof"] and cases[0]["responseHalfClosed"]
assert cases[1]["ackBytes"] == transfers[1]["responseBytes"] and cases[1]["ackSha256"] == transfers[1]["responseSha256"]
assert cases[1]["cancelled"] and cases[1]["reason"] == "eof"

assert r["ready"] == r["fixtureEvents"][0]
ready = r["ready"]
process = ready["process"]
assert process["identity"] == {"pid": 1, "startTicks": "14725", "ppid": 0, "pgid": 1, "sid": 1}
assert process["uid"] == process["gid"] == [1000] * 4
assert all(int(value, 16) == 0 for value in process["capabilities"].values())
assert process["noNewPrivileges"] == "1" and process["bound"] == ["127.0.0.1", 8000]
row, = process["listenerRows"]
assert row[1] == "0100007F:1F40" and row[3] == "0A" and row[7] == "1000"
assert process["socketInode"] == "socket:[" + row[9] + "]"
network = ready["network"]
assert network["interfaces"] == [[1, "lo"]] and network["ipv4"] == "127.0.0.1"
assert not network["ipv4Routes"].splitlines()[1:]
for row in network["ipv6Routes"].splitlines():
    fields = row.split()
    assert fields[-1] == "lo"
    assert (int(fields[0], 16) == 1 and int(fields[1], 16) == 128) or (int(fields[0], 16) == 0 and int(fields[8], 16) & 0x200)
for row in network["ipv6Addresses"].splitlines():
    assert int(row.split()[0], 16) == 1 and row.split()[-1] == "lo"
assert [(p["family"], p["target"]) for p in ready["probes"]] == [(2, ["1.1.1.1", 443]), (2, ["169.254.1.1", 80]),
        (10, ["2606:4700:4700::1111", 443, 0, 0]), (10, ["fe80::1", 80, 0, 1])]
assert all(p["phase"] == "connect" and p["outcome"] == "error" and p["code"] == "ENETUNREACH" for p in ready["probes"])

expected_relays = [stream["events"][0]["identity"] for stream in r["streams"]]
observer_input = json.dumps({"server": {"pid": 1, "startTicks": "14725"}, "relays": expected_relays}, separators=(",", ":")).encode()
assert c[14]["argv"][5:] == ["exec", "--interactive", "--user", "1000:1000", cid, entry, "-I", "-B", "-c",
                            (ARCHIVE / "observe-reaping.py").read_bytes().decode()]
assert c[14]["stdinBytes"] == len(observer_input) and c[14]["stdinSha256"] == sha(observer_input)
reaping = json.loads(c[14]["stdout"])
assert reaping == r["reaping"]
for scan in [reaping["before"], reaping["after"]]:
    assert [item["expected"] for item in scan["original"]] == expected_relays
    assert all(item["current"] is None for item in scan["original"])
    assert scan["markerMatches"] == [] and scan["observedProcessCount"] == 2 and scan["excludedObserverPid"] == 20
assert reaping["originalServer"] == reaping["serverAfter"] == {"pid": 1, "startTicks": "14725", "state": "S"}
assert r["fixtureEvents"][-1]["event"] == "stopped" and r["fixtureEvents"][-1]["identity"] == process["identity"]

inspections = [json.loads(c[index]["stdout"]) for index in [4, 7, 10, 13, 16, 19]]
assert inspections == r["inspections"] and inspections[-1] == r["stoppedState"]
for state in inspections:
    assert state["Id"] == cid and state["Name"] == "/" + name and state["Image"] == release["resource"]["imageId"]
    assert state["Path"] == entry and state["Args"] == ["-I", "-B", "-"] and state["User"] == "1000:1000"
    assert state["Labels"] == {"taki.c2b.relay": TOKEN, "taki.c2b.role": "loopback-transport-diagnostic"}
    assert state["NetworkMode"] == "none" and state["Mounts"] == [] and not state["PortBindings"] and not state["Ports"]
    assert not state["Tty"] and state["OpenStdin"] and state["ReadonlyRootfs"] and not state["Privileged"]
    assert state["Memory"] == 268435456 and state["NanoCpus"] == 1000000000 and state["PidsLimit"] == 16
    assert state["CapDrop"] == ["ALL"] and not state["CapAdd"] and state["SecurityOpt"] == ["no-new-privileges=true"]
    assert state["LogConfig"] == {"Config": {}, "Type": "none"}
    assert state["RestartPolicy"] == {"MaximumRetryCount": 0, "Name": "no"} and not state["OOMKilled"]
    assert set(state["Networks"]) <= {"none"}
    for value in state["Networks"].values():
        assert not any(value[key] for key in ["Gateway", "IPv6Gateway", "IPAddress", "GlobalIPv6Address"])
assert [state["Status"] for state in inspections] == ["created"] + ["running"] * 4 + ["exited"]
assert len({state["StartedAt"] for state in inspections[1:]}) == 1
assert inspections[-1]["Pid"] == 0 and inspections[-1]["ExitCode"] == 0 and not inspections[-1]["Running"]

before = lines(pre["commands"][3]["stdout"])
after = lines(post["postCommands"][0]["stdout"])
assert pre["commands"][3]["exitCode"] == post["postCommands"][0]["exitCode"] == 0
assert pre["commands"][3]["stderr"] == post["postCommands"][0]["stderr"] == ""
assert before == pre["containers"] == after == post["containers"] and len(before) == 8
assert pre["commands"][2]["stdout"].splitlines() == [row["id"] for row in before]
assert pre["commands"][3]["args"][2:10] == post["postCommands"][0]["args"][2:10] == [row["id"] for row in before]
assert not any(row["id"] in item["argv"] for row in before for item in c)

t = r["timing"]
assert t["runtimeElapsedMs"] < 40000 and t["beforeArchiveElapsedMs"] < d["overallElapsedMs"] < 60000
assert abs(t["runtimeElapsedMs"] + t["cleanupElapsedMs"] - t["beforeArchiveElapsedMs"]) < 1
assert (stamp(c[-1]["completedAt"]) - stamp(t["startedAt"])).total_seconds() * 1000 <= t["beforeArchiveElapsedMs"]
assert stamp(execution["dispatchRecordedAt"]) < stamp(t["startedAt"]) < stamp(execution["completedAt"])
assert execution["outerElapsedMs"] == 8342 < 60000
assert r["hostListener"] == {"address": "127.0.0.1", "family": "IPv4", "port": 58118}
assert r["listenerExclusivity"] == {"refused": True, "code": "EADDRINUSE"}
assert r["cleanup"]["port"] == d["hostPort"] == {"free": True}

summary = {
    "verdict": "PASS_RETAINED_EVIDENCE", "runtimeExecutedByReviewer": False, "deploymentReady": False,
    "archiveSha256": hashes, "commandCount": len(c), "commandKinds": dict(Counter(item["argv"][5] for item in c)),
    "commands": command_rows, "transfers": transfers, "containerId": cid, "serverIdentity": process["identity"],
    "relayIdentities": expected_relays, "networkRefusals": [p["code"] for p in ready["probes"]],
    "stageBytes": d["stageBytes"], "stageAbsentAtReview": True, "unchangedWorkloads": len(before),
    "runtimeElapsedMs": t["runtimeElapsedMs"], "cleanupElapsedMs": t["cleanupElapsedMs"],
    "beforeArchiveElapsedMs": t["beforeArchiveElapsedMs"], "overallElapsedMs": d["overallElapsedMs"],
    "outerElapsedMs": execution["outerElapsedMs"],
    "limits": ["No runtime rerun", "Forced kill and pidfd waiting branches unexercised", "No throughput claim",
               "Host and Docker guest wall clocks are separate domains", "No installed Host, Native API, PG, authentication, receipt or setup acceptance"]
}
OUT.write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
print(json.dumps({"verdict": summary["verdict"], "commands": len(c), "archiveFiles": len(hashes),
                  "stageBytes": d["stageBytes"], "unchangedWorkloads": len(before), "output": str(OUT)}))
