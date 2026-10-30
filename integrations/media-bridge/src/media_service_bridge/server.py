"""Thin standard MCP registration for independently configured native services.

MCP imports are lazy so HTTP client tests do not require installing the SDK.
No route starts a native service or introduces a bridge execution queue.
"""

from contextlib import asynccontextmanager
import json
from typing import Literal

from .bilinote_client import BiliNoteClient
from .config import BridgeConfig
from .contracts import BridgeError


def create_server(config: BridgeConfig, *, client: BiliNoteClient | None = None,
        openbili_config=None, openbili_client=None, enable_openbili=False):
    from mcp.server.fastmcp import FastMCP
    from mcp.types import CallToolResult, TextContent, ToolAnnotations

    native = client if client is not None else BiliNoteClient(config)
    recommendations = openbili_client
    extra_tools = []
    if enable_openbili or openbili_config is not None or recommendations is not None:
        from .openbili_client import OpenBiliClient
        from .openbili_tools import create_openbili_tools

        recommendations = recommendations if recommendations is not None else OpenBiliClient(openbili_config)
        extra_tools = create_openbili_tools(recommendations)

    @asynccontextmanager
    async def lifespan(_server):
        try:
            yield {}
        finally:
            try:
                await native.close()
            finally:
                if recommendations is not None:
                    await recommendations.close()

    server = FastMCP("media-service-bridge", lifespan=lifespan, tools=extra_tools)
    read = ToolAnnotations(readOnlyHint=True, destructiveHint=False, idempotentHint=True, openWorldHint=True)
    submit = ToolAnnotations(readOnlyHint=False, destructiveHint=False, idempotentHint=True, openWorldHint=True)

    def result(value, *, failed=False):
        return CallToolResult(isError=failed, content=[TextContent(type="text", text=json.dumps(value, ensure_ascii=False, allow_nan=False))],
            structuredContent=value)

    async def call(operation):
        try:
            return result(await operation)
        except BridgeError as exc:
            return result(exc.public(), failed=True)
        except Exception:
            return result(BridgeError("native_unavailable").public(), failed=True)

    @server.tool(name="bilinote_get_instance", annotations=read,
        description="Read the configured BiliNote service identity. This does not prove authentication, media access or model readiness.")
    async def get_instance():
        return await call(native.get_instance())

    @server.tool(name="bilinote_probe_media", annotations=read,
        description="Check exact Bilibili BVID/CID/part through the native acquisition path and read at most 1024 video bytes. Returns time-bound access evidence and known metadata, without submitting analysis, downloading full media or calling a model. Uses the existing configured service and authentication.")
    async def probe_media(video_url: str):
        return await call(native.probe_media(video_url))

    @server.tool(name="bilinote_submit_analysis", annotations=submit,
        description="Submit once with an already retained request UUID. After an uncertain response, lookup this same request; never silently mint another key. Uses the operator-selected endpoint and model/provider.")
    async def submit_analysis(client_request_id: str, video_url: str,
            output_format: Literal["markdown", "media_v1"] | None = None, video_understanding: bool | None = None):
        return await call(native.submit(client_request_id, video_url, output_format=output_format, video_understanding=video_understanding))

    @server.tool(name="bilinote_lookup_request", annotations=read,
        description="Reconcile the original native request UUID without submitting or replaying work. Returns its retained job binding and disposition.")
    async def lookup_request(client_request_id: str):
        return await call(native.lookup_request(client_request_id))

    @server.tool(name="bilinote_get_status", annotations=read,
        description="Read one native job status under its original request binding. Unknown, failed and unavailable never become queued work.")
    async def get_status(client_request_id: str, job_id: str):
        return await call(native.get_status(client_request_id, job_id))

    @server.tool(name="bilinote_read_result", annotations=read,
        description="Read and verify the bounded full native result. Default returns an explicit incomplete preview plus its complete resource URI. include_complete returns all verified safe native JSON. Native media identity must be compared with the caller-selected source.")
    async def read_result(client_request_id: str, job_id: str, include_complete: bool = False):
        async def read_value():
            artifact = await native.read_result(client_request_id, job_id)
            if include_complete:
                return {"ok": True, "complete": True, "identity": artifact.binding.identity(), "sha256": artifact.sha256,
                    "byte_length": len(artifact.content), "resource_uri": artifact.resource_uri, "result": artifact.value}
            return artifact.preview()
        return await call(read_value())

    @server.resource("bilinote://{service_instance_id}/{request_id}/{job_id}/{sha256}", mime_type="application/json",
        description="Complete native safe-result JSON; every read revalidates identity, exact bytes and the requested artifact revision.")
    async def complete_resource(service_instance_id: str, request_id: str, job_id: str, sha256: str):
        artifact = await native.read_resource(f"bilinote://{service_instance_id}/{request_id}/{job_id}/{sha256}")
        return artifact.content.decode("utf-8")

    return server
