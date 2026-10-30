"""Observer failures never change a provider send; all responses are injected offline."""

from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Any

import httpx
import pytest

import real_hindsight_network as network


@pytest.fixture(autouse=True)
def isolated_observer(monkeypatch: pytest.MonkeyPatch) -> None:
    for name in ("_observation_errors", "_metadata_errors", "_serialization_errors"):
        monkeypatch.setattr(network, name, 0)


def install_observer(monkeypatch: pytest.MonkeyPatch, root: Path,
                     result: httpx.Response | BaseException) -> list[httpx.Request]:
    calls: list[httpx.Request] = []

    async def original(_client: Any, request: httpx.Request, *_args: Any, **_kwargs: Any) -> httpx.Response:
        calls.append(request)
        if isinstance(result, BaseException):
            raise result
        return result

    monkeypatch.setattr(httpx.AsyncClient, "send", original)
    network.observe_model_calls(root)
    return calls


async def send(path: str = "/v1/chat/completions") -> httpx.Response:
    async with httpx.AsyncClient(trust_env=False) as client:
        return await client.send(httpx.Request("POST", "https://api.deepseek.com" + path))


def record(root: Path) -> dict[str, Any]:
    lines = (root / "model-usage.jsonl").read_text(encoding="utf-8").splitlines()
    assert len(lines) == 1
    return json.loads(lines[0])


def assert_status(*, metadata: int = 0, serialization: int = 0, write: int = 0) -> None:
    assert network.observation_status() == {
        "complete": metadata == serialization == write == 0,
        "write_errors": write, "metadata_errors": metadata, "serialization_errors": serialization,
    }


def assert_private_text_absent(root: Path) -> None:
    for path in root.iterdir():
        if path.is_file():
            assert "private-" not in path.read_text(encoding="utf-8")


def test_valid_counts_and_zero_are_preserved_without_private_fields(monkeypatch: pytest.MonkeyPatch,
                                                                  tmp_path: Path) -> None:
    response = httpx.Response(200, json={
        "model": "deepseek-v4-flash",
        "usage": {"prompt_tokens": 0, "completion_tokens": 7, "total_tokens": 7,
                  "private-key": 999, "completion_tokens_details": {"reasoning_tokens": 3}},
        "choices": [{"finish_reason": "stop", "message": {"content": "private-response"}}],
    })
    calls = install_observer(monkeypatch, tmp_path, response)
    assert asyncio.run(send()) is response
    assert len(calls) == 1
    observed = record(tmp_path)
    assert observed["usage"] == {"prompt_tokens": 0, "completion_tokens": 7, "total_tokens": 7}
    assert observed["reasoning_tokens"] == 3
    assert observed["model"] == "deepseek-v4-flash"
    assert observed["finish_reasons"] == ["stop"]
    assert observed["status"] == 200 and observed["seconds"] >= 0
    assert_status()
    assert_private_text_absent(tmp_path)


@pytest.mark.parametrize("invalid", [10**309, (1 << 53), True, False, -1, 1.5, 1.0,
                                      float("nan"), float("inf"), float("-inf"),
                                      None, "private-number", [], {"private-key": 1}])
def test_invalid_counts_are_unknown_without_changing_the_response(monkeypatch: pytest.MonkeyPatch,
                                                                tmp_path: Path, invalid: Any) -> None:
    # Raw JSON allows deliberate NaN/Infinity fixtures rejected by httpx's JSON
    # encoder. The actual observer still uses the installed Response.json path.
    body = {"usage": {"prompt_tokens": invalid, "total_tokens": 7,
                      "completion_tokens_details": {"reasoning_tokens": invalid}}}
    response = httpx.Response(200, content=json.dumps(body).encode("utf-8"))
    calls = install_observer(monkeypatch, tmp_path, response)
    assert asyncio.run(send()) is response
    assert len(calls) == 1
    assert record(tmp_path)["usage"] == {"total_tokens": 7}
    assert record(tmp_path)["reasoning_tokens"] is None
    assert_status()
    assert_private_text_absent(tmp_path)


@pytest.mark.parametrize("body", [None, [], "private-body", 4, {}, {"usage": []},
                                   {"usage": {"prompt_tokens": "private-number"}},
                                   {"model": {"private-key": 1}, "choices": "private-choice"}])
def test_absent_or_invalid_metadata_shapes_remain_unknown(monkeypatch: pytest.MonkeyPatch,
                                                       tmp_path: Path, body: Any) -> None:
    response = httpx.Response(200, content=json.dumps(body).encode("utf-8"))
    calls = install_observer(monkeypatch, tmp_path, response)
    assert asyncio.run(send("/private-endpoint")) is response
    assert len(calls) == 1
    observed = record(tmp_path)
    assert observed["usage"] is None and observed["reasoning_tokens"] is None
    assert observed["model"] is None and observed["finish_reasons"] is None and observed["path"] is None
    assert_status()
    assert_private_text_absent(tmp_path)


def test_known_metadata_bounds_do_not_drop_valid_maximum_counts(monkeypatch: pytest.MonkeyPatch,
                                                              tmp_path: Path) -> None:
    response = httpx.Response(200, json={
        "usage": {"prompt_tokens": (1 << 53) - 1},
        "choices": [{"finish_reason": "private-reason"}] * 17,
    })
    install_observer(monkeypatch, tmp_path, response)
    assert asyncio.run(send()) is response
    assert record(tmp_path)["usage"] == {"prompt_tokens": (1 << 53) - 1}
    assert record(tmp_path)["finish_reasons"] is None
    assert_status()
    assert_private_text_absent(tmp_path)


@pytest.mark.parametrize("status", [True, False, 99, 600, 200.0])
def test_invalid_status_scalars_are_unknown_without_replacing_the_response(monkeypatch: pytest.MonkeyPatch,
                                                                         tmp_path: Path, status: Any) -> None:
    response = httpx.Response(status, json={})
    calls = install_observer(monkeypatch, tmp_path, response)
    assert asyncio.run(send()) is response
    assert len(calls) == 1
    assert record(tmp_path)["status"] is None
    assert_status()


def test_malformed_buffered_json_marks_metadata_failure_not_write_failure(monkeypatch: pytest.MonkeyPatch,
                                                                        tmp_path: Path) -> None:
    response = httpx.Response(200, content=b'{"private-response":')
    calls = install_observer(monkeypatch, tmp_path, response)
    assert asyncio.run(send()) is response
    assert len(calls) == 1
    assert record(tmp_path)["status"] == 200 and record(tmp_path)["usage"] is None
    assert_status(metadata=1)
    assert json.loads((tmp_path / "model-usage-incomplete.json").read_text()) == network.observation_status()
    assert_private_text_absent(tmp_path)


@pytest.mark.parametrize("consumed", [False, True])
def test_streams_are_never_consumed_or_reread_for_observation(monkeypatch: pytest.MonkeyPatch,
                                                           tmp_path: Path, consumed: bool) -> None:
    reads: list[int] = []

    class Stream(httpx.AsyncByteStream):
        async def __aiter__(self):
            reads.append(1)
            yield b"private-stream-not-json"

    response = httpx.Response(200, stream=Stream())
    calls = install_observer(monkeypatch, tmp_path, response)

    async def exercise() -> None:
        if consumed:
            async for _part in response.aiter_raw():
                pass
        before = len(reads)
        assert await send() is response
        assert len(reads) == before
        assert response.is_stream_consumed is consumed
        with pytest.raises(httpx.ResponseNotRead):
            _ = response.content
        if not consumed:
            assert await response.aread() == b"private-stream-not-json"

    asyncio.run(exercise())
    assert len(calls) == len(reads) == 1
    assert record(tmp_path)["usage"] is None
    assert_status()
    assert_private_text_absent(tmp_path)


def fail_instrumentation(monkeypatch: pytest.MonkeyPatch, stage: str, *, original_failure: bool = False) -> None:
    def fail(*_args: Any, **_kwargs: Any) -> Any:
        raise RuntimeError("private-instrumentation-error")

    if stage == "metadata":
        monkeypatch.setattr(network, "failure_type" if original_failure else "response_metadata", fail)
    elif stage == "serialization":
        encode = json.dumps

        def fail_record(value: Any, **kwargs: Any) -> str:
            if "status" in value:
                return fail()
            return encode(value, **kwargs)

        monkeypatch.setattr(network.json, "dumps", fail_record)
    else:
        open_file = Path.open

        def fail_record_open(path: Path, *args: Any, **kwargs: Any) -> Any:
            if path.name == "model-usage.jsonl":
                return fail()
            return open_file(path, *args, **kwargs)

        monkeypatch.setattr(Path, "open", fail_record_open)


@pytest.mark.parametrize("stage", ["metadata", "serialization", "write"])
def test_each_observer_stage_preserves_the_exact_success_response(monkeypatch: pytest.MonkeyPatch,
                                                               tmp_path: Path, stage: str) -> None:
    response = httpx.Response(200, json={"usage": {"total_tokens": 9}})
    calls = install_observer(monkeypatch, tmp_path, response)
    fail_instrumentation(monkeypatch, stage)
    assert asyncio.run(send()) is response
    assert len(calls) == 1
    assert_status(**{stage: 1})
    assert_private_text_absent(tmp_path)


@pytest.mark.parametrize("stage", ["metadata", "serialization", "write"])
@pytest.mark.parametrize("kind", [RuntimeError, asyncio.CancelledError, KeyboardInterrupt, SystemExit])
def test_original_exception_identity_wins_over_every_observer_failure(monkeypatch: pytest.MonkeyPatch,
                                                                    tmp_path: Path, stage: str,
                                                                    kind: type[BaseException]) -> None:
    original_error = kind("private-original-error")
    calls = install_observer(monkeypatch, tmp_path, original_error)
    fail_instrumentation(monkeypatch, stage, original_failure=True)

    async def exercise() -> None:
        with pytest.raises(kind) as caught:
            await send()
        assert caught.value is original_error

    asyncio.run(exercise())
    assert len(calls) == 1
    assert_status(**{stage: 1})
    assert_private_text_absent(tmp_path)


def test_caller_cancellation_survives_failed_log_and_marker_writes(monkeypatch: pytest.MonkeyPatch,
                                                               tmp_path: Path) -> None:
    captured: list[asyncio.CancelledError] = []
    calls: list[int] = []

    def fail_open(*_args: Any, **_kwargs: Any) -> Any:
        raise OSError("private-disk-error")

    async def exercise() -> None:
        started = asyncio.Event()

        async def original(*_args: Any, **_kwargs: Any) -> Any:
            calls.append(1)
            started.set()
            try:
                await asyncio.Event().wait()
            except asyncio.CancelledError as error:
                captured.append(error)
                raise

        monkeypatch.setattr(httpx.AsyncClient, "send", original)
        network.observe_model_calls(tmp_path)
        task = asyncio.create_task(send())
        await started.wait()
        monkeypatch.setattr(Path, "open", fail_open)
        task.cancel("private-cancellation")
        with pytest.raises(asyncio.CancelledError) as caught:
            await task
        assert caught.value is captured[0]
        assert task.cancelled()

    asyncio.run(exercise())
    assert calls == [1]
    assert_status(write=1)


@pytest.mark.parametrize("close_fails", [False, True])
def test_short_or_failed_close_writes_are_incomplete(monkeypatch: pytest.MonkeyPatch,
                                                   tmp_path: Path, close_fails: bool) -> None:
    response = httpx.Response(200, json={})
    calls = install_observer(monkeypatch, tmp_path, response)
    open_file = Path.open

    class Writer:
        def __enter__(self):
            return self

        def __exit__(self, *_args: Any) -> None:
            if close_fails:
                raise OSError("private-close-error")

        def write(self, value: str) -> int:
            return len(value) if close_fails else len(value) - 1

    def open_record(path: Path, *args: Any, **kwargs: Any) -> Any:
        return Writer() if path.name == "model-usage.jsonl" else open_file(path, *args, **kwargs)

    monkeypatch.setattr(Path, "open", open_record)
    assert asyncio.run(send()) is response
    assert len(calls) == 1
    assert_status(write=1)
    assert_private_text_absent(tmp_path)


def test_failure_class_names_and_arguments_are_not_persisted(monkeypatch: pytest.MonkeyPatch,
                                                          tmp_path: Path) -> None:
    private_error = type("private-class-name", (RuntimeError,), {})("private-original-body")
    calls = install_observer(monkeypatch, tmp_path, private_error)

    async def exercise() -> None:
        with pytest.raises(RuntimeError) as caught:
            await send()
        assert caught.value is private_error

    asyncio.run(exercise())
    assert len(calls) == 1
    assert record(tmp_path)["error_type"] == "Exception"
    assert_status()
    assert_private_text_absent(tmp_path)


def test_request_metadata_failure_cannot_prevent_or_repeat_the_send(monkeypatch: pytest.MonkeyPatch,
                                                                  tmp_path: Path) -> None:
    response = httpx.Response(200, json={})
    calls = install_observer(monkeypatch, tmp_path, response)

    class BrokenUrl:
        @property
        def host(self) -> str:
            raise RuntimeError("private-url-metadata")

    request = httpx.Request("POST", "https://api.deepseek.com/v1/chat/completions")
    monkeypatch.setattr(request, "url", BrokenUrl())

    async def exercise() -> None:
        async with httpx.AsyncClient(trust_env=False) as client:
            assert await client.send(request) is response

    asyncio.run(exercise())
    assert calls == [request]
    assert_status(metadata=1)
    assert_private_text_absent(tmp_path)


def test_non_provider_sends_and_options_are_forwarded_once(monkeypatch: pytest.MonkeyPatch,
                                                         tmp_path: Path) -> None:
    response = httpx.Response(200, content=b"private-non-provider-body")
    requests: list[httpx.Request] = []
    options: list[dict[str, Any]] = []

    async def original(_client: Any, request: httpx.Request, **kwargs: Any) -> httpx.Response:
        requests.append(request)
        options.append(kwargs)
        return response

    monkeypatch.setattr(httpx.AsyncClient, "send", original)
    network.observe_model_calls(tmp_path)
    request = httpx.Request("POST", "http://127.0.0.1:9/private-route")

    async def exercise() -> None:
        async with httpx.AsyncClient(trust_env=False) as client:
            assert await client.send(request, stream=True, follow_redirects=False) is response

    asyncio.run(exercise())
    assert requests == [request]
    assert options == [{"stream": True, "follow_redirects": False}]
    assert not list(tmp_path.iterdir())
    assert_status()
