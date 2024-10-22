from collections.abc import Mapping
from typing import Any, Callable, Optional

import orjson
from aiohttp import web
from aiohttp_apischema import APIResponse


async def json_request(request: web.Request) -> Any:
    return orjson.loads(await request.read())


def json_response(
    data: Any, fallback_serializer: Optional[Callable[[Any], Any]] = None, headers: Optional[Mapping] = None
) -> web.Response:
    return web.json_response(body=orjson.dumps(data, default=fallback_serializer), headers=headers)

def as_api_response(r: web.Response) -> APIResponse:
    return APIResponse(body=r.body, headers=r.headers, status=r.status)