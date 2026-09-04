from __future__ import annotations

import secrets
from copy import deepcopy
from typing import Any, Dict

from .minimax_h3 import (
    MINIMAX_H3_AUDIO_VAE,
    MINIMAX_H3_AUTO,
    MINIMAX_H3_DIFFUSION,
    MINIMAX_H3_TEXT_ENCODER,
    MINIMAX_H3_TURBO_LORA,
    MINIMAX_H3_VIDEO_VAE,
    VelvetViceMiniMaxH3CLIPLoader,
    VelvetViceMiniMaxH3UNETLoader,
    VelvetViceMiniMaxH3VAELoader,
    _best_basename_match,
    _is_h3_i2v_diffusion_candidate,
    _is_h3_turbo_lora_candidate,
    _model_catalog,
    _model_names,
    _normalized_model_name,
    _resolve_model_name,
    _safe_image_hw,
    _status_ui_result,
    _resolve_text_encoder_name,
)
from .watermark_overlay import watermark_file_options
from ..services.h3_profiles import (
    delete_profile,
    export_profile,
    import_profile,
    list_profiles,
    load_profile,
    load_state,
    rename_profile,
    save_profile,
    save_state,
)

try:
    from aiohttp import web  # type: ignore
    from server import PromptServer  # type: ignore
except Exception:  # pragma: no cover
    web = None
    PromptServer = None


H3_BACKENDS = ("AUTO", "NATIVE", "GGUF")
H3_RENDER_PRESETS = ("TEST", "FAST", "BALANCED", "QUALITY", "CUSTOM")
H3_FORMATS = ("AUTO", "16:9", "9:16", "1:1", "CUSTOM")
H3_RESOLUTION_PRESET_MEGAPIXELS = {
    # MiniMax H3 preset megapixel budgets.
    # MP convention is ComfyUI-native: 1 MP = 1024 * 1024 pixels.
    "144p": 0.0352,
    "240p": 0.0977,
    "360p": 0.22,
    "480p": 0.391,
    "540p": 0.494,
    "576p": 0.396,
    "720p": 0.879,
    "900p": 1.373,
    "1024p": 1.00,
    "1080p": 1.978,
    "1152p": 2.25,
    "1440p": 3.516,
    "2160p": 7.91,
    "2K": 3.906,
    "4K": 7.91,
    "0.26 MP - Preview": 0.26,
    "0.36 MP - Small": 0.36,
    "0.52 MP - SD": 0.52,
    "0.65 MP - Balanced": 0.65,
    "0.83 MP - HD": 0.83,
    "1.00 MP - 1024p": 1.00,
    "1.05 MP - HD+": 1.05,
    "1.20 MP - HD++": 1.20,
    "1.35 MP - 2K lite": 1.35,
    "1.55 MP - 2K": 1.55,
    "1.65 MP - 2K+": 1.65,
    "1.75 MP - QHD": 1.75,
    "2.10 MP - FHD": 2.10,
    "3.30 MP - QHD+": 3.30,
    "4.75 MP - 2K Pro": 4.75,
    "6.50 MP - Production": 6.50,
    "8.30 MP - UHD": 8.30,
}
H3_RESOLUTION_PRESETS = tuple(H3_RESOLUTION_PRESET_MEGAPIXELS) + ("CUSTOM",)
H3_LEGACY_RESOLUTION_ALIASES = {
    "TEST": "480p",
    "BALANCED": "0.65 MP - Balanced",
    "QUALITY": "1.00 MP - 1024p",
}
H3_MAX_FRAME_COUNT = 3592  # highest valid 17k+5 value <= native ComfyUI max 3600
H3_MAX_DURATION_SECONDS = 149.5
H3_SEED_MODES = ("RANDOM", "LOCKED", "REUSE LAST")
H3_RESOLUTION_MODES = ("PRESET", "CUSTOM MP", "CUSTOM SIZE")
H3_ENDING_MODES = ("AUTO", "NO CLIMAX", "CLIMAX", "LOOP / CONTINUOUS ACTION")


def _combo(values: list[str] | tuple[str, ...], default: str = MINIMAX_H3_AUTO):
    clean = []
    for value in values:
        value = str(value)
        if value and value not in clean:
            clean.append(value)
    if default not in clean:
        clean.insert(0, default)
    return tuple(clean)


def _native_h3_models() -> tuple[str, ...]:
    names = [
        name for name in _model_catalog("diffusion_models", "unet")
        if not _normalized_model_name(name).endswith(".gguf")
    ]
    candidates = [name for name in names if _is_h3_i2v_diffusion_candidate(name)]
    preferred = _best_basename_match(names, MINIMAX_H3_DIFFUSION)
    ordered: list[str] = []
    if preferred:
        ordered.append(preferred)
    ordered.extend(name for name in candidates if name not in ordered)
    # H3 candidates stay at the top, but every installed native diffusion
    # model remains visible for explicit selection.
    ordered.extend(name for name in names if name not in ordered)
    return _combo(ordered)


def _gguf_h3_models() -> tuple[str, ...]:
    names = _model_catalog(
        "unet_gguf", "diffusion_models", "unet", extension=".gguf"
    )
    preferred = [
        name for name in names
        if "h3" in _normalized_model_name(name) or "minimax" in _normalized_model_name(name)
    ]
    ordered = preferred + [name for name in names if name not in preferred]
    return _combo(ordered)


def _text_encoder_choices() -> tuple[str, ...]:
    names = _model_catalog("text_encoders", "clip", "clip_gguf")
    preferred = _best_basename_match(names, MINIMAX_H3_TEXT_ENCODER)
    h3_first = [
        name for name in names
        if any(token in _normalized_model_name(name) for token in ("minimax", "h3", "qwen3vl", "qwen3-vl"))
    ]
    ordered = ([preferred] if preferred else []) + [
        name for name in h3_first if name != preferred
    ]
    ordered.extend(name for name in names if name not in ordered)
    return _combo(ordered)


def _vae_choices() -> tuple[str, ...]:
    # ComfyUI-GGUF has diffusion/text-encoder loaders, but no GGUF VAE loader.
    return _combo([
        name for name in _model_names("vae")
        if not _normalized_model_name(name).endswith(".gguf")
    ])


def _turbo_lora_choices() -> tuple[str, ...]:
    names = _model_names("loras")
    preferred = [name for name in names if _is_h3_turbo_lora_candidate(name)]
    ordered = preferred + [name for name in names if name not in preferred]
    return _combo(ordered)


def _resolve_turbo_lora(selected: str) -> str | None:
    names = _model_names("loras")
    selected = str(selected or MINIMAX_H3_AUTO)
    if selected != MINIMAX_H3_AUTO:
        normalized = _normalized_model_name(selected)
        for name in names:
            if _normalized_model_name(name) == normalized:
                return name
        basename = normalized.rsplit("/", 1)[-1]
        for name in names:
            if _normalized_model_name(name).rsplit("/", 1)[-1] == basename:
                return name
        return None
    preferred = _best_basename_match(names, MINIMAX_H3_TURBO_LORA)
    if preferred:
        return preferred
    candidates = [name for name in names if _is_h3_turbo_lora_candidate(name)]
    return sorted(candidates, key=_normalized_model_name)[0] if candidates else None


def _gguf_loader_available() -> bool:
    try:
        import nodes as comfy_nodes
    except Exception:
        return False
    registry = getattr(comfy_nodes, "NODE_CLASS_MAPPINGS", {})
    return "UnetLoaderGGUF" in registry or "UnetLoaderGGUFAdvanced" in registry


def _gguf_clip_loader_available() -> bool:
    try:
        import nodes as comfy_nodes
    except Exception:
        return False
    registry = getattr(comfy_nodes, "NODE_CLASS_MAPPINGS", {})
    return "CLIPLoaderGGUF" in registry


def _resolve_native(selected: str) -> str | None:
    names = [
        name for name in _model_catalog("diffusion_models", "unet")
        if not _normalized_model_name(name).endswith(".gguf")
    ]
    return _resolve_catalog_choice(
        names, selected, preferred=MINIMAX_H3_DIFFUSION,
        candidate_test=_is_h3_i2v_diffusion_candidate,
    )


def _resolve_gguf(selected: str) -> str | None:
    names = _model_catalog(
        "unet_gguf", "diffusion_models", "unet", extension=".gguf"
    )
    return _resolve_catalog_choice(
        names,
        selected,
        candidate_test=lambda name: (
            "h3" in _normalized_model_name(name)
            or "minimax" in _normalized_model_name(name)
        ),
    )


def _resolve_catalog_choice(
    names: list[str],
    selected: str,
    *,
    preferred: str = "",
    candidate_test=None,
) -> str | None:
    selected = str(selected or MINIMAX_H3_AUTO)
    if selected != MINIMAX_H3_AUTO:
        normalized = _normalized_model_name(selected)
        for name in names:
            if _normalized_model_name(name) == normalized:
                return name
        basename = normalized.rsplit("/", 1)[-1]
        for name in names:
            if _normalized_model_name(name).rsplit("/", 1)[-1] == basename:
                return name
        return None
    if preferred:
        match = _best_basename_match(names, preferred)
        if match:
            return match
    candidates = [name for name in names if candidate_test and candidate_test(name)]
    return sorted(candidates, key=_normalized_model_name)[0] if candidates else None


def _resolve_text_encoder(selected: str) -> str | None:
    return _resolve_text_encoder_name(selected, optional=True)


def _resolve_required_name(category: str, preferred: str, selected: str) -> str | None:
    try:
        return _resolve_model_name(category, preferred, selected, optional=True)
    except Exception:
        return None


def _looks_like_h3_text_encoder(name: str | None) -> bool:
    normalized = _normalized_model_name(name or "")
    return bool(normalized) and any(
        token in normalized
        for token in ("minimax", "h3", "qwen3vl", "qwen3-vl")
    )


def _looks_like_h3_vae(name: str | None, role: str) -> bool:
    normalized = _normalized_model_name(name or "")
    if not normalized or normalized.endswith(".gguf"):
        return False
    role_token = "audio" if str(role).lower() == "audio" else "video"
    return ("minimax" in normalized or "h3" in normalized) and role_token in normalized and "vae" in normalized


def _unload_for_backend_change() -> None:
    try:
        import comfy.model_management as mm  # type: ignore
        mm.unload_all_models()
        try:
            mm.soft_empty_cache()
        except TypeError:
            mm.soft_empty_cache(force=True)
    except Exception:
        pass


def _enable_minimax_h3_gguf_architecture(loader_cls: Any) -> bool:
    """Teach older ComfyUI-GGUF releases about MiniMax H3 in memory only.

    ComfyUI-GGUF currently validates ``general.architecture`` against its
    module-level ``IMG_ARCH_LIST`` before reading any tensors.  MiniMax H3
    GGUFs identify themselves as ``minimax_h3``; older releases reject that
    otherwise valid value.  Mutating the loader function's own globals keeps
    the compatibility shim local to the running ComfyUI process and avoids
    editing another custom node on disk.
    """
    function_name = getattr(loader_cls, "FUNCTION", "load_unet")
    load_function = getattr(loader_cls, function_name, None)
    globals_dict = getattr(load_function, "__globals__", {})
    gguf_sd_loader = globals_dict.get("gguf_sd_loader")
    architecture_list = getattr(gguf_sd_loader, "__globals__", {}).get(
        "IMG_ARCH_LIST"
    )
    if not isinstance(architecture_list, set):
        return False
    if "minimax_h3" not in architecture_list:
        architecture_list.add("minimax_h3")
        print(
            "[VELVET VICE] GGUF compatibility | enabled architecture: minimax_h3 "
            "(runtime only)"
        )
    return True


def _load_gguf_model(name: str):
    try:
        import nodes as comfy_nodes
    except Exception as exc:
        raise RuntimeError("ComfyUI node registry is unavailable.") from exc
    registry: Dict[str, Any] = getattr(comfy_nodes, "NODE_CLASS_MAPPINGS", {})
    loader_cls = registry.get("UnetLoaderGGUF") or registry.get("UnetLoaderGGUFAdvanced")
    if loader_cls is None:
        raise RuntimeError(
            "[VELVET VICE] GGUF backend selected, but ComfyUI-GGUF / "
            "UnetLoaderGGUF is not installed."
        )
    compatibility_enabled = _enable_minimax_h3_gguf_architecture(loader_cls)
    loader = loader_cls()
    function_name = getattr(loader_cls, "FUNCTION", "load_unet")
    function = getattr(loader, function_name)
    try:
        try:
            return function(name)[0]
        except TypeError:
            # Advanced forks can expose required dequant/patch controls.
            return function(name, "default", "default", False)[0]
    except ValueError as exc:
        if "Unexpected architecture type" in str(exc) and not compatibility_enabled:
            raise RuntimeError(
                "[VELVET VICE] The installed ComfyUI-GGUF loader hides its "
                "architecture registry, so MiniMax H3 compatibility could not "
                "be enabled. Update ComfyUI-GGUF and restart ComfyUI."
            ) from exc
        raise


def _load_text_encoder(name: str, device: str):
    """Load native safetensors or GGUF through the matching backend."""
    return VelvetViceMiniMaxH3CLIPLoader().load_clip(name, device)[0]


def _h3_frame_count(seconds: float, fps: int = 24) -> int:
    raw = max(5, round(float(seconds) * float(fps)))
    snapped = int(raw + (5 - (raw % 17)) % 17)
    return min(H3_MAX_FRAME_COUNT, snapped)


def _plan_resolution(
    source_width: int,
    source_height: int,
    format_mode: str,
    resolution_mode: str,
    resolution_preset: str,
    rotate_format: bool,
    custom_width: int,
    custom_height: int,
    custom_megapixels: float,
) -> tuple[int, int]:
    import math

    source_ratio = float(source_width) / float(max(1, source_height))
    format_choice = str(format_mode or "AUTO").upper()
    resolution_choice = str(resolution_mode or "PRESET").upper()
    preset_raw = str(resolution_preset or "900p").strip()
    preset = H3_LEGACY_RESOLUTION_ALIASES.get(preset_raw.upper(), preset_raw)

    if resolution_choice == "CUSTOM SIZE":
        width = max(256, int(round(int(custom_width) / 32.0) * 32))
        height = max(256, int(round(int(custom_height) / 32.0) * 32))
        if rotate_format:
            width, height = height, width
        return width, height

    ratios = {"16:9": 16 / 9, "9:16": 9 / 16, "1:1": 1.0}
    if format_choice == "CUSTOM":
        ratio = float(max(1, int(custom_width))) / float(max(1, int(custom_height)))
    else:
        ratio = ratios.get(format_choice, source_ratio)
    if rotate_format:
        ratio = 1.0 / max(ratio, 1e-6)

    if resolution_choice == "CUSTOM MP":
        megapixels = float(custom_megapixels)
    else:
        megapixels = H3_RESOLUTION_PRESET_MEGAPIXELS.get(preset, float(custom_megapixels))

    # Use ComfyUI native megapixel conventions.
    area = max(32.0 * 32.0, float(megapixels) * 1024.0 * 1024.0)
    width = int(round(math.sqrt(area * ratio) / 32.0) * 32)
    height = int(round((math.sqrt(area * ratio) / max(ratio, 1e-6)) / 32.0) * 32)
    width, height = max(256, width), max(256, height)
    if format_choice == "AUTO":
        source_landscape = source_width >= source_height
        if source_landscape != (width >= height):
            width, height = height, width
    return width, height


class VelvetViceMiniMaxH3SystemHub:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "model_backend": (H3_BACKENDS, {"default": "AUTO"}),
                "auto_preference": (("NATIVE", "GGUF"), {"default": "NATIVE"}),
                "native_model": (_native_h3_models(), {"default": MINIMAX_H3_AUTO}),
                "gguf_model": (_gguf_h3_models(), {"default": MINIMAX_H3_AUTO}),
                "text_encoder": (_text_encoder_choices(), {"default": MINIMAX_H3_AUTO}),
                "video_vae": (_vae_choices(), {"default": MINIMAX_H3_AUTO}),
                "audio_vae": (_vae_choices(), {"default": MINIMAX_H3_AUTO}),
                "turbo_lora": (_turbo_lora_choices(), {"default": MINIMAX_H3_AUTO}),
                "turbo_model_strength": (
                    "FLOAT", {"default": 1.0, "min": -4.0, "max": 4.0, "step": 0.01}
                ),
                "base_steps": ("INT", {"default": 20, "min": 1, "max": 80, "step": 1}),
                "turbo_steps": ("INT", {"default": 8, "min": 1, "max": 80, "step": 1}),
                "strict_turbo_compatibility": ("BOOLEAN", {"default": True}),
                "turbo_bypass_on_missing": ("BOOLEAN", {"default": True}),
                "native_weight_dtype": (
                    ("default", "fp8_e4m3fn", "fp8_e4m3fn_fast", "fp8_e5m2"),
                    {"default": "default"},
                ),
                "text_encoder_device": (("default", "cpu"), {"default": "default"}),
                "fallback_if_missing": ("BOOLEAN", {"default": True}),
                "unload_on_backend_change": ("BOOLEAN", {"default": True}),
            }
        }

    RETURN_TYPES = (
        "VELVET_VICE_H3_MODEL_CONFIG",
        "STRING",
        "STRING",
        "BOOLEAN",
        "STRING",
        "VELVET_VICE_H3_TURBO_CONFIG",
    )
    RETURN_NAMES = (
        "model_config",
        "video_vae_name",
        "audio_vae_name",
        "ready",
        "status",
        "turbo_config",
    )
    FUNCTION = "configure"
    CATEGORY = "VELVET VICE/MiniMax H3"
    DESCRIPTION = (
        "Central MiniMax H3 technical hub. Select Native or GGUF at any time; "
        "both model selections remain stored independently. Native and GGUF "
        "Qwen text encoders share one complete selector and route to their "
        "matching loader automatically. It also owns the "
        "technical Turbo/Distilled LoRA selection, strength, step pair and "
        "compatibility policy without applying the LoRA itself."
    )

    def configure(
        self,
        model_backend,
        auto_preference,
        native_model,
        gguf_model,
        text_encoder,
        video_vae,
        audio_vae,
        native_weight_dtype,
        text_encoder_device,
        fallback_if_missing=True,
        unload_on_backend_change=True,
        turbo_lora=MINIMAX_H3_AUTO,
        turbo_model_strength=1.0,
        base_steps=20,
        turbo_steps=8,
        strict_turbo_compatibility=True,
        turbo_bypass_on_missing=True,
    ):
        requested = str(model_backend or "AUTO").upper()
        preferred = str(auto_preference or "NATIVE").upper()
        native = _resolve_native(native_model)
        gguf = _resolve_gguf(gguf_model)
        encoder = _resolve_text_encoder(text_encoder)
        video = _resolve_required_name("vae", MINIMAX_H3_VIDEO_VAE, video_vae)
        audio = _resolve_required_name("vae", MINIMAX_H3_AUDIO_VAE, audio_vae)
        turbo = _resolve_turbo_lora(turbo_lora)
        turbo_compatible = bool(turbo and _is_h3_turbo_lora_candidate(turbo))
        gguf_plugin = _gguf_loader_available()
        gguf_clip_plugin = _gguf_clip_loader_available()
        encoder_backend = (
            "GGUF" if encoder and _normalized_model_name(encoder).endswith(".gguf") else "NATIVE"
        )
        encoder_usable = bool(
            encoder and (encoder_backend != "GGUF" or gguf_clip_plugin)
        )
        gguf_usable = bool(gguf and gguf_plugin)
        native_usable = bool(native)

        fallback = False
        active: str | None = None
        if requested == "AUTO":
            first, second = ("GGUF", "NATIVE") if preferred == "GGUF" else ("NATIVE", "GGUF")
            for backend in (first, second):
                if backend == "NATIVE" and native_usable:
                    active = "NATIVE"
                    break
                if backend == "GGUF" and gguf_usable:
                    active = "GGUF"
                    break
        elif requested == "NATIVE":
            if native_usable:
                active = "NATIVE"
            elif fallback_if_missing and gguf_usable:
                active, fallback = "GGUF", True
        elif requested == "GGUF":
            if gguf_usable:
                active = "GGUF"
            elif fallback_if_missing and native_usable:
                active, fallback = "NATIVE", True

        video_is_gguf = bool(video and _normalized_model_name(video).endswith(".gguf"))
        audio_is_gguf = bool(audio and _normalized_model_name(audio).endswith(".gguf"))
        # Audio is optional at system-configuration time because VIDEO ONLY
        # mode must be able to run without loading an audio VAE. The VAE router
        # enforces the audio file only when WITH SOUND is selected.
        core_ready = bool(active and encoder_usable and video and not video_is_gguf)
        issues = []
        compatibility_warnings = []
        if requested == "GGUF" and not gguf_plugin:
            issues.append("ComfyUI-GGUF loader missing")
        if active is None:
            issues.append("no usable H3 diffusion backend")
        if not encoder:
            issues.append("H3 text encoder missing")
        elif encoder_backend == "GGUF" and not gguf_clip_plugin:
            issues.append("ComfyUI-GGUF CLIPLoaderGGUF missing")
        if not video:
            issues.append("H3 video VAE missing")
        elif video_is_gguf:
            issues.append("GGUF video VAE unsupported; select a native ComfyUI VAE")
        if not audio:
            compatibility_warnings.append(
                "audio VAE missing; only MUTED / VIDEO ONLY mode is available"
            )
        elif audio_is_gguf:
            compatibility_warnings.append(
                "GGUF audio VAE unsupported; only MUTED / VIDEO ONLY mode is available"
            )

        selected_model = native if active == "NATIVE" else gguf
        if active == "NATIVE" and selected_model and not _is_h3_i2v_diffusion_candidate(selected_model):
            compatibility_warnings.append("selected Native model is not recognizable as MiniMax H3")
        if active == "GGUF" and selected_model and not any(
            token in _normalized_model_name(selected_model) for token in ("minimax", "h3")
        ):
            compatibility_warnings.append("selected GGUF model is not recognizable as MiniMax H3")
        if encoder and not _looks_like_h3_text_encoder(encoder):
            compatibility_warnings.append("selected text encoder compatibility is unverified")
        if video and not _looks_like_h3_vae(video, "video"):
            compatibility_warnings.append("selected video VAE compatibility is unverified")
        if audio and not _looks_like_h3_vae(audio, "audio"):
            compatibility_warnings.append("selected audio VAE compatibility is unverified")
        config = {
            "schema": "VELVET_VICE_H3_MODEL_CONFIG_V1",
            "requested_backend": requested,
            "active_backend": active,
            "fallback_active": fallback,
            "auto_preference": preferred,
            "native_model": native,
            "gguf_model": gguf,
            "selected_model": selected_model,
            "text_encoder": encoder,
            "text_encoder_backend": encoder_backend,
            "video_vae": video,
            "audio_vae": audio,
            "turbo_lora": turbo,
            "native_weight_dtype": str(native_weight_dtype),
            "text_encoder_device": str(text_encoder_device),
            "unload_on_backend_change": bool(unload_on_backend_change),
            "gguf_plugin_available": gguf_plugin,
            "gguf_clip_plugin_available": gguf_clip_plugin,
            "ready": core_ready,
            "compatibility_warnings": compatibility_warnings,
        }
        backend_text = active or "NONE"
        model_text = selected_model or "MISSING"
        turbo_status = (
            f"READY · {turbo}"
            if turbo and turbo_compatible
            else (f"INCOMPATIBLE · {turbo}" if turbo else "NOT INSTALLED · Base mode remains available")
        )
        turbo_config = {
            "schema": "VELVET_VICE_H3_TURBO_CONFIG_V1",
            "requested_lora": str(turbo_lora or MINIMAX_H3_AUTO),
            "resolved_lora": turbo,
            "available": bool(turbo),
            "compatible": turbo_compatible,
            "model_strength": float(turbo_model_strength),
            "base_steps": max(1, int(base_steps)),
            "turbo_steps": max(1, int(turbo_steps)),
            "strict_h3_compatibility": bool(strict_turbo_compatibility),
            "bypass_on_missing": bool(turbo_bypass_on_missing),
            "status": turbo_status,
        }
        if core_ready:
            status = f"READY | Backend: {backend_text} | Model: {model_text} | Turbo LoRA: {turbo_status}"
            if fallback:
                status += f" | FALLBACK from {requested}"
            if compatibility_warnings:
                status += " | WARNING: " + "; ".join(compatibility_warnings)
        else:
            status = "NOT READY | " + "; ".join(issues) + f" | Turbo LoRA: {turbo_status}"
        print(f"[VELVET VICE] H3 SYSTEM HUB | {status}")
        return _status_ui_result(
            config, video or "", audio or "", core_ready, status, turbo_config, status=status
        )


class VelvetViceMiniMaxH3VAERouter:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "model_config": ("VELVET_VICE_H3_MODEL_CONFIG",),
                "barrier": ("STRING", {"forceInput": True}),
                "audio_enabled": ("BOOLEAN", {"default": True}),
            }
        }

    RETURN_TYPES = ("VAE", "VAE", "STRING")
    RETURN_NAMES = ("video_vae", "audio_vae", "status")
    FUNCTION = "load"
    CATEGORY = "VELVET VICE/MiniMax H3/Internal"
    DESCRIPTION = (
        "Loads the resolved MiniMax H3 video/audio VAEs after the prompt "
        "barrier and passes strongly typed VAE objects into the H3 subgraph. "
        "This avoids COMBO values crossing a ComfyUI subgraph boundary."
    )

    def load(self, model_config, barrier, audio_enabled=True):
        config = dict(model_config or {})
        if not config.get("ready"):
            raise RuntimeError(
                "[VELVET VICE] H3 VAE router received a non-ready System Hub configuration."
            )
        video_name = str(config.get("video_vae") or "")
        audio_name = str(config.get("audio_vae") or "")
        if not video_name:
            raise RuntimeError(
                "[VELVET VICE] H3 VAE router requires a resolved video VAE file."
            )
        video_vae = VelvetViceMiniMaxH3VAELoader().load_vae(
            video_name, "video"
        )[0]
        audio_vae = None
        if bool(audio_enabled):
            if not audio_name or _normalized_model_name(audio_name).endswith(".gguf"):
                raise RuntimeError(
                    "[VELVET VICE] WITH SOUND requires a native ComfyUI H3 audio VAE. "
                    "Select one in System Hub or use MUTED / VIDEO ONLY."
                )
            audio_vae = VelvetViceMiniMaxH3VAELoader().load_vae(
                audio_name, "audio"
            )[0]
            audio_status = f"Audio VAE: {audio_name}"
        else:
            audio_status = "MUTED / VIDEO ONLY · Audio VAE not loaded"
        status = f"LOADED | Video VAE: {video_name} | {audio_status}"
        print(f"[VELVET VICE] H3 VAE ROUTER | {status}")
        return (video_vae, audio_vae, status)


class VelvetViceMiniMaxH3ModelRouter:
    def __init__(self):
        self._last_backend: str | None = None
        self._last_model: str | None = None

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "model_config": ("VELVET_VICE_H3_MODEL_CONFIG",),
                "barrier": ("STRING", {"forceInput": True}),
            }
        }

    RETURN_TYPES = ("MODEL", "CLIP", "STRING")
    RETURN_NAMES = ("model", "clip", "status")
    FUNCTION = "load"
    CATEGORY = "VELVET VICE/MiniMax H3/Internal"
    DESCRIPTION = (
        "Internal prompt-first Native/GGUF loader router. It executes only "
        "after the prompt/system-check barrier and unloads the previous model "
        "path when the backend changes."
    )

    def load(self, model_config, barrier):
        config = dict(model_config or {})
        if not config.get("ready"):
            raise RuntimeError("[VELVET VICE] H3 model router received a non-ready System Hub configuration.")
        backend = str(config.get("active_backend") or "")
        model_name = str(config.get("selected_model") or "")
        changed = backend != self._last_backend or model_name != self._last_model
        if changed and bool(config.get("unload_on_backend_change", True)):
            _unload_for_backend_change()
            if self._last_backend is not None:
                print(
                    "[VELVET VICE] H3 backend change | "
                    f"{self._last_backend}:{self._last_model} -> {backend}:{model_name} | previous path released"
                )

        if backend == "GGUF":
            model = _load_gguf_model(model_name)
        elif backend == "NATIVE":
            model = VelvetViceMiniMaxH3UNETLoader().load_unet(
                model_name,
                str(config.get("native_weight_dtype") or "default"),
            )[0]
        else:
            raise RuntimeError(f"[VELVET VICE] Unsupported active H3 backend: {backend}")

        clip = _load_text_encoder(
            str(config.get("text_encoder")),
            str(config.get("text_encoder_device") or "default"),
        )
        self._last_backend = backend
        self._last_model = model_name
        status = f"LOADED | {backend} | {model_name} | prompt-first barrier satisfied"
        print(f"[VELVET VICE] H3 MODEL ROUTER | {status}")
        return (model, clip, status)


class VelvetViceMiniMaxH3Director:
    def __init__(self):
        self._last_seed: int | None = None

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "first_frame": ("IMAGE",),
                "render_preset": (H3_RENDER_PRESETS, {"default": "BALANCED"}),
                "duration_seconds": (
                    "FLOAT", {
                        "default": 5.0, "min": 1.0, "max": H3_MAX_DURATION_SECONDS, "step": 0.1,
                        "tooltip": "Requested seconds. H3 snaps to its native 17k+5 frame grid at 24 FPS. ComfyUI accepts up to 3600 frames; Velvet Vice caps at the highest valid grid value (3592 frames ≈149.67s). The commonly trained range is about 5–15s; longer clips are untested by upstream ComfyUI."
                    }
                ),
                "format_mode": (H3_FORMATS, {"default": "AUTO"}),
                "resolution_mode": (H3_RESOLUTION_MODES, {"default": "PRESET"}),
                "resolution_preset": (H3_RESOLUTION_PRESETS, {"default": "900p"}),
                "rotate_format": ("BOOLEAN", {"default": False}),
                "custom_width": ("INT", {"default": 1344, "min": 256, "max": 4096, "step": 32}),
                "custom_height": ("INT", {"default": 768, "min": 256, "max": 4096, "step": 32}),
                "custom_megapixels": ("FLOAT", {"default": 0.4, "min": 0.1, "max": 4.0, "step": 0.1}),
                "turbo_enabled": ("BOOLEAN", {"default": False}),
                "seed_mode": (H3_SEED_MODES, {"default": "RANDOM"}),
                "seed": ("INT", {"default": 1, "min": 0, "max": 0x7FFFFFFFFFFFFFFF, "step": 1}),
                "native_audio_output": ("BOOLEAN", {"default": True}),
                "ending_mode": (H3_ENDING_MODES, {"default": "AUTO"}),
                "fps": ("INT", {"default": 24, "min": 24, "max": 24, "step": 1}),
            },
            "optional": {
                "last_frame": ("IMAGE",),
                "system_ready": ("BOOLEAN", {"forceInput": True}),
                "system_status": ("STRING", {"forceInput": True}),
            },
        }

    RETURN_TYPES = (
        "IMAGE", "IMAGE", "INT", "INT", "FLOAT", "FLOAT", "INT", "INT",
        "BOOLEAN", "BOOLEAN", "STRING", "VELVET_VICE_H3_RENDER_CONFIG", "STRING", "STRING",
    )
    RETURN_NAMES = (
        "first_frame", "last_frame", "width", "height", "duration_seconds", "fps",
        "frame_count", "seed", "turbo_enabled", "native_audio_output", "ending_mode",
        "render_config", "summary", "status",
    )
    FUNCTION = "direct"
    CATEGORY = "VELVET VICE/MiniMax H3"
    DESCRIPTION = (
        "Main MiniMax H3 user director: duration, automatic image format and "
        "resolution, seed control, Turbo master switch, audio-output control "
        "and ending mode. Technical model loading remains isolated in System Hub."
    )

    @classmethod
    def IS_CHANGED(cls, *args, **kwargs):
        # RANDOM seed must generate a fresh value for every queued render.
        return float("nan")

    def direct(
        self,
        first_frame,
        render_preset,
        duration_seconds,
        format_mode,
        resolution_mode,
        resolution_preset,
        rotate_format,
        custom_width,
        custom_height,
        custom_megapixels,
        turbo_enabled,
        seed_mode,
        seed,
        native_audio_output,
        ending_mode,
        fps=24,
        last_frame=None,
        system_ready=None,
        system_status=None,
    ):
        source_width, source_height = _safe_image_hw(first_frame)
        width, height = _plan_resolution(
            source_width,
            source_height,
            format_mode,
            resolution_mode,
            resolution_preset,
            bool(rotate_format),
            int(custom_width),
            int(custom_height),
            float(custom_megapixels),
        )
        fps = 24
        duration = max(1.0, min(H3_MAX_DURATION_SECONDS, float(duration_seconds)))
        frame_count = _h3_frame_count(duration, fps)
        mode = str(seed_mode or "RANDOM").upper()
        if mode == "LOCKED":
            resolved_seed = int(seed)
        elif mode == "REUSE LAST" and self._last_seed is not None:
            resolved_seed = int(self._last_seed)
        else:
            resolved_seed = secrets.randbelow(0x7FFFFFFFFFFFFFFF)
        self._last_seed = resolved_seed

        last_connected = last_frame is not None
        render_config = {
            "schema": "VELVET_VICE_H3_RENDER_CONFIG_V1",
            "render_preset": str(render_preset),
            "duration_seconds": duration,
            "fps": fps,
            "frame_count": frame_count,
            "width": width,
            "height": height,
            "format_mode": str(format_mode),
            "resolution_mode": str(resolution_mode),
            "resolution_preset": str(resolution_preset),
            "rotate_format": bool(rotate_format),
            "seed_mode": mode,
            "seed": resolved_seed,
            "turbo_enabled": bool(turbo_enabled),
            "native_audio_output": bool(native_audio_output),
            "ending_mode": str(ending_mode),
            "last_frame_connected": last_connected,
        }
        system_ok = True if system_ready is None else bool(system_ready)
        ready_text = "READY TO RENDER" if system_ok else "SYSTEM NOT READY"
        actual_duration = frame_count / float(fps)
        resolution_label = str(resolution_mode or "PRESET")
        resolution_detail = (
            str(resolution_preset)
            if resolution_label.upper() == "PRESET"
            else f"{float(custom_megapixels):.2f} MP"
            if resolution_label.upper() == "CUSTOM MP"
            else f"{int(custom_width)}×{int(custom_height)}"
        )
        summary = (
            f"{duration:g}s requested → {actual_duration:.3f}s actual · "
            f"{frame_count} H3 frames · {width}×{height} · 24 FPS · "
            f"{str(format_mode)} / {resolution_label} {resolution_detail} · "
            f"{'TURBO' if turbo_enabled else 'BASE'} · "
            f"AUDIO {'WITH SOUND' if native_audio_output else 'MUTED / VIDEO ONLY'} · "
            f"SEED {resolved_seed}"
        )
        status = f"{ready_text} | {summary}"
        if system_status:
            status += f" | {system_status}"
        print(f"[VELVET VICE] H3 DIRECTOR | {status}")
        return _status_ui_result(
            first_frame,
            last_frame,
            width,
            height,
            duration,
            float(fps),
            frame_count,
            resolved_seed,
            bool(turbo_enabled),
            bool(native_audio_output),
            str(ending_mode),
            render_config,
            summary,
            status,
            status=status,
        )


class VelvetViceMiniMaxH3AudioGate:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "audio": ("AUDIO",),
                "enabled": ("BOOLEAN", {"default": True}),
            }
        }

    RETURN_TYPES = ("AUDIO", "STRING")
    RETURN_NAMES = ("audio", "status")
    FUNCTION = "route"
    CATEGORY = "VELVET VICE/MiniMax H3/Internal"

    def route(self, audio, enabled=True):
        if bool(enabled):
            return (audio, "WITH SOUND · Native H3 audio attached to final video")
        return (None, "MUTED / VIDEO ONLY · final video has no audio track")


class VelvetViceMiniMaxH3AudioDecodeGate:
    """Skip native H3 audio decoding entirely in VIDEO ONLY mode."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "samples": ("LATENT",),
                "vae": ("VAE",),
                "enabled": ("BOOLEAN", {"default": True}),
            }
        }

    RETURN_TYPES = ("AUDIO",)
    RETURN_NAMES = ("audio",)
    FUNCTION = "decode"
    CATEGORY = "VELVET VICE/MiniMax H3/Internal"
    DESCRIPTION = (
        "Decodes the native H3 audio latent only in WITH SOUND mode. "
        "MUTED / VIDEO ONLY returns no audio without touching the audio VAE."
    )

    def decode(self, samples, vae, enabled=True):
        if not bool(enabled):
            print("[VELVET VICE] H3 AUDIO | MUTED / VIDEO ONLY · audio decode skipped")
            return (None,)
        if vae is None:
            raise RuntimeError(
                "[VELVET VICE] WITH SOUND requires a loaded native H3 audio VAE."
            )
        try:
            import nodes as comfy_nodes
        except Exception as exc:
            raise RuntimeError("ComfyUI's audio decoder registry is unavailable.") from exc
        decoder_cls = getattr(comfy_nodes, "NODE_CLASS_MAPPINGS", {}).get("VAEDecodeAudio")
        if decoder_cls is None:
            raise RuntimeError("ComfyUI's VAEDecodeAudio node is unavailable.")
        decoder = decoder_cls()
        function = getattr(decoder, getattr(decoder_cls, "FUNCTION", "decode"))
        result = function(samples=samples, vae=vae)
        print("[VELVET VICE] H3 AUDIO | WITH SOUND · native audio decoded")
        return result


class VelvetViceMiniMaxH3OutputHub:
    PREVIEW_FPS = ("AUTO", "10", "15", "20", "24", "30")
    PREVIEW_QUALITY = ("AUTO", "LOW", "MEDIUM", "HIGH")
    PREVIEW_MAX_SIZE = ("384", "512", "640", "768", "1024")

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "live_preview": ("BOOLEAN", {"default": True}),
                "preview_fps": (cls.PREVIEW_FPS, {"default": "AUTO"}),
                "preview_quality": (cls.PREVIEW_QUALITY, {"default": "HIGH"}),
                "preview_max_size": (cls.PREVIEW_MAX_SIZE, {"default": "1024"}),
                "rife_48_fps": ("BOOLEAN", {"default": False}),
                "anti_ghost": ("BOOLEAN", {"default": False}),
                "watermark": ("BOOLEAN", {"default": False}),
                "watermark_file": (watermark_file_options(), {"default": "Velvet_Vice_Watermark.png"}),
                "project_name": (
                    "STRING",
                    {"default": "VELVET_VICE_MINIMAX_H3_I2V_FINAL", "multiline": False},
                ),
                "watermark_position": (
                    (
                        "top-left", "top-center", "top-right",
                        "center-left", "center", "center-right",
                        "bottom-left", "bottom-center", "bottom-right",
                    ),
                    {"default": "bottom-right"},
                ),
                "watermark_scale": (
                    "FLOAT", {"default": 0.18, "min": 0.02, "max": 0.80, "step": 0.01}
                ),
                "watermark_opacity": (
                    "FLOAT", {"default": 0.65, "min": 0.0, "max": 1.0, "step": 0.01}
                ),
                "watermark_margin_x": (
                    "INT", {"default": 24, "min": 0, "max": 2048, "step": 1}
                ),
                "watermark_margin_y": (
                    "INT", {"default": 24, "min": 0, "max": 2048, "step": 1}
                ),
            }
        }

    RETURN_TYPES = (
        "BOOLEAN", "FLOAT", "BOOLEAN", "BOOLEAN", "BOOLEAN", "STRING",
        "STRING", "FLOAT", "FLOAT", "INT", "INT", "INT", "INT", "STRING",
    )
    RETURN_NAMES = (
        "live_preview", "preview_fps", "rife_48_fps", "anti_ghost", "watermark",
        "filename_prefix", "watermark_position", "watermark_scale",
        "watermark_opacity", "watermark_margin_x", "watermark_margin_y",
        "preview_quality", "preview_max_size", "watermark_file",
    )
    FUNCTION = "route"
    CATEGORY = "VELVET VICE/MiniMax H3"
    DESCRIPTION = (
        "MiniMax H3-specific finishing/output controls with live preview, "
        "post-processing, watermark and project settings. Live preview is "
        "isolated from the final render path."
    )

    def route(
        self,
        live_preview=True,
        preview_fps="AUTO",
        preview_quality="HIGH",
        preview_max_size="1024",
        rife_48_fps=False,
        anti_ghost=False,
        watermark=False,
        watermark_file="Velvet_Vice_Watermark.png",
        project_name="VELVET_VICE_MINIMAX_H3_I2V_FINAL",
        watermark_position="bottom-right",
        watermark_scale=0.18,
        watermark_opacity=0.65,
        watermark_margin_x=24,
        watermark_margin_y=24,
    ):
        text = str(preview_fps or "AUTO").upper()
        resolved_preview_fps = 24.0 if text == "AUTO" else float(text)
        quality_text = str(preview_quality or "HIGH").upper()
        if quality_text not in self.PREVIEW_QUALITY:
            quality_text = "HIGH"
        resolved_preview_quality = {
            "AUTO": 0,
            "LOW": 1,
            "MEDIUM": 2,
            "HIGH": 3,
        }[quality_text]
        try:
            resolved_preview_max_size = int(str(preview_max_size or "1024").strip())
        except (TypeError, ValueError):
            resolved_preview_max_size = 1024
        resolved_preview_max_size = max(384, min(1024, resolved_preview_max_size))
        return (
            bool(live_preview),
            max(1.0, min(30.0, resolved_preview_fps)),
            bool(rife_48_fps),
            bool(anti_ghost),
            bool(watermark),
            "video/" + str(project_name or "VELVET_VICE_MINIMAX_H3_I2V_FINAL").strip().removeprefix("video/"),
            str(watermark_position or "bottom-right"),
            float(watermark_scale),
            float(watermark_opacity),
            int(watermark_margin_x),
            int(watermark_margin_y),
            resolved_preview_quality,
            resolved_preview_max_size,
            str(watermark_file or "Velvet_Vice_Watermark.png"),
        )


class VelvetViceMiniMaxH3ProfileManager:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "active_profile": ("STRING", {"default": "", "multiline": False}),
                "profile_scope": (("FULL H3", "LORA ONLY"), {"default": "FULL H3"}),
                "profile_payload": ("STRING", {"default": "{}", "multiline": True}),
            }
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("profile_name",)
    FUNCTION = "profile_name"
    CATEGORY = "VELVET VICE/MiniMax H3"
    DESCRIPTION = (
        "Persistent user profile manager. The frontend can save, load, rename, "
        "duplicate, delete, import and export named H3 or LoRA-only profiles. "
        "Profiles are stored under ComfyUI user data, outside this node pack."
    )

    def profile_name(self, active_profile, profile_scope, profile_payload):
        return (str(active_profile or ""),)


_ROUTES_REGISTERED = False


def _json_error(message: str, status: int = 400):
    return web.json_response({"ok": False, "error": message}, status=status)


def _scope_from_ui(value: Any) -> str:
    text = str(value or "h3").strip().lower()
    return "lora" if text in {"lora", "lora only", "lora_only"} else "h3"


def _h3_preview_decoder_info() -> Dict[str, Any]:
    """Return a lightweight startup check for the optional H3 TAEHV decoder.

    The decoder is not required for LOW preview and HIGH can use the connected
    full H3 video VAE. AUTO/MEDIUM prefer this tiny decoder when installed.
    This helper only reports availability; it never loads or mutates render state.
    """
    target = "taeh3_decoder.safetensors"
    try:
        import folder_paths  # type: ignore

        names = [str(name) for name in folder_paths.get_filename_list("vae_approx")]
        matches = [
            name for name in names
            if name.replace("\\", "/").split("/")[-1].lower() == target
        ]
        if matches:
            return {
                "installed": True,
                "filename": matches[0],
                "relative_path": f"models/vae_approx/{target}",
                "medium_path": "TAEHV",
                "high_path": "FULL H3 VIDEO VAE",
                "low_path": "LATENT2RGB",
            }
    except Exception:
        pass
    return {
        "installed": False,
        "filename": "",
        "relative_path": f"models/vae_approx/{target}",
        "medium_path": "LATENT2RGB FALLBACK",
        "high_path": "FULL H3 VIDEO VAE",
        "low_path": "LATENT2RGB",
    }


def _register_h3_routes() -> None:
    global _ROUTES_REGISTERED
    if _ROUTES_REGISTERED or PromptServer is None or web is None:
        return
    try:
        routes = PromptServer.instance.routes

        @routes.get("/velvet_vice/h3/preview_decoder")
        async def vv_h3_preview_decoder(request):
            del request
            return web.json_response({"ok": True, **_h3_preview_decoder_info()})

        @routes.get("/velvet_vice/h3/profiles")
        async def vv_h3_profiles_list(request):
            scope = _scope_from_ui(request.query.get("scope", "h3"))
            return web.json_response({"ok": True, "scope": scope, "profiles": list_profiles(scope)})

        @routes.post("/velvet_vice/h3/profiles/load")
        async def vv_h3_profiles_load(request):
            try:
                data = await request.json()
                scope = _scope_from_ui(data.get("scope"))
                profile = load_profile(scope, data.get("name"))
                return web.json_response({"ok": True, "profile": profile})
            except FileNotFoundError as exc:
                return _json_error(str(exc), 404)
            except Exception as exc:
                return _json_error(str(exc))

        @routes.post("/velvet_vice/h3/profiles/save")
        async def vv_h3_profiles_save(request):
            try:
                data = await request.json()
                scope = _scope_from_ui(data.get("scope"))
                profile = save_profile(scope, data.get("name"), dict(data.get("payload") or {}))
                return web.json_response({"ok": True, "profile": profile})
            except Exception as exc:
                return _json_error(str(exc))

        @routes.post("/velvet_vice/h3/profiles/delete")
        async def vv_h3_profiles_delete(request):
            try:
                data = await request.json()
                scope = _scope_from_ui(data.get("scope"))
                deleted = delete_profile(scope, data.get("name"))
                return web.json_response({"ok": True, "deleted": deleted})
            except Exception as exc:
                return _json_error(str(exc))

        @routes.post("/velvet_vice/h3/profiles/rename")
        async def vv_h3_profiles_rename(request):
            try:
                data = await request.json()
                scope = _scope_from_ui(data.get("scope"))
                profile = rename_profile(scope, data.get("old_name"), data.get("new_name"))
                return web.json_response({"ok": True, "profile": profile})
            except Exception as exc:
                return _json_error(str(exc))

        @routes.post("/velvet_vice/h3/profiles/import")
        async def vv_h3_profiles_import(request):
            try:
                data = await request.json()
                scope = _scope_from_ui(data.get("scope"))
                profile = import_profile(scope, dict(data.get("document") or {}), overwrite_name=data.get("name"))
                return web.json_response({"ok": True, "profile": profile})
            except Exception as exc:
                return _json_error(str(exc))

        @routes.post("/velvet_vice/h3/profiles/export")
        async def vv_h3_profiles_export(request):
            try:
                data = await request.json()
                scope = _scope_from_ui(data.get("scope"))
                profile = export_profile(scope, data.get("name"))
                return web.json_response({"ok": True, "profile": profile})
            except FileNotFoundError as exc:
                return _json_error(str(exc), 404)
            except Exception as exc:
                return _json_error(str(exc))

        @routes.get("/velvet_vice/h3/state/system")
        async def vv_h3_system_state_load(request):
            try:
                state = load_state("system_hub")
                return web.json_response({"ok": True, "state": state})
            except Exception as exc:
                return _json_error(str(exc))

        @routes.post("/velvet_vice/h3/state/system")
        async def vv_h3_system_state_save(request):
            try:
                data = await request.json()
                state = save_state("system_hub", dict(data.get("payload") or {}))
                return web.json_response({"ok": True, "state": state})
            except Exception as exc:
                return _json_error(str(exc))

        @routes.get("/velvet_vice/h3/state/director")
        async def vv_h3_director_state_load(request):
            try:
                state = load_state("director")
                return web.json_response({"ok": True, "state": state})
            except Exception as exc:
                return _json_error(str(exc))

        @routes.post("/velvet_vice/h3/state/director")
        async def vv_h3_director_state_save(request):
            try:
                data = await request.json()
                state = save_state("director", dict(data.get("payload") or {}))
                return web.json_response({"ok": True, "state": state})
            except Exception as exc:
                return _json_error(str(exc))

        @routes.get("/velvet_vice/h3/state/output_hub")
        async def vv_h3_output_hub_state_load(request):
            try:
                state = load_state("output_hub")
                return web.json_response({"ok": True, "state": state})
            except Exception as exc:
                return _json_error(str(exc))

        @routes.post("/velvet_vice/h3/state/output_hub")
        async def vv_h3_output_hub_state_save(request):
            try:
                data = await request.json()
                state = save_state("output_hub", dict(data.get("payload") or {}))
                return web.json_response({"ok": True, "state": state})
            except Exception as exc:
                return _json_error(str(exc))

        _ROUTES_REGISTERED = True
    except Exception:
        _ROUTES_REGISTERED = True


_register_h3_routes()
