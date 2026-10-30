"""Optional standard MCP definitions with distinct read and write postures.

SDK declarations describe risk; caller Governance remains authoritative. Tools
use ordinary MCP discovery and do not register permanent Agent capabilities.
"""

import json
from typing import Annotated, Literal

from .openbili_contracts import OpenBiliError


def create_openbili_tools(native):
    from mcp.server.fastmcp.tools.base import Tool
    from mcp.types import CallToolResult, TextContent, ToolAnnotations
    from pydantic import ConfigDict, Field, StrictInt, StrictStr

    async def call(operation):
        try:
            value = await operation
        except OpenBiliError as exc:
            value = exc.public()
        except Exception:
            value = OpenBiliError("openbili_unavailable").public()
        return CallToolResult(isError=value.get("ok") is False, structuredContent=value,
            content=[TextContent(type="text", text=json.dumps(value, ensure_ascii=False, allow_nan=False))])

    async def peek_recommendations(limit: Annotated[StrictInt, Field(ge=1, le=20,
            description="Maximum existing items to return, 1-20; use 5 for compact internal selection.")]):
        return await call(native.peek_recommendations(limit))

    async def read_recommendations(limit: Annotated[StrictInt, Field(ge=1, le=20,
            description="Maximum returned items, 1-20; native GET can still serve its entire list. Use 20 for browsing.")]):
        return await call(native.read_recommendations(limit))

    async def read_profile():
        return await call(native.read_profile())

    async def submit_feedback(
        request_id: Annotated[StrictStr, Field(min_length=1, max_length=400,
            description="Retain one stable key before dispatch; exact retries reuse it with the same payload.")],
        recommendation_id: Annotated[StrictInt, Field(ge=1, le=9007199254740991,
            description="Exact native recommendation ID returned by an OpenBili list.")],
        feedback_type: Annotated[Literal["like", "dislike", "comment", "dismiss"], Field(
            description="Explicit native content feedback; watching choice or deferring is not feedback.")],
        note: Annotated[StrictStr, Field(max_length=2000,
            description="User feedback text; nonempty for comment. Use empty string when no note is supplied.")],
    ):
        return await call(native.submit_feedback(request_id, recommendation_id, feedback_type, note))

    definitions = [
        (peek_recommendations, "openbili_peek_recommendations", True, True, False,
            "Read existing native recommendations without top-up, serving, cache writes or exposure events. Empty means no existing list; never fall back to browsing automatically. total is the current bounded native view, not pool inventory."),
        (read_recommendations, "openbili_read_recommendations", False, False, False,
            "Read OpenBili's ordinary user browsing list. Native GET may top up history and serve pool items; even a small limit can cause those effects. It is not an internal peek or proof the user saw/clicked a card. Do not blindly retry an unknown outcome."),
        (read_profile, "openbili_read_profile", True, True, False,
            "Read bounded native inferred interests and supporting evidence with source and read time. May include user overrides; never treat the projection as verified user facts. Uninitialized can also mean native profile read failure; this does not initialize OpenBili."),
        (submit_feedback, "openbili_submit_feedback", False, True, True,
            "Submit explicit OpenBili content like/dislike/comment/dismiss with a retained request_id. Native success means queued processing, not applied profile learning. Exact retries keep all fields; conflict is terminal for that key. Direct viewing, Co-Watching and defer are not feedback. This does not like/favorite the platform account."),
    ]
    tools = []
    for function, name, read, idempotent, destructive, description in definitions:
        tool = Tool.from_function(function, name=name, description=description,
            annotations=ToolAnnotations(readOnlyHint=read, idempotentHint=idempotent,
                destructiveHint=destructive, openWorldHint=True))
        # FastMCP 1.26's public Tool metadata uses an extra-ignoring Pydantic
        # base. Supply a strict derived argument model for both execution and
        # its published schema, without changing global SDK behavior.
        model = type(name + "Arguments", (tool.fn_metadata.arg_model,),
            {"model_config": ConfigDict(extra="forbid", hide_input_in_errors=True)})
        tool.fn_metadata.arg_model = model
        tool.parameters = model.model_json_schema()
        tools.append(tool)
    return tools
