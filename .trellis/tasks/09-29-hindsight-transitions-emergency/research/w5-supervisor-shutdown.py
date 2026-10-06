"""Bound owned service shutdown and preserve post-failure audit/close evidence."""
import asyncio
import logging

GRACEFUL_SECONDS = 20


async def finish_execution(*, process, server, serving, listener, engine, post_audit,
                           observation_status, summary, primary_error=None, timeout=30):
    """Attempt every cleanup phase without replacing an active driver exception.

    Uvicorn cancels requests after its grace period but does not await their
    cancellation handlers. Drain those handlers before auditing durable rows.
    Cleanup failures remain fatal when the run itself has not already failed.
    """
    errors = []

    async def attempt(stage, action):
        try:
            await asyncio.wait_for(action(), timeout=timeout)
        except BaseException as error:
            errors.append(error)
            summary.setdefault("cleanupErrors", []).append({"stage": stage, "errorType": type(error).__name__})
            logging.exception("W5 cleanup phase failed: %s", stage)

    async def stop_process():
        if process is not None and process.returncode is None:
            process.kill()
            await process.wait()

    async def stop_server():
        if server is not None:
            server.should_exit = True
        if serving is not None:
            await serving

    async def drain_requests():
        if server is not None:
            pending = tuple(server.server_state.tasks)
            for task in pending:
                # Do not interrupt a rollback already unwinding Uvicorn's cancellation.
                if not task.cancelling():
                    task.cancel()
            if pending:
                await asyncio.gather(*pending, return_exceptions=True)

    async def close_listener():
        listener.close()

    async def observe():
        summary["observation"] = observation_status()

    await attempt("node", stop_process)
    await attempt("server", stop_server)
    await attempt("requests", drain_requests)
    await attempt("listener", close_listener)
    await attempt("audit", post_audit)
    await attempt("engine", engine.close)
    await attempt("observation", observe)
    if errors and primary_error is None:
        raise RuntimeError("W5_SUPERVISOR_CLEANUP_FAILED") from errors[0]
