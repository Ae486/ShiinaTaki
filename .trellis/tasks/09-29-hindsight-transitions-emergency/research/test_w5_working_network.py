"""Synthetic-only DNS/guard/latch wiring; no real DNS, model, database or service."""

from __future__ import annotations

import asyncio
import json
import socket
import ssl
import sys
from pathlib import Path
from types import SimpleNamespace
from typing import cast
from unittest.mock import AsyncMock, Mock, patch

import httpx
import pytest
from w5_actual_embedding_control import load, write_json
from w5_reentry_gate import IDENTITY_FIELDS, ReentryGate

subject = load("w5_working_network_test_subject", "w5-working-network-continuation.py")
VALIDATION = subject.HERE.parents[1] / "08-09-hindsight-initial-cutover/research/validation"
sys.path.insert(0, str(VALIDATION))
import real_hindsight_network as network  # noqa: E402 -- task-owned source, no runtime access on import.


def test_default_and_existing_approval_arguments_are_unchanged(capsys) -> None:
    with patch.object(subject, "run", side_effect=AssertionError("must be inert")):
        assert subject.main([]) == 0
        assert json.loads(capsys.readouterr().out)["executed"] is False
    argv = ["--run-reviewed-working-copy", "--maintenance-approval", "review.json", "--submission-cap", "484"]
    with patch.object(subject, "run", return_value=7) as run:
        assert subject.main(argv) == 7
        args = run.call_args.args[0]
        assert args.submission_cap == 484 and args.maintenance_approval == Path("review.json")
    for argv in (["--submission-cap", "485"], ["--stage", "return"], ["--reentry-renewal", "renewal.json"]):
        with pytest.raises(SystemExit):
            subject.main(argv)


@pytest.fixture
def dns_guard(tmp_path: Path, monkeypatch):
    hooks = []
    answer = {"ip": "1.1.1.1", "fail": False}
    calls = []

    def resolve(host, port, *args, **kwargs):
        for hook in hooks:
            hook("socket.getaddrinfo", (host, port, 0, socket.SOCK_STREAM, 0))
        if answer["fail"]:
            raise socket.gaierror("synthetic resolution failure")
        value = "127.0.0.1" if host == "127.0.0.1" else answer["ip"]
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", (value, int(port)))]

    async def connect(loop, factory, host=None, port=None, **kwargs):
        calls.append((host, port, kwargs))
        return "synthetic-connected"

    monkeypatch.setattr(socket, "getaddrinfo", resolve)
    monkeypatch.setattr(socket, "socketpair", socket.socketpair)
    monkeypatch.setattr(asyncio.BaseEventLoop, "create_connection", connect)
    monkeypatch.setattr(sys, "addaudithook", hooks.append)
    controller = subject.NetworkContinuation(tmp_path)
    controller.bind("a" * 32)
    listener = SimpleNamespace(fileno=lambda: 1, getsockname=lambda: ("127.0.0.1", 19192), getsockopt=lambda *a: 1)
    return controller, answer, calls, listener


@pytest.mark.asyncio
async def test_exact_successful_dns_rotation_updates_same_original_guard_and_tls(dns_guard) -> None:
    controller, answer, calls, listener = dns_guard
    addresses = controller.install_guard(network.install_guard, 19191, listener, model_access=True)
    assert addresses == {subject.HOST, "1.1.1.1"}
    with pytest.raises(RuntimeError, match=subject.REFUSAL):
        await asyncio.BaseEventLoop.create_connection(
            cast(asyncio.BaseEventLoop, asyncio.get_running_loop()), asyncio.Protocol, "8.8.8.8", 443
        )
    answer["ip"] = "8.8.8.8"
    socket.getaddrinfo(subject.HOST.encode(), 443, type=socket.SOCK_STREAM)
    assert controller.addresses is addresses and "8.8.8.8" in addresses
    tls = ssl.create_default_context()
    assert tls.check_hostname and tls.verify_mode == ssl.CERT_REQUIRED
    assert (
        await asyncio.BaseEventLoop.create_connection(
            cast(asyncio.BaseEventLoop, asyncio.get_running_loop()),
            asyncio.Protocol,
            "8.8.8.8",
            443,
            ssl=tls,
            server_hostname=subject.HOST,
        )
        == "synthetic-connected"
    )
    assert calls[-1][2] == {"ssl": tls, "server_hostname": subject.HOST}
    events = [json.loads(line) for line in controller.output.read_text().splitlines()]
    assert any(event["kind"] == "actual-guard-refusal" and event["host"] == "8.8.8.8" for event in events)
    assert any(event["kind"] == "rotated-model-address-connect" and event["host"] == "8.8.8.8" for event in events)
    assert any(
        event.get("addedAddresses") == ["8.8.8.8"] and event["initialGuardWouldReject"] == ["8.8.8.8"]
        for event in events
    )


@pytest.mark.asyncio
async def test_foreign_domain_port_proxy_and_loopback_rules_stay_exact(dns_guard) -> None:
    controller, answer, calls, listener = dns_guard
    addresses = controller.install_guard(network.install_guard, 19191, listener, model_access=True)
    for host, port in (
        ("foreign.invalid", 443),
        (subject.HOST, 80),
        (subject.HOST + ".invalid", 443),
        ("127.0.0.1", 19193),
    ):
        with pytest.raises(RuntimeError, match=subject.REFUSAL):
            socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    for port in (19191, 19192):
        assert (
            await asyncio.BaseEventLoop.create_connection(
                cast(asyncio.BaseEventLoop, asyncio.get_running_loop()), asyncio.Protocol, "127.0.0.1", port
            )
            == "synthetic-connected"
        )
    assert addresses == {subject.HOST, "1.1.1.1"}
    answer["ip"] = "8.8.4.4"
    socket.getaddrinfo("1.1.1.1", 443, type=socket.SOCK_STREAM)
    assert "8.8.4.4" not in addresses  # A raw-IP lookup cannot refresh the model domain.


def test_failed_resolution_and_private_answers_never_expand_permission(dns_guard) -> None:
    controller, answer, calls, listener = dns_guard
    addresses = controller.install_guard(network.install_guard, 19191, listener, model_access=True)
    answer["fail"] = True
    with pytest.raises(socket.gaierror):
        socket.getaddrinfo(subject.HOST, 443)
    assert addresses == {subject.HOST, "1.1.1.1"}
    answer["fail"] = False
    for value in ("127.0.0.1", "10.0.0.1", "169.254.1.2", "224.0.0.1", "0.0.0.0"):
        answer["ip"] = value
        socket.getaddrinfo(subject.HOST, 443)
        assert value not in addresses


def test_no_model_approval_cannot_enable_dns(dns_guard) -> None:
    controller, answer, calls, listener = dns_guard
    addresses = controller.install_guard(network.install_guard, 19191, listener, model_access=False)
    assert not addresses
    with pytest.raises(RuntimeError, match=subject.REFUSAL):
        socket.getaddrinfo(subject.HOST, 443)
    assert not addresses and not calls


def approved_gate(root: Path, attempt: str):
    write_json(root / "model-submissions.json", {"submitted": 301})
    bank = {name: name + "-synthetic" for name in IDENTITY_FIELDS}
    bank["maxSubmissions"] = 183
    approval = {
        "version": 1,
        "cumulativeCap": 484,
        "banks": [bank],
        "transitionId": bank["transitionId"],
        "returnReceiptId": "return-synthetic",
    }
    path = root / "approval.json"
    write_json(path, approval)
    gate = ReentryGate(root, engine=object(), supervisor_attempt=attempt, cumulative_cap=484, approval_path=path)
    budget_module = load("w5_working_network_test_budget", "w5-model-budget.py")
    budget = budget_module.ModelSubmissionBudget(root, {"modelRequests": 0}, cap=484)
    return gate, budget, bank


@pytest.mark.asyncio
async def test_failure_latch_precedes_both_budget_reservations_and_preserves_loopback(
    tmp_path: Path, monkeypatch
) -> None:
    controller = subject.NetworkContinuation(tmp_path)
    controller.bind("b" * 32)
    gate, budget, allowance = approved_gate(tmp_path, controller.attempt)
    delegate = AsyncMock(side_effect=httpx.ConnectError("PRIVATE-SENTINEL"))
    monkeypatch.setattr(httpx.AsyncClient, "send", delegate)
    controller.observe(network.observe_model_calls, tmp_path)
    send = httpx.AsyncClient.send
    request = httpx.Request(
        "POST",
        "https://api.deepseek.com/chat/completions",
        headers={"Authorization": "PRIVATE-SENTINEL"},
        content=b"PRIVATE-SENTINEL",
    )
    with gate.execution(allowance):
        with pytest.raises(httpx.ConnectError, match="PRIVATE-SENTINEL"):
            await controller.gate_send(ReentryGate.send, gate, send, budget, object(), request)
        before_usage = json.loads(gate.usage_path.read_text())
        assert budget.state["submitted"] == 302
        for _ in range(3):
            with pytest.raises(RuntimeError, match="CONNECTION_FAILURE_REVIEW_REQUIRED"):
                await controller.gate_send(ReentryGate.send, gate, send, budget, object(), request)
        # Simulate a new interpreter's in-memory flag; the durable latch still blocks.
        controller.failed = False
        with pytest.raises(RuntimeError, match="CONNECTION_FAILURE_REVIEW_REQUIRED"):
            await controller.gate_send(ReentryGate.send, gate, send, budget, object(), request)
    assert budget.state["submitted"] == 302 and json.loads(gate.usage_path.read_text()) == before_usage
    assert delegate.await_count == 1
    latch = json.loads((tmp_path / subject.LATCH).read_text())
    assert latch["submissionAtSend"] == 302 and latch["reviewRequired"]
    assert "PRIVATE-SENTINEL" not in controller.output.read_text()
    assert "PRIVATE-SENTINEL" not in (tmp_path / subject.LATCH).read_text()
    local = AsyncMock(return_value="owned-loopback")
    assert (
        await controller.gate_send(
            ReentryGate.send, gate, local, budget, object(), httpx.Request("GET", "http://127.0.0.1:19192/health")
        )
        == "owned-loopback"
    )
    assert budget.state["submitted"] == 302


@pytest.mark.asyncio
async def test_no_approval_raw_ip_and_foreign_transition_never_reserve(tmp_path: Path) -> None:
    controller = subject.NetworkContinuation(tmp_path)
    controller.bind("c" * 32)
    gate, budget, allowance = approved_gate(tmp_path, controller.attempt)
    delegate = AsyncMock()
    with pytest.raises(RuntimeError, match="UNAPPROVED_MODEL_REQUEST"):
        await controller.gate_send(
            ReentryGate.send,
            gate,
            delegate,
            budget,
            object(),
            httpx.Request("POST", "https://api.deepseek.com/chat/completions"),
        )
    with gate.execution(allowance), pytest.raises(RuntimeError, match="FOREIGN_NETWORK_REQUEST"):
        await controller.gate_send(
            ReentryGate.send,
            gate,
            delegate,
            budget,
            object(),
            httpx.Request("POST", "https://1.1.1.1/chat/completions"),
        )
    snapshot = {**allowance, "transitionId": "foreign-transition"}
    with pytest.raises(AssertionError):
        gate.allowance(snapshot, {"receiptId": "return-synthetic"})
    assert budget.state["submitted"] == 301 and not gate.usage["plans"]
    delegate.assert_not_awaited()


@pytest.mark.asyncio
async def test_http_response_and_diagnostic_io_do_not_hide_primary_error(tmp_path: Path, monkeypatch) -> None:
    controller = subject.NetworkContinuation(tmp_path)
    controller.bind("d" * 32)
    response = httpx.Response(401, request=httpx.Request("HEAD", "https://api.deepseek.com/"))
    original = AsyncMock(return_value=response)
    client = cast(httpx.AsyncClient, object())
    monkeypatch.setattr(httpx.AsyncClient, "send", original)
    controller.observe(lambda root: None, tmp_path)
    assert await httpx.AsyncClient.send(client, response.request) is response
    assert not (tmp_path / subject.LATCH).exists()
    error = httpx.ConnectError("private")
    original.side_effect = error
    monkeypatch.setattr(controller, "record", Mock(side_effect=OSError("synthetic disk error")))
    with pytest.raises(httpx.ConnectError) as caught:
        await httpx.AsyncClient.send(client, response.request)
    assert caught.value is error and controller.diagnostic_errors == 1 and controller.failed
    assert (tmp_path / subject.LATCH).exists()


def test_latched_entry_cannot_start_old_supervisor(tmp_path: Path, monkeypatch) -> None:
    (tmp_path / subject.LATCH).write_text("incomplete latch", encoding="utf-8")
    monkeypatch.setattr(subject.entry, "ROOT", tmp_path)
    monkeypatch.setattr(subject, "verify_sources", lambda: "synthetic-source")
    old = Mock(side_effect=AssertionError("must not start"))
    monkeypatch.setattr(subject.entry, "run_reviewed", old)
    with pytest.raises(RuntimeError, match="CONNECTION_FAILURE_REVIEW_REQUIRED"):
        subject.run(subject.entry.arguments(["--run-reviewed-working-copy"]))
    old.assert_not_called()


def test_exhausted_existing_approval_does_not_restart_services(tmp_path: Path, monkeypatch) -> None:
    write_json(tmp_path / "model-submissions.json", {"submitted": 484})
    approval_path = tmp_path / "approval.json"
    write_json(approval_path, {"banks": [{"bankId": "synthetic"}]})
    monkeypatch.setattr(subject.entry, "ROOT", tmp_path)
    monkeypatch.setattr(subject, "verify_sources", lambda: "synthetic-source")
    old = Mock(side_effect=AssertionError("must not start"))
    monkeypatch.setattr(subject.entry, "run_reviewed", old)
    args = subject.entry.arguments(
        ["--run-reviewed-working-copy", "--maintenance-approval", str(approval_path), "--submission-cap", "484"]
    )
    with pytest.raises(RuntimeError, match="APPROVED_ALLOWANCE_EXHAUSTED"):
        subject.run(args)
    old.assert_not_called()

    write_json(approval_path, {"banks": []})
    old.side_effect = None
    old.return_value = 0
    assert subject.run(args) == 0
    old.assert_called_once_with(args)


def test_bounded_exception_groups_redact_custom_names_and_messages() -> None:
    custom = type("PRIVATE-SENTINEL", (Exception,), {})("PRIVATE-SENTINEL")
    error = ExceptionGroup("PRIVATE-SENTINEL", [custom, RuntimeError(subject.REFUSAL)])
    data = subject.safe_chain(error)
    assert "PRIVATE-SENTINEL" not in json.dumps(data)
    assert any(row["guardRefusal"] for row in data)
    assert subject.connection_failure(error)
    assert not subject.connection_failure(asyncio.CancelledError())
