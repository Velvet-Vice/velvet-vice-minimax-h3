from __future__ import annotations

from typing import Any, Dict

from .minimax_h3 import (
    MINIMAX_H3_AUDIO_VAE,
    MINIMAX_H3_AUTO,
    MINIMAX_H3_VIDEO_VAE,
    _is_h3_i2v_diffusion_candidate,
    _normalized_model_name,
)
from .minimax_h3_control import (
    _gguf_loader_available,
    _gguf_clip_loader_available,
    _looks_like_h3_text_encoder,
    _looks_like_h3_vae,
    _resolve_gguf,
    _resolve_native,
    _resolve_required_name,
    _resolve_text_encoder,
)

try:
    from aiohttp import web  # type: ignore
    from server import PromptServer  # type: ignore
except Exception:  # pragma: no cover - only absent outside ComfyUI
    web = None
    PromptServer = None


class VelvetViceMiniMaxH3Preflight:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"auto_check_on_load": ("BOOLEAN", {"default": True})}}

    RETURN_TYPES = ()
    FUNCTION = "display"
    OUTPUT_NODE = True
    CATEGORY = "VELVET VICE/MiniMax H3/00 Monitor"
    DESCRIPTION = (
        "Read-only MiniMax H3 backend and model preflight. The modern monitor "
        "can check the current System Hub selections automatically or on demand."
    )

    def display(self, auto_check_on_load=True):
        return {"ui": {"status": ["VELVET VICE H3 PREFLIGHT READY"]}, "result": ()}


class VelvetViceMiniMaxH3RenderTimer:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"enabled": ("BOOLEAN", {"default": True})}}

    RETURN_TYPES = ()
    FUNCTION = "display"
    OUTPUT_NODE = True
    CATEGORY = "VELVET VICE/MiniMax H3/00 Monitor"
    DESCRIPTION = (
        "Live current-node, MiniMax H3 core, total and last-successful-render timer."
    )

    def display(self, enabled=True):
        return {"ui": {"status": ["VELVET VICE H3 RENDER TIMER READY"]}, "result": ()}


def _check(label: str, ok: bool, message: str, *, warning: bool = False) -> Dict[str, Any]:
    return {
        "label": label,
        "status": "pass" if ok else "warn" if warning else "fail",
        "message": message,
    }


def _selected_model_check(
    label: str,
    name: str | None,
    recognized: bool,
    *,
    required: bool = True,
) -> Dict[str, Any]:
    """Existence is mandatory; unfamiliar manual choices are warnings only."""
    if not name:
        return _check(label, False, "not found", warning=not required)
    if not recognized:
        return {
            "label": label,
            "status": "warn",
            "message": f"{name} · file exists; H3 compatibility is verified on load",
        }
    return _check(label, True, name)


def _preflight_report(data: Dict[str, Any]) -> Dict[str, Any]:
    requested = str(data.get("model_backend") or "AUTO").upper()
    preference = str(data.get("auto_preference") or "NATIVE").upper()
    fallback = bool(data.get("fallback_if_missing", True))
    audio_enabled = bool(data.get("audio_enabled", True))

    native = _resolve_native(str(data.get("native_model") or MINIMAX_H3_AUTO))
    gguf = _resolve_gguf(str(data.get("gguf_model") or MINIMAX_H3_AUTO))
    text = _resolve_text_encoder(
        str(data.get("text_encoder") or MINIMAX_H3_AUTO)
    )
    video = _resolve_required_name(
        "vae",
        MINIMAX_H3_VIDEO_VAE,
        str(data.get("video_vae") or MINIMAX_H3_AUTO),
    )
    audio = _resolve_required_name(
        "vae",
        MINIMAX_H3_AUDIO_VAE,
        str(data.get("audio_vae") or MINIMAX_H3_AUTO),
    )
    gguf_loader = _gguf_loader_available()
    gguf_clip_loader = _gguf_clip_loader_available()
    text_is_gguf = bool(text and _normalized_model_name(text).endswith(".gguf"))
    text_usable = bool(text and (not text_is_gguf or gguf_clip_loader))
    native_usable = bool(native)
    gguf_usable = bool(gguf and gguf_loader)

    active = None
    if requested == "AUTO":
        order = ("GGUF", "NATIVE") if preference == "GGUF" else ("NATIVE", "GGUF")
        for candidate in order:
            if candidate == "NATIVE" and native_usable:
                active = "NATIVE"
                break
            if candidate == "GGUF" and gguf_usable:
                active = "GGUF"
                break
    elif requested == "NATIVE":
        active = "NATIVE" if native_usable else ("GGUF" if fallback and gguf_usable else None)
    elif requested == "GGUF":
        active = "GGUF" if gguf_usable else ("NATIVE" if fallback and native_usable else None)

    backend_message = (
        f"{active} selected file exists; compatibility is verified when loaded"
        if active
        else f"{requested} has no selectable model path"
    )
    native_required = requested == "NATIVE" and not fallback
    gguf_required = requested == "GGUF" and not fallback
    checks = [
        _check("Usable backend", bool(active), backend_message),
        _selected_model_check(
            "Native H3 model", native,
            bool(native and _is_h3_i2v_diffusion_candidate(native)),
            required=native_required,
        ),
        _selected_model_check(
            "GGUF H3 model", gguf,
            bool(gguf and any(
                token in _normalized_model_name(gguf) for token in ("minimax", "h3")
            )),
            required=gguf_required,
        ),
        _check(
            "ComfyUI-GGUF",
            gguf_loader,
            "loader available" if gguf_loader else "not installed",
            warning=active != "GGUF" and requested != "GGUF",
        ),
        (
            _check("Qwen text encoder", False, f"{text} · CLIPLoaderGGUF missing")
            if text_is_gguf and not gguf_clip_loader
            else _selected_model_check(
                "Qwen text encoder", text if text_usable else None,
                bool(text and _looks_like_h3_text_encoder(text)),
            )
        ),
        (
            _check("Video VAE", False, f"{video} · GGUF VAE is unsupported; use a native ComfyUI VAE")
            if video and _normalized_model_name(video).endswith(".gguf")
            else _selected_model_check(
                "Video VAE", video, bool(video and _looks_like_h3_vae(video, "video"))
            )
        ),
        (
            _check("Audio VAE", False, f"{audio} · GGUF VAE is unsupported; use a native ComfyUI VAE")
            if audio_enabled and audio and _normalized_model_name(audio).endswith(".gguf")
            else _check(
                "Audio VAE", True,
                "not required · MUTED / VIDEO ONLY skips loading and decoding"
            )
            if not audio_enabled
            else _selected_model_check(
                "Audio VAE", audio, bool(audio and _looks_like_h3_vae(audio, "audio"))
            )
        ),
    ]
    failures = sum(item["status"] == "fail" for item in checks)
    warnings = sum(item["status"] == "warn" for item in checks)
    passes = len(checks) - failures - warnings
    report = {
        "ok": failures == 0,
        "active_backend": active,
        "checks": checks,
        "summary": {"failures": failures, "warnings": warnings, "passes": passes},
    }
    print(
        "[VELVET VICE] MiniMax H3 preflight "
        f"{'passed' if report['ok'] else 'failed'} | {passes} pass | "
        f"{warnings} warning | {failures} failure"
    )
    return report


_ROUTES_REGISTERED = False


def _register_routes() -> None:
    global _ROUTES_REGISTERED
    if _ROUTES_REGISTERED or PromptServer is None or web is None:
        return
    try:
        routes = PromptServer.instance.routes

        @routes.post("/velvet_vice/minimax_h3/preflight")
        async def velvet_vice_minimax_h3_preflight(request):
            try:
                data = await request.json()
            except Exception:
                data = {}
            return web.json_response(_preflight_report(dict(data or {})))

        _ROUTES_REGISTERED = True
    except Exception:
        # Development reloads can try to register the same route twice.
        _ROUTES_REGISTERED = True


_register_routes()
