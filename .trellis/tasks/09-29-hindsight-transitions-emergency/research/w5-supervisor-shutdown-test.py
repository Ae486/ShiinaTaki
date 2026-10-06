"""Zero-model shutdown regressions, including a real loopback Uvicorn request."""
import asyncio
import importlib.util
import socket
import unittest
from pathlib import Path
from types import SimpleNamespace

spec = importlib.util.spec_from_file_location("shutdown", Path(__file__).with_name("w5-supervisor-shutdown.py"))
shutdown = importlib.util.module_from_spec(spec)
spec.loader.exec_module(shutdown)


class ShutdownTest(unittest.IsolatedAsyncioTestCase):
    async def test_server_timeout_still_audits_and_closes_without_masking_original_error(self):
        events = []
        summary = {"nodeExit": 1}

        async def hanging_server():
            try:
                await asyncio.Event().wait()
            finally:
                events.append("cancelled")

        async def audit():
            events.append("audit")

        async def close():
            events.append("engine")

        original = ValueError("original driver failure")
        with self.assertRaises(ValueError) as caught, self.assertLogs(level="ERROR"):
            try:
                raise original
            finally:
                await shutdown.finish_execution(process=None, server=None, serving=asyncio.create_task(hanging_server()),
                    listener=SimpleNamespace(close=lambda: events.append("listener")), engine=SimpleNamespace(close=close),
                    post_audit=audit, observation_status=lambda: {"modelRequests": 0}, summary=summary,
                    primary_error=original, timeout=0.05)
        self.assertIs(caught.exception, original)
        self.assertEqual(events, ["cancelled", "listener", "audit", "engine"])
        self.assertEqual(summary["cleanupErrors"], [{"stage": "server", "errorType": "TimeoutError"}])
        self.assertEqual(summary["observation"]["modelRequests"], 0)
        self.assertEqual(summary["nodeExit"], 1)

    async def test_audit_failure_is_fatal_but_engine_and_observation_still_finish(self):
        events = []
        summary = {}

        async def audit():
            raise AssertionError("COMPLETED_NATIVE_WORK_CHANGED")

        async def close():
            events.append("engine")

        with self.assertRaisesRegex(RuntimeError, "CLEANUP_FAILED"), self.assertLogs(level="ERROR"):
            await shutdown.finish_execution(process=None, server=None, serving=None,
                listener=SimpleNamespace(close=lambda: events.append("listener")), engine=SimpleNamespace(close=close),
                post_audit=audit, observation_status=lambda: {"modelRequests": 0}, summary=summary)
        self.assertEqual(events, ["listener", "engine"])
        self.assertEqual(summary["cleanupErrors"], [{"stage": "audit", "errorType": "AssertionError"}])
        self.assertEqual(summary["observation"]["modelRequests"], 0)

    async def test_real_uvicorn_hanging_request_is_cancelled_before_audit(self):
        import uvicorn

        started = asyncio.Event()
        cancelled = asyncio.Event()
        events = []
        summary = {}

        async def app(scope, receive, send):
            started.set()
            try:
                await asyncio.Event().wait()
            except asyncio.CancelledError:
                # A database transaction rollback may yield while unwinding.
                await asyncio.sleep(0.01)
                cancelled.set()
                raise

        async def audit():
            self.assertTrue(cancelled.is_set())
            events.append("audit")

        async def close():
            events.append("engine")

        listener = socket.socket()
        listener.bind(("127.0.0.1", 0))
        listener.listen(8)
        port = listener.getsockname()[1]
        server = uvicorn.Server(uvicorn.Config(app, lifespan="off", log_level="critical", access_log=False,
                                               timeout_graceful_shutdown=0.02))
        serving = asyncio.create_task(server.serve(sockets=[listener]))
        writer = None
        try:
            async with asyncio.timeout(5):
                while not server.started:
                    if serving.done():
                        await serving
                    await asyncio.sleep(0.01)
                reader, writer = await asyncio.open_connection("127.0.0.1", port)
                writer.write(b"GET /stall HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n")
                await writer.drain()
                await started.wait()
                await shutdown.finish_execution(process=None, server=server, serving=serving, listener=listener,
                    engine=SimpleNamespace(close=close), post_audit=audit,
                    observation_status=lambda: {"modelRequests": 0}, summary=summary, timeout=2)
                await reader.read()
            self.assertEqual(events, ["audit", "engine"])
            self.assertEqual(listener.fileno(), -1)
            self.assertNotIn("cleanupErrors", summary)
            self.assertFalse(server.server_state.tasks)
        finally:
            if writer is not None:
                writer.close()
                await writer.wait_closed()
            if not serving.done():
                serving.cancel()
                await asyncio.gather(serving, return_exceptions=True)
            listener.close()


if __name__ == "__main__":
    unittest.main()
