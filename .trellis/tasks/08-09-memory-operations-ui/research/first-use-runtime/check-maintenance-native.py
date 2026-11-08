"""In-memory ASGI adapter checks only; no Native entry point, listener or database is started."""
import asyncio
import io
import json
from starlette.applications import Starlette
from starlette.responses import Response
from starlette.routing import Route
from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path

spec = spec_from_file_location("maintenance_adapter", Path(__file__).with_name("maintenance-native-launcher.py"))
adapter = module_from_spec(spec)
spec.loader.exec_module(adapter)
output = io.StringIO()
stream = adapter.MetadataStream(output)
stream.write('DO_NOT_LOG\nINFO: loopback - "GET /banks/private/application-state/bodies/private HTTP/1.1" 200 OK\n')
assert "DO_NOT_LOG" not in output.getvalue() and "private" not in output.getvalue()


async def endpoint(request):
    return Response("DO_NOT_LOG")


app = Starlette(routes=[Route("/probe", endpoint)])
adapter.instrument_requests(output)
sent = []


async def receive():
    return {"type": "http.request", "body": b"", "more_body": False}


async def send(message):
    sent.append(message)


asyncio.run(app({"type": "http", "asgi": {"version": "3.0"}, "method": "GET", "path": "/probe", "root_path": "",
    "query_string": b"", "headers": [], "scheme": "http", "server": ("localhost", 1), "client": ("localhost", 2)}, receive, send))
rows = [json.loads(line) for line in output.getvalue().splitlines()]
assert [row["event"] for row in rows] == ["native-access", "native-request-start", "native-request-end"]
assert rows[-1]["durationMs"] >= 0 and rows[-1]["status"] == 200
assert sent[-1]["body"] == b"DO_NOT_LOG"
assert "DO_NOT_LOG" not in output.getvalue()
print(json.dumps({"status": "passed", "checks": ["metadata privacy", "installed Starlette ASGI timestamps", "original response unchanged"]}))
