from __future__ import annotations

import json
import os
from collections import OrderedDict
from pathlib import Path
import shutil
import socket
import subprocess
import urllib.error
import urllib.request
from typing import Any, Dict, Iterable, Optional

from ..model_profiles import normalize_ltx_version, required_models
from ..version import PACK_VERSION

from .watermark_overlay import POSITIONS as WATERMARK_POSITIONS, watermark_file_options

from .auto_video_output import (
    VelvetViceLTXAutoVideoCombineV0113,
    resolve_filename_prefix,
    probe_nvenc,
    _ffmpeg_path,
    _video_combine_class,
)

try:
    import folder_paths  # type: ignore
except Exception:  # pragma: no cover - only absent outside ComfyUI
    folder_paths = None

try:
    import torch  # type: ignore
except Exception:  # pragma: no cover - optional during static tests
    torch = None

try:
    from aiohttp import web  # type: ignore
    from server import PromptServer  # type: ignore
except Exception:  # pragma: no cover - only absent outside ComfyUI
    web = None
    PromptServer = None


PROFILE_TEST = "TEST"
PROFILE_BALANCED = "BALANCED"
PROFILE_FINAL = "FINAL"
PROFILE_CUSTOM = "CUSTOM"

PROFILE_VALUES = {
    PROFILE_TEST: (False, False, False, False),
    PROFILE_BALANCED: (False, True, False, False),
    PROFILE_FINAL: (True, True, True, False),
}

LEGACY_REQUIRED_MODEL_FILES = (
    (
        "Base model",
        "10Eros_v1_bf16.safetensors",
        ("diffusion_models", "unet", "checkpoints"),
        True,
    ),
    (
        "Text encoder",
        "gemma-3-12b-it-heretic-v2_fp8_e4m3fn.safetensors",
        ("text_encoders", "clip"),
        True,
    ),
    (
        "Text projection",
        "ltx-2.3_text_projection_bf16.safetensors",
        ("text_encoders", "clip"),
        True,
    ),
    (
        "Full video VAE",
        "LTX23_video_vae_bf16.safetensors",
        ("vae",),
        True,
    ),
    (
        "Audio VAE",
        "LTX23_audio_vae_bf16.safetensors",
        ("vae",),
        True,
    ),
    (
        "Spatial upscaler",
        "ltx-2.3-spatial-upscaler-x2-1.1.safetensors",
        ("latent_upscale_models", "upscale_models"),
        True,
    ),
    (
        "Preview VAE",
        "taeltx2_3.safetensors",
        ("vae",),
        False,
    ),
)

OPTIONAL_LORAS = (
    "ltx-2.3-22b-distilled-lora-1.1_rank72_energy.safetensors",
    "ltx-2-19b-ic-lora-union-control-ref0.5.safetensors",
    "ltx-2-19b-ic-lora-detailer.safetensors",
)


def _safe_send(message_type: str, payload: Dict[str, Any]) -> None:
    if PromptServer is None:
        return
    try:
        PromptServer.instance.send_sync(message_type, payload)
    except Exception:
        pass


def _folder_candidates(category: str) -> Iterable[Path]:
    if folder_paths is None:
        return ()
    try:
        return tuple(Path(path) for path in folder_paths.get_folder_paths(category))
    except Exception:
        return ()


def _find_model_file(filename: str, categories: Iterable[str]) -> Optional[Path]:
    if not filename:
        return None
    if folder_paths is not None:
        for category in categories:
            try:
                full_path = folder_paths.get_full_path(category, filename)
            except Exception:
                full_path = None
            if full_path and Path(full_path).is_file():
                return Path(full_path)
            for base in _folder_candidates(category):
                candidate = base / filename
                if candidate.is_file():
                    return candidate
    return None


def _input_file(filename: str) -> Optional[Path]:
    if not filename or folder_paths is None:
        return None
    try:
        annotated = folder_paths.get_annotated_filepath(filename)
        if annotated and Path(annotated).is_file():
            return Path(annotated)
    except Exception:
        pass
    try:
        candidate = Path(folder_paths.get_input_directory()) / filename
        if candidate.is_file():
            return candidate
    except Exception:
        pass
    return None


def _output_is_writable() -> tuple[bool, str]:
    if folder_paths is None:
        return False, "ComfyUI folder paths are unavailable"
    try:
        path = Path(folder_paths.get_output_directory())
        path.mkdir(parents=True, exist_ok=True)
        writable = os.access(path, os.W_OK)
        return writable, str(path)
    except Exception as exc:
        return False, str(exc)


def _ollama_probe(base_url: str, timeout: float = 1.5) -> tuple[bool, str]:
    url = str(base_url or "http://127.0.0.1:11434").rstrip("/") + "/api/tags"
    request = urllib.request.Request(url, headers={"Accept": "application/json"})
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            if 200 <= int(response.status) < 300:
                return True, "Ollama responded"
            return False, f"HTTP {response.status}"
    except (urllib.error.URLError, TimeoutError, socket.timeout, OSError) as exc:
        return False, str(exc)


def _check(
    key: str,
    label: str,
    ok: bool,
    message: str,
    *,
    required: bool,
) -> Dict[str, Any]:
    if ok:
        status = "pass"
    elif required:
        status = "fail"
    else:
        status = "warn"
    return {
        "key": key,
        "label": label,
        "status": status,
        "message": message,
        "required": required,
    }


def run_preflight(payload: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    data = payload or {}
    checks = []

    try:
        ltx_version = normalize_ltx_version(data.get("ltx_version", "2.3"))
        checks.append(_check("ltx_version", "Workflow profile", True, f"LTX {ltx_version} / pack {PACK_VERSION}", required=True))
    except ValueError as exc:
        ltx_version = "2.3"
        checks.append(_check("ltx_version", "Workflow profile", False, str(exc), required=True))

    reference_image = str(data.get("reference_image") or "")
    reference_path = _input_file(reference_image)
    checks.append(
        _check(
            "reference_image",
            "Reference image",
            reference_path is not None,
            str(reference_path) if reference_path else (reference_image or "No image selected"),
            required=True,
        )
    )

    watermark_enabled = bool(data.get("watermark_enabled", False))
    watermark_name = str(data.get("watermark_name") or "Velvet_Vice_Watermark.png")
    watermark_path = _input_file(watermark_name)
    checks.append(
        _check(
            "watermark",
            "Velvet Vice watermark",
            watermark_path is not None,
            str(watermark_path) if watermark_path else watermark_name,
            required=watermark_enabled,
        )
    )

    selected_models = data.get("selected_models")
    if not isinstance(selected_models, list) or not selected_models:
        selected_models = [
            {
                "label": label,
                "filename": filename,
                "categories": list(categories),
                "required": required,
            }
            for label, filename, categories, required in required_models(ltx_version)
        ]
    for index, entry in enumerate(selected_models):
        if not isinstance(entry, dict):
            continue
        label = str(entry.get("label") or f"Selected model {index + 1}")
        filename = str(entry.get("filename") or "")
        categories = entry.get("categories") or ("diffusion_models", "unet", "checkpoints", "vae", "text_encoders", "clip", "latent_upscale_models", "upscale_models", "loras")
        if not isinstance(categories, (list, tuple)):
            categories = (str(categories),)
        required = bool(entry.get("required", True))
        found = _find_model_file(filename, tuple(str(item) for item in categories)) if filename else None
        checks.append(
            _check(
                f"model_{index}",
                label,
                found is not None,
                str(found) if found else (filename or "No file selected"),
                required=required,
            )
        )

    active_loras = data.get("active_loras")
    if isinstance(active_loras, list):
        for index, filename in enumerate(active_loras):
            filename = str(filename or "")
            if not filename or filename == "None":
                continue
            found = _find_model_file(filename, ("loras",))
            checks.append(
                _check(
                    f"active_lora_{index}",
                    "Active LoRA",
                    found is not None,
                    str(found) if found else filename,
                    required=True,
                )
            )

    ffmpeg_path = shutil.which("ffmpeg")
    try:
        video_combine = _video_combine_class()
        ffmpeg_path = _ffmpeg_path(video_combine) or ffmpeg_path
        vhs_ok = True
        vhs_message = "VideoHelperSuite output node available"
    except Exception as exc:
        video_combine = None
        vhs_ok = False
        vhs_message = str(exc)
    checks.append(
        _check(
            "video_helper_suite",
            "VideoHelperSuite",
            vhs_ok,
            vhs_message,
            required=True,
        )
    )
    checks.append(
        _check(
            "ffmpeg",
            "FFmpeg",
            bool(ffmpeg_path),
            str(ffmpeg_path or "Not found"),
            required=True,
        )
    )

    if bool(data.get("check_nvenc", True)) and ffmpeg_path:
        nvenc_ok, nvenc_detail = probe_nvenc(str(ffmpeg_path))
        checks.append(
            _check(
                "nvenc",
                "NVIDIA NVENC",
                nvenc_ok,
                nvenc_detail,
                required=False,
            )
        )

    if bool(data.get("check_ollama", True)):
        ollama_required = bool(data.get("ollama_required", True))
        ollama_ok, ollama_detail = _ollama_probe(str(data.get("ollama_url") or ""))
        checks.append(
            _check(
                "ollama",
                "Ollama",
                ollama_ok,
                ollama_detail,
                required=ollama_required,
            )
        )

    cuda_ok = bool(torch is not None and torch.cuda.is_available())
    if cuda_ok:
        try:
            device_name = torch.cuda.get_device_name(0)
        except Exception:
            device_name = "CUDA device available"
    else:
        device_name = "CUDA device not detected"
    checks.append(
        _check(
            "cuda",
            "CUDA device",
            cuda_ok,
            device_name,
            required=True,
        )
    )

    output_ok, output_detail = _output_is_writable()
    checks.append(
        _check(
            "output_directory",
            "Output directory",
            output_ok,
            output_detail,
            required=True,
        )
    )

    failures = sum(1 for item in checks if item["status"] == "fail")
    warnings = sum(1 for item in checks if item["status"] == "warn")
    passes = sum(1 for item in checks if item["status"] == "pass")
    strict_report = bool(data.get("strict_report", False))
    return {
        "ok": failures == 0 and (not strict_report or warnings == 0),
        "summary": {
            "passes": passes,
            "warnings": warnings,
            "failures": failures,
        },
        "checks": checks,
    }



def get_lora_catalog() -> Dict[str, Any]:
    """Return the live ComfyUI LoRA catalog, sorted and deduplicated.

    The frontend deliberately does not rely only on a hidden combo widget. A
    fresh server catalog makes click-to-open and type-to-filter reliable after
    LoRAs are added while ComfyUI is running.
    """
    items = []
    if folder_paths is not None:
        try:
            items.extend(folder_paths.get_filename_list("loras"))
        except Exception:
            pass
    for filename in OPTIONAL_LORAS:
        if filename not in items:
            items.append(filename)
    clean = sorted({str(item) for item in items if str(item) and str(item) != "None"}, key=str.casefold)
    return {"ok": True, "count": len(clean), "items": clean}


def analyze_lora_file(filename: str) -> Dict[str, Any]:
    name = str(filename or "None")
    if not name or name == "None":
        return {
            "ok": True,
            "filename": "None",
            "kind": "EMPTY",
            "video_keys": 0,
            "audio_keys": 0,
            "clip_keys": 0,
            "audio_supported": False,
        }
    path = _find_model_file(name, ("loras",))
    if path is None:
        return {"ok": False, "filename": name, "kind": "MISSING", "message": "LoRA file not found"}
    try:
        keys = None
        if path.suffix.lower() == ".safetensors":
            try:
                from safetensors import safe_open  # type: ignore
                with safe_open(str(path), framework="pt", device="cpu") as handle:
                    keys = list(handle.keys())
            except Exception:
                keys = None
        if keys is None:
            lora = VelvetVicePowerLoraAV._load_lora(name)
            keys = list((lora or {}).keys())
        report = VelvetVicePowerLoraAV.analyze_keys(keys)
        return {"ok": True, "filename": name, **report}
    except Exception as exc:
        return {"ok": False, "filename": name, "kind": "ERROR", "message": str(exc)}

_ROUTES_REGISTERED = False


def _register_routes() -> None:
    global _ROUTES_REGISTERED
    if _ROUTES_REGISTERED or PromptServer is None or web is None:
        return
    try:
        routes = PromptServer.instance.routes

        @routes.get("/velvet_vice/h3/lora/catalog")
        async def velvet_vice_lora_catalog(request):
            return web.json_response(get_lora_catalog())

        @routes.post("/velvet_vice/h3/lora/analyze")
        async def velvet_vice_lora_analyze(request):
            try:
                data = await request.json()
            except Exception:
                data = {}
            return web.json_response(analyze_lora_file(str(data.get("filename") or "None")))

        _ROUTES_REGISTERED = True
    except Exception:
        # ComfyUI can import custom nodes more than once during development.
        # A duplicate route should not prevent the node pack from loading.
        _ROUTES_REGISTERED = True


_register_routes()


class VelvetViceControlHub:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "edition": (["ANTIGHOST"], {"default": "ANTIGHOST"}),
                "profile": (
                    [PROFILE_TEST, PROFILE_BALANCED, PROFILE_FINAL, PROFILE_CUSTOM],
                    {"default": PROFILE_BALANCED},
                ),
                "output_48_fps": ("BOOLEAN", {"default": False}),
                "quality_filter": ("BOOLEAN", {"default": True}),
                "watermark": ("BOOLEAN", {"default": False}),
                "soundmark": ("BOOLEAN", {"default": False}),
                "project_name": (
                    "STRING",
                    {"default": "VELVET_VICE_LTX23_FINAL", "multiline": False},
                ),
                "watermark_file": (watermark_file_options(), {"image_upload": True}),
                "watermark_position": (list(WATERMARK_POSITIONS), {"default": "bottom-right"}),
                "watermark_scale": ("FLOAT", {"default": 0.18, "min": 0.02, "max": 0.80, "step": 0.01}),
                "watermark_opacity": ("FLOAT", {"default": 0.65, "min": 0.0, "max": 1.0, "step": 0.01}),
                "watermark_margin_x": ("INT", {"default": 24, "min": 0, "max": 2048, "step": 1}),
                "watermark_margin_y": ("INT", {"default": 24, "min": 0, "max": 2048, "step": 1}),
            }
        }

    RETURN_TYPES = ("BOOLEAN", "BOOLEAN", "BOOLEAN", "BOOLEAN", "STRING", "STRING", "STRING", "FLOAT", "FLOAT", "INT", "INT")
    RETURN_NAMES = (
        "output_48_fps",
        "quality_filter",
        "watermark",
        "soundmark",
        "project_name",
        "watermark_file",
        "watermark_position",
        "watermark_scale",
        "watermark_opacity",
        "watermark_margin_x",
        "watermark_margin_y",
    )
    FUNCTION = "route_controls"
    CATEGORY = "VELVET VICE/LTX"
    DESCRIPTION = (
        "Central Velvet Vice control surface. The selected profile resolves to "
        "real graph controls for FPS routing, quality filtering, watermark, "
        "soundmark and final project naming."
    )

    def route_controls(
        self,
        edition,
        profile,
        output_48_fps,
        quality_filter,
        watermark,
        soundmark,
        project_name,
        watermark_file,
        watermark_position,
        watermark_scale,
        watermark_opacity,
        watermark_margin_x,
        watermark_margin_y,
    ):
        if profile in PROFILE_VALUES:
            output_48_fps, quality_filter, watermark, soundmark = PROFILE_VALUES[profile]
        safe_project = resolve_filename_prefix(str(project_name or "VELVET_VICE_LTX23_FINAL"))
        if safe_project.startswith("video/"):
            safe_project = safe_project[6:]
        return (
            bool(output_48_fps),
            bool(quality_filter),
            bool(watermark),
            bool(soundmark),
            safe_project,
            str(watermark_file or "Velvet_Vice_Watermark.png"),
            str(watermark_position or "bottom-right"),
            float(watermark_scale),
            float(watermark_opacity),
            int(watermark_margin_x),
            int(watermark_margin_y),
        )


class VelvetVicePowerLoraAV:
    """Power-LoRA-style loader with audio/video routing for LTX and H3.

    The visible row stack is stored as JSON so the frontend can add, remove and
    reorder entries without creating a fixed maximum number of ComfyUI widgets.
    FULL keeps the normal LoRA behaviour, VIDEO applies the visual path only,
    and AUDIO applies audio blocks plus video-to-audio attention while excluding
    audio-to-video attention to reduce direct visual influence. MiniMax H3 uses
    the same ordered stack; only H3/FL2VA-compatible weights should be selected.
    """

    _lora_cache: "OrderedDict[str, Any]" = OrderedDict()
    MAX_CACHE_ITEMS = max(0, int(os.environ.get("VELVET_VICE_LORA_CACHE_ITEMS", "2") or 2))
    VALID_MODES = {"FULL", "VIDEO", "AUDIO"}
    MAX_SLOTS = 64

    DEFAULT_STACK = [
        {
            "id": "union",
            "enabled": False,
            "lora": "ltx-2-19b-ic-lora-union-control-ref0.5.safetensors",
            "mode": "FULL",
            "video_strength": 0.45454711914062484,
            "audio_strength": 0.45454711914062484,
            "clip_strength": 0.45454711914062484,
        },
        {
            "id": "detailer",
            "enabled": False,
            "lora": "ltx-2-19b-ic-lora-detailer.safetensors",
            "mode": "FULL",
            "video_strength": 0.28,
            "audio_strength": 0.28,
            "clip_strength": 0.28,
        },
    ]

    @classmethod
    def _lora_choices(cls):
        choices = ["None"]
        if folder_paths is not None:
            try:
                choices.extend(folder_paths.get_filename_list("loras"))
            except Exception:
                pass
        for filename in OPTIONAL_LORAS:
            if filename not in choices:
                choices.append(filename)
        return choices

    @classmethod
    def INPUT_TYPES(cls):
        choices = cls._lora_choices()
        return {
            "required": {
                "model": ("MODEL",),
                "clip": ("CLIP",),
                "lora_stack_json": (
                    "STRING",
                    {
                        "default": json.dumps(cls.DEFAULT_STACK, ensure_ascii=False),
                        "multiline": True,
                        "dynamicPrompts": False,
                    },
                ),
                "lora_catalog": (choices, {"default": "None"}),
            }
        }

    RETURN_TYPES = ("MODEL", "CLIP")
    RETURN_NAMES = ("model", "clip")
    FUNCTION = "apply_loras"
    CATEGORY = "VELVET VICE/LTX"
    DESCRIPTION = (
        "Power-LoRA-style ordered stack with FULL, VIDEO and AUDIO routing for "
        "compatible LTX or MiniMax H3 audio-video LoRAs. AUDIO excludes "
        "audio-to-video LoRA patches."
    )

    @classmethod
    def _load_lora(cls, filename: str):
        if not filename or filename == "None":
            return None
        if filename in cls._lora_cache:
            cached = cls._lora_cache.pop(filename)
            cls._lora_cache[filename] = cached
            return cached
        if folder_paths is None:
            raise RuntimeError("ComfyUI folder_paths is unavailable")
        if hasattr(folder_paths, "get_full_path_or_raise"):
            try:
                path = folder_paths.get_full_path_or_raise("loras", filename)
            except Exception as exc:
                raise FileNotFoundError(f"LoRA not found: {filename}") from exc
        else:
            path = folder_paths.get_full_path("loras", filename)
            if not path:
                raise FileNotFoundError(f"LoRA not found: {filename}")
        import comfy.utils  # type: ignore
        lora = comfy.utils.load_torch_file(path, safe_load=True)
        if cls.MAX_CACHE_ITEMS > 0:
            cls._lora_cache[filename] = lora
            while len(cls._lora_cache) > cls.MAX_CACHE_ITEMS:
                cls._lora_cache.popitem(last=False)
        return lora

    @staticmethod
    def _clamp_strength(value: Any, default: float = 1.0) -> float:
        try:
            return max(-4.0, min(4.0, float(value)))
        except (TypeError, ValueError):
            return default

    @classmethod
    def _parse_stack(cls, raw: Any):
        if raw in (None, "", []):
            return []
        try:
            data = json.loads(raw) if isinstance(raw, str) else raw
        except (TypeError, ValueError, json.JSONDecodeError):
            return []
        if not isinstance(data, list):
            return []
        result = []
        for index, item in enumerate(data[: cls.MAX_SLOTS]):
            if not isinstance(item, dict):
                continue
            mode = str(item.get("mode", "FULL") or "FULL").upper()
            if mode not in cls.VALID_MODES:
                mode = "FULL"
            result.append(
                {
                    "id": str(item.get("id", f"slot-{index + 1}")),
                    "enabled": bool(item.get("enabled", True)),
                    "lora": str(item.get("lora", item.get("filename", "None")) or "None"),
                    "mode": mode,
                    "video_strength": cls._clamp_strength(
                        item.get("video_strength", item.get("strength", 1.0))
                    ),
                    "audio_strength": cls._clamp_strength(
                        item.get("audio_strength", item.get("strength", 1.0))
                    ),
                    "clip_strength": cls._clamp_strength(
                        item.get("clip_strength", item.get("strength_clip", 0.0)), 0.0
                    ),
                }
            )
        return result

    @staticmethod
    def _key_family(key: str) -> str:
        """Classify a raw LoRA tensor key by the LTX target path.

        LTX names audio self/cross attention and FFN blocks with ``audio_*``.
        ``audio_to_video_attn`` changes the visual stream and belongs to VIDEO;
        ``video_to_audio_attn`` changes the audio stream and belongs to AUDIO.
        Keys without an explicit audio marker default to VIDEO so existing
        video-only LoRAs retain normal behaviour.
        """
        lower = str(key).lower()
        clip_markers = (
            "lora_te", "text_encoder", "cond_stage_model", "text_model",
            "clip_l", "clip_g", ".clip.", "gemma", "qwen",
        )
        if any(marker in lower for marker in clip_markers):
            return "clip"
        if "audio_to_video_attn" in lower:
            return "video"
        if "video_to_audio_attn" in lower:
            return "audio"
        audio_markers = (
            "audio_attn", "audio_ff", "audio_norm", "audio_adaln",
            "audio_block", "audio_transformer", ".audio_", "_audio.",
        )
        if any(marker in lower for marker in audio_markers):
            return "audio"
        return "video"

    @classmethod
    def _partition_lora(cls, lora: Dict[str, Any]) -> Dict[str, Dict[str, Any]]:
        buckets: Dict[str, Dict[str, Any]] = {"video": {}, "audio": {}, "clip": {}}
        for key, tensor in (lora or {}).items():
            buckets[cls._key_family(key)][key] = tensor
        return buckets

    @classmethod
    def analyze_keys(cls, keys: Iterable[str]) -> Dict[str, Any]:
        counts = {"video": 0, "audio": 0, "clip": 0}
        for key in keys:
            counts[cls._key_family(str(key))] += 1
        if counts["audio"] and counts["video"]:
            kind = "A+V"
        elif counts["audio"]:
            kind = "AUDIO"
        elif counts["video"]:
            kind = "VIDEO"
        else:
            kind = "UNKNOWN"
        return {
            "kind": kind,
            "video_keys": counts["video"],
            "audio_keys": counts["audio"],
            "clip_keys": counts["clip"],
            "audio_supported": counts["audio"] > 0,
        }

    @staticmethod
    def _apply_model_bucket(model, bucket: Dict[str, Any], strength: float):
        if model is None or not bucket or abs(float(strength)) < 1e-12:
            return model
        import comfy.sd  # type: ignore
        patched, _ = comfy.sd.load_lora_for_models(
            model, None, bucket, float(strength), 0.0
        )
        return patched

    @staticmethod
    def _apply_clip_bucket(clip, bucket: Dict[str, Any], strength: float):
        if clip is None or not bucket or abs(float(strength)) < 1e-12:
            return clip
        import comfy.sd  # type: ignore
        _, patched = comfy.sd.load_lora_for_models(
            None, clip, bucket, 0.0, float(strength)
        )
        return patched

    @classmethod
    def _apply_slot(cls, model, clip, slot: Dict[str, Any]):
        if (
            not slot["enabled"]
            or slot["lora"] == "None"
            or not slot["lora"]
        ):
            return model, clip
        lora = cls._load_lora(slot["lora"])
        if not lora:
            return model, clip

        mode = slot["mode"]
        video_strength = slot["video_strength"]
        audio_strength = slot["audio_strength"]
        clip_strength = slot["clip_strength"]

        # Preserve the exact classic loader path when all strengths are equal.
        if (
            mode == "FULL"
            and abs(video_strength - audio_strength) < 1e-12
            and abs(video_strength - clip_strength) < 1e-12
        ):
            import comfy.sd  # type: ignore
            return comfy.sd.load_lora_for_models(
                model, clip, lora, float(video_strength), float(clip_strength)
            )

        buckets = cls._partition_lora(lora)
        current_model, current_clip = model, clip
        if mode in {"FULL", "VIDEO"}:
            current_model = cls._apply_model_bucket(
                current_model, buckets["video"], video_strength
            )
        if mode in {"FULL", "AUDIO"}:
            current_model = cls._apply_model_bucket(
                current_model, buckets["audio"], audio_strength
            )
        current_clip = cls._apply_clip_bucket(
            current_clip, buckets["clip"], clip_strength
        )
        return current_model, current_clip

    def apply_loras(self, model, clip, lora_stack_json, lora_catalog="None"):
        current_model, current_clip = model, clip
        for slot in self._parse_stack(lora_stack_json):
            current_model, current_clip = self._apply_slot(
                current_model, current_clip, slot
            )
        return current_model, current_clip


# Keep old workflow IDs loadable while the active v1.2 workflow uses the new ID.
class VelvetViceLoraStudio(VelvetVicePowerLoraAV):
    pass


class VelvetVicePreflightConsole:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "auto_check_on_load": ("BOOLEAN", {"default": True}),
                "check_ollama": ("BOOLEAN", {"default": True}),
                "check_nvenc": ("BOOLEAN", {"default": True}),
                "strict_report": ("BOOLEAN", {"default": False}),
            }
        }

    RETURN_TYPES = ()
    FUNCTION = "noop"
    CATEGORY = "VELVET VICE/LTX"
    DESCRIPTION = (
        "Interactive, non-blocking environment check. Use RUN PREFLIGHT before "
        "queueing to validate the reference image, core model files, VAE files, "
        "Ollama, FFmpeg, NVENC, CUDA, watermark and output directory."
    )

    def noop(self, auto_check_on_load, check_ollama, check_nvenc, strict_report):
        return ()


def _image_preview_metadata(images, frame_rate: Any) -> Dict[str, Any]:
    """Return authoritative BHWC geometry before the MP4 container is written."""
    shape = getattr(images, "shape", None)
    width = height = frames = 0
    try:
        dims = [int(value) for value in shape]
        if len(dims) >= 4:
            frames, height, width = dims[0], dims[-3], dims[-2]
        elif len(dims) == 3:
            height, width = dims[-3], dims[-2]
            frames = 1
    except Exception:
        pass
    ratio = (float(width) / float(height)) if width > 0 and height > 0 else 0.0
    orientation = "PORTRAIT" if ratio and ratio < 0.98 else "LANDSCAPE" if ratio > 1.02 else "SQUARE" if ratio else "UNKNOWN"
    return {
        "width": width,
        "height": height,
        "frames": frames,
        "fps": float(frame_rate or 0),
        "ratio": ratio,
        "orientation": orientation,
    }


class VelvetViceOutputStudio(VelvetViceLTXAutoVideoCombineV0113):
    CATEGORY = "VELVET VICE/LTX"
    DESCRIPTION = (
        "Velvet Vice Output Studio with authoritative tensor-ratio metadata, "
        "single NVENC/CPU encode, automatic last-frame PNG, live telemetry and "
        "a fully adaptive player frame."
    )

    def combine_video(self, **kwargs):
        unique_id = kwargs.get("unique_id")
        metadata = _image_preview_metadata(kwargs.get("images"), kwargs.get("frame_rate"))
        _safe_send(
            "velvet_vice.output_status",
            {
                "node": str(unique_id) if unique_id is not None else None,
                "stage": "ENCODING",
                "message": kwargs.get("filename_prefix", "video/VELVET_VICE_LTX23_FINAL"),
                "preview": metadata,
            },
        )
        try:
            result = super().combine_video(**kwargs)
        except Exception as exc:
            _safe_send(
                "velvet_vice.output_status",
                {
                    "node": str(unique_id) if unique_id is not None else None,
                    "stage": "ERROR",
                    "message": str(exc),
                    "preview": metadata,
                },
            )
            raise

        if isinstance(result, dict):
            result = dict(result)
            ui = dict(result.get("ui") or {})
            ui["velvet_vice_preview"] = [metadata]
            result["ui"] = ui

        _safe_send(
            "velvet_vice.output_status",
            {
                "node": str(unique_id) if unique_id is not None else None,
                "stage": "COMPLETE",
                "message": kwargs.get("filename_prefix", "video/VELVET_VICE_LTX23_FINAL"),
                "preview": metadata,
            },
        )
        return result
