from __future__ import annotations

from ..services.h3_profiles import load_state, save_state

try:
    from aiohttp import web  # type: ignore
    from server import PromptServer  # type: ignore
except Exception:  # pragma: no cover
    web = None
    PromptServer = None

_REGISTERED = False


def _json_error(message: str, status: int = 400):
    return web.json_response({"ok": False, "error": message}, status=status)


def register_prompt_director_state_routes() -> None:
    global _REGISTERED
    if _REGISTERED or PromptServer is None or web is None:
        return
    try:
        routes = PromptServer.instance.routes

        @routes.get("/velvet_vice/h3/state/prompt_director")
        async def vv_h3_prompt_director_state_load(request):
            del request
            try:
                return web.json_response({
                    "ok": True,
                    "state": load_state("prompt_director"),
                })
            except Exception as exc:
                return _json_error(str(exc))

        @routes.post("/velvet_vice/h3/state/prompt_director")
        async def vv_h3_prompt_director_state_save(request):
            try:
                data = await request.json()
                state = save_state(
                    "prompt_director",
                    dict(data.get("payload") or {}),
                )
                return web.json_response({"ok": True, "state": state})
            except Exception as exc:
                return _json_error(str(exc))

        _REGISTERED = True
    except Exception:
        _REGISTERED = True


register_prompt_director_state_routes()
