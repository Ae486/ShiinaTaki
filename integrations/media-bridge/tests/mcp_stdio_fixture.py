"""Official SDK stdio fixture with native HTTP replaced, never a real service."""

import argparse
import json
import os
from pathlib import Path
import sys

parser = argparse.ArgumentParser()
parser.add_argument("--evidence", type=Path, required=True)
parser.add_argument("--nonce", required=True)
parser.add_argument("--with-openbili", action="store_true")
args = parser.parse_args()
output = args.evidence.resolve()
marker = json.loads((output / "fixture.json").read_text(encoding="utf-8"))
if marker != {"nonce": args.nonce}:
    raise SystemExit("Invalid isolated fixture marker")


def owned(path):
    return Path(os.fsdecode(path)).resolve().is_relative_to(output)


blocked = []
def deny(event):
    blocked.append(event)
    raise AssertionError("Forbidden SDK fixture boundary: " + event)


def audit(event, values):
    if event in {"sqlite3.connect", "socket.bind", "socket.connect", "socket.getaddrinfo", "subprocess.Popen", "os.system"}:
        deny(event)
    if event == "open" and isinstance(values[0], (str, bytes, os.PathLike)):
        path, mode, flags = values
        if os.fsdecode(path).lower() == os.devnull.lower():
            return
        if Path(os.fsdecode(path)).name.lower().startswith(".env"):
            deny("credential_file")
        if ((mode and any(c in mode for c in "wax+")) or flags & (os.O_WRONLY | os.O_RDWR | os.O_CREAT | os.O_APPEND)) and not owned(path):
            deny("write_outside_fixture")


sys.addaudithook(audit)
PACKAGE = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(PACKAGE / "src"), str(PACKAGE / "tests")]

import anyio
import httpx
from media_service_bridge.bilinote_client import BiliNoteClient
from media_service_bridge.server import create_server
from async_fixture import TimerLoop
from fixtures import NativeStub, config
from openbili_fixtures import OpenBiliStub, TOKEN, openbili_config
from media_service_bridge.openbili_client import OpenBiliClient

native = NativeStub()
openbili_native = OpenBiliStub()
identity = {"nonce": args.nonce, "pid": os.getpid(), "python": sys.executable}

def record_progress():
    # Existing Taki close aborts its process transport on Windows. Persist the
    # pre-close protocol/boundary facts independently of a finally block that
    # an intentional process termination is not required to execute.
    (output / "interpreter-progress.json").write_text(json.dumps({**identity,
        "native_http_calls": len(native.calls), "native_posts": sum(call.method == "POST" for call in native.calls),
        "openbili_http_calls": len(openbili_native.calls), "openbili_posts": sum(call.method == "POST" for call in openbili_native.calls),
        "forbidden_boundary_attempts": blocked}), encoding="utf-8")

async def synthetic_native(request):
    response = await native(request)
    record_progress()
    return response

async def synthetic_openbili(request):
    response = await openbili_native(request)
    record_progress()
    return response

class ObservedTransport(httpx.MockTransport):
    cleanup_completed = False

    async def aclose(self):
        await super().aclose()
        self.cleanup_completed = True

transport = ObservedTransport(synthetic_native)
client = BiliNoteClient(config(), transport=transport)
openbili_transport = ObservedTransport(synthetic_openbili)
openbili_client = OpenBiliClient(openbili_config(), transport=openbili_transport,
    environment={"OPENBILI_TEST_TOKEN": TOKEN}) if args.with_openbili else None
server = create_server(config(), client=client, openbili_client=openbili_client)
(output / "interpreter-ready.json").write_text(json.dumps(identity), encoding="utf-8")
try:
    # Standard SDK framing and handler execution; a timer-only event loop
    # avoids Windows' normal internal loopback wakeup sockets in this test.
    anyio.run(server.run_stdio_async, backend_options={"loop_factory": TimerLoop})
finally:
    cleanup = client._close_task
    (output / "interpreter-finished.json").write_text(json.dumps({**identity,
        "native_http_calls": len(native.calls), "native_posts": sum(call.method == "POST" for call in native.calls),
        "client_sealed": client.closed, "transport_cleanup_completed": transport.cleanup_completed,
        "cleanup_task_completed": bool(cleanup is not None and cleanup.done() and not cleanup.cancelled() and cleanup.exception() is None),
        "openbili_http_calls": len(openbili_native.calls), "openbili_posts": sum(call.method == "POST" for call in openbili_native.calls),
        "openbili_client_sealed": openbili_client.closed if openbili_client is not None else None,
        "openbili_transport_cleanup_completed": openbili_transport.cleanup_completed,
        "forbidden_boundary_attempts": blocked}), encoding="utf-8")
