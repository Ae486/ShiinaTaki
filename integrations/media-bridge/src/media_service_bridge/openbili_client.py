"""Independent fixed-origin OpenBili HTTP calls without retries or initialization.

The total deadline covers transport, decoding and projection. Feedback ambiguity
retains the original request key; native queued processing is not profile success.
"""

import asyncio
import os

import httpx

from .openbili_contracts import (OpenBiliError, feedback_input, feedback_receipt, object_body,
    positive_int, recommendation_list)
from .openbili_profile import profile_summary


class OpenBiliClient:
    def __init__(self, config, *, transport=None, environment=None):
        self.config = config
        self.closed = False
        self._http = None
        self._close_task = None
        self._retry_transport_close = False
        self._transport = transport
        # Optional OpenBili configuration/credentials must never prevent the
        # independent BiliNote tools from loading. Refuse only this client.
        token = (os.environ if environment is None else environment).get(config.auth_token_env) if config else None
        if not isinstance(token, str) or not token or any(ord(char) < 32 or ord(char) > 126 for char in token):
            return
        self._transport = transport if transport is not None else httpx.AsyncHTTPTransport(retries=0, trust_env=False)
        self._http = httpx.AsyncClient(base_url=config.backend_url, transport=self._transport,
            headers={"Accept": "application/json", "Authorization": "Bearer " + token},
            follow_redirects=False, trust_env=False, timeout=httpx.Timeout(config.total_timeout_seconds))

    async def close(self):
        self.closed = True
        if self._http is None:
            return
        task = self._close_task
        if task is None or (task.done() and (task.cancelled() or task.exception() is not None)):
            task = asyncio.create_task(self._close_transport())
            self._close_task = task
            task.add_done_callback(lambda completed: None if completed.cancelled() else completed.exception())
        await asyncio.shield(task)

    async def _close_transport(self):
        try:
            if self._retry_transport_close:
                await self._transport.aclose()
            else:
                await self._http.aclose()
        except BaseException:
            # httpx seals its client before transport cleanup finishes. A later
            # close must retry the owned transport if that cleanup failed.
            self._retry_transport_close = True
            raise

    async def _wire(self, method, route, body):
        async with self._http.stream(method, route, json=body) as response:
            if response.status_code in {401, 403}:
                raise OpenBiliError("openbili_unauthorized")
            if method == "POST":
                code = {404: "openbili_recommendation_not_found", 409: "openbili_feedback_conflict",
                    422: "openbili_feedback_rejected"}.get(response.status_code)
                if code:
                    raise OpenBiliError(code)
            if response.status_code != 200:
                raise OpenBiliError("openbili_unavailable")
            if response.headers.get("content-type", "").split(";", 1)[0].lower() != "application/json":
                raise OpenBiliError("openbili_response_invalid")
            chunks, size = [], 0
            async for chunk in response.aiter_bytes():
                size += len(chunk)
                if size > self.config.response_bytes:
                    raise OpenBiliError("openbili_response_invalid")
                chunks.append(chunk)
            return object_body(b"".join(chunks))

    async def _request(self, method, route, project, *, body=None, side_effect=False):
        request_id = body.get("request_id") if body else None
        if self.closed:
            raise OpenBiliError("openbili_closed", request_id=request_id)
        if self._http is None:
            raise OpenBiliError("openbili_not_configured", request_id=request_id)
        try:
            loop = asyncio.get_running_loop()
            deadline = loop.time() + self.config.total_timeout_seconds
            async with asyncio.timeout_at(deadline):
                value = project(await self._wire(method, route, body))
                if loop.time() >= deadline:
                    raise TimeoutError
                return value
        except (TimeoutError, httpx.HTTPError, asyncio.CancelledError) as exc:
            raise OpenBiliError("openbili_outcome_unknown" if side_effect else "openbili_unavailable",
                request_id=request_id) from exc
        except OpenBiliError as exc:
            certain = {"openbili_unauthorized", "openbili_feedback_conflict",
                "openbili_recommendation_not_found", "openbili_feedback_rejected"}
            code = "openbili_outcome_unknown" if side_effect and exc.code not in certain else exc.code
            raise OpenBiliError(code, request_id=request_id) from exc

    async def peek_recommendations(self, limit):
        if not positive_int(limit, 20):
            raise OpenBiliError("openbili_input_invalid")
        return await self._request("GET", f"api/recommendations/peek?limit={limit}",
            lambda value: recommendation_list(value, peek=True, limit=limit))

    async def read_recommendations(self, limit):
        if not positive_int(limit, 20):
            raise OpenBiliError("openbili_input_invalid")
        # Native GET has no limit argument: even a small projected response may
        # serve/top up the complete native list. It is never a fallback for peek.
        return await self._request("GET", "api/recommendations",
            lambda value: recommendation_list(value, peek=False, limit=limit), side_effect=True)

    async def read_profile(self):
        return await self._request("GET", "api/profile-summary?limit=3", profile_summary)

    async def submit_feedback(self, request_id, recommendation_id, feedback_type, note):
        body = feedback_input(request_id, recommendation_id, feedback_type, note)
        return await self._request("POST", "api/feedback", lambda value: feedback_receipt(value, body),
            body=body, side_effect=True)
