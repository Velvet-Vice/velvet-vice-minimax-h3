from __future__ import annotations

from copy import deepcopy
import math
from typing import Any

from .ollama_release import VelvetViceOllamaReleaseBarrier
from .prompt_director import VelvetViceLTXPromptDirector
from ..services.prompt_pipeline import canonical_ending_mode
from ..services.memory_lifecycle import (
    log_memory_snapshot,
    start_render_memory_monitor,
)


MINIMAX_H3_AUTO = "AUTO"
MINIMAX_H3_DIFFUSION = "minimax_h3_fl2va_pruned_int8_convrot.safetensors"
MINIMAX_H3_TEXT_ENCODER = "qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors"
MINIMAX_H3_VIDEO_VAE = "minimax_h3_video_vae_fp16.safetensors"
MINIMAX_H3_AUDIO_VAE = "minimax_h3_audio_vae_fp32.safetensors"
MINIMAX_H3_TURBO_LORA = (
    "minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors"
)

MINIMAX_H3_MODELS = (
    ("diffusion_models", MINIMAX_H3_DIFFUSION),
    ("text_encoders", MINIMAX_H3_TEXT_ENCODER),
    ("vae", MINIMAX_H3_VIDEO_VAE),
    ("vae", MINIMAX_H3_AUDIO_VAE),
)

MINIMAX_H3_CORE_NODES = (
    "MiniMaxH3ImageToVideo",
    "ComfyMathExpression",
    "VAEDecodeAudio",
    "CreateVideo",
)


class VelvetViceMiniMaxH3PromptDirector(VelvetViceLTXPromptDirector):
    @classmethod
    def INPUT_TYPES(cls):
        inputs = deepcopy(super().INPUT_TYPES())
        optional = {}
        for name, spec in inputs["optional"].items():
            if name == "ltx_prompt_profile":
                optional["prompt_profile"] = (("MiniMax H3",), {"default": "MiniMax H3"})
            else:
                optional[name] = spec
        inputs["optional"] = optional
        inputs["optional"]["duration_seconds"] = (
            "FLOAT",
            {
                "default": 5.0,
                "min": 1.0,
                "max": 149.5,
                "step": 0.1,
            },
        )
        inputs["optional"]["ending_mode_override"] = (
            "STRING",
            {"forceInput": True},
        )
        inputs["optional"]["audio_enabled"] = (
            "BOOLEAN",
            {"default": True, "forceInput": True},
        )
        return inputs

    def direct(
        self,
        ending_mode_override=None,
        prompt_profile="MiniMax H3",
        audio_enabled=True,
        **kwargs,
    ):
        # H3 Director owns Ending Mode. Older/stale ComfyUI graph schemas can
        # transiently feed another scalar (for example FPS=24) into the linked
        # optional socket after a node schema update. Never let that corrupt the
        # prompt pipeline: accept only values understood by Ending Control and
        # otherwise keep/fall back to AUTO.
        current = kwargs.get("ending_mode", "AUTO")
        try:
            canonical_ending_mode(current)
        except ValueError:
            current = "AUTO"
        override = ending_mode_override
        if override not in (None, ""):
            try:
                canonical_ending_mode(str(override))
            except ValueError:
                print(
                    "WARNING: [VELVET VICE] Ignoring invalid H3 ending-mode "
                    f"override {override!r}; using {current!r}."
                )
            else:
                current = str(override)
        kwargs["ending_mode"] = current
        kwargs["ltx_prompt_profile"] = "MiniMax H3"
        kwargs["audio_enabled"] = bool(audio_enabled)
        return super().direct(**kwargs)

    CATEGORY = "VELVET VICE/MiniMax H3"
    DESCRIPTION = (
        "Autonomous source-image analysis and duration-aware prompt planning "
        "for the local MiniMax H3 FL2VA image-to-video workflow."
    )


class VelvetViceMiniMaxH3FinalPromptPreview:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "prompt": ("STRING", {"forceInput": True}),
            }
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("prompt",)
    FUNCTION = "preview"
    CATEGORY = "VELVET VICE/MiniMax H3"
    DESCRIPTION = (
        "Displays and forwards the exact prompt delivered to the MiniMax H3 "
        "image-to-video subgraph."
    )

    @classmethod
    def IS_CHANGED(cls, **kwargs):
        return float("NaN")

    def preview(self, prompt):
        if not isinstance(prompt, str):
            raise TypeError("The final MiniMax H3 prompt must be a string.")
        word_count = len(prompt.split())
        character_count = len(prompt)
        stats = (
            f"{word_count} words | {character_count} characters | "
            "exact MiniMax H3 input"
        )
        print(
            "[VELVET VICE] MiniMax H3 prompt ready: "
            f"{word_count} words, {character_count} characters."
        )
        return {
            "ui": {
                "final_prompt": [prompt],
                "stats": [stats],
            },
            "result": (prompt,),
        }


class VelvetViceMiniMaxH3OllamaReleaseBarrier(
    VelvetViceOllamaReleaseBarrier
):
    CATEGORY = "VELVET VICE/MiniMax H3"
    DESCRIPTION = (
        "Releases the Ollama vision model before MiniMax H3 loads its "
        "diffusion model, Qwen3-VL encoder and VAEs."
    )


def _model_names(category: str) -> list[str]:
    try:
        import folder_paths
    except ImportError:
        return []
    try:
        return list(folder_paths.get_filename_list(category))
    except (KeyError, TypeError, ValueError):
        return []


def _model_catalog(
    *categories: str,
    extension: str | None = None,
) -> list[str]:
    """Return a stable, duplicate-free catalog across ComfyUI aliases.

    Current ComfyUI uses ``diffusion_models``/``text_encoders`` while older
    releases and ComfyUI-GGUF can expose the same folders as ``unet``/``clip``
    plus the filtered ``unet_gguf``/``clip_gguf`` keys.  Reading every known
    alias keeps the selectors complete regardless of load order or version.
    """
    wanted_extension = str(extension or "").lower()
    catalog: list[str] = []
    seen: set[str] = set()
    for category in categories:
        for name in _model_names(category):
            normalized = _normalized_model_name(name)
            if wanted_extension and not normalized.endswith(wanted_extension):
                continue
            if normalized in seen:
                continue
            seen.add(normalized)
            catalog.append(str(name))
    return catalog


def _normalized_model_name(name: str) -> str:
    return str(name).replace("\\", "/").strip().lower()


def _model_basename(name: str) -> str:
    return _normalized_model_name(name).rsplit("/", 1)[-1]


def _best_basename_match(names: list[str], basename: str) -> str | None:
    wanted = basename.lower()
    matches = [name for name in names if _model_basename(name) == wanted]
    if not matches:
        return None
    # Prefer a root-level file, then the shallowest/shortest path.
    return sorted(
        matches,
        key=lambda value: (
            _normalized_model_name(value).count("/"),
            len(_normalized_model_name(value)),
            _normalized_model_name(value),
        ),
    )[0]


def _is_h3_i2v_diffusion_candidate(name: str) -> bool:
    base = _model_basename(name)
    if not base.endswith(".safetensors"):
        return False
    if "ref2" in base or "ref2va" in base:
        return False
    return (
        "minimax_h3" in base
        or "minimax-h3" in base
        or "h3eros" in base
        or ("h3" in base and ("fl2v" in base or "fl2va" in base))
    )


def _is_h3_turbo_lora_candidate(name: str) -> bool:
    base = _model_basename(name)
    if not base.endswith(".safetensors"):
        return False
    return (
        base == MINIMAX_H3_TURBO_LORA.lower()
        or ("h3" in base and ("turbo" in base or "distill" in base or "8step" in base))
        or ("minimax_h3" in base and ("lora" in base or "turbo" in base))
    )


def _safe_image_hw(image) -> tuple[int, int]:
    shape = getattr(image, "shape", None)
    if shape is None:
        raise RuntimeError("MiniMax H3 resolution planner expected an IMAGE tensor.")
    dims = [int(v) for v in shape]
    if len(dims) >= 4:
        return dims[-2], dims[-3]
    if len(dims) == 3:
        return dims[-2], dims[-3]
    raise RuntimeError("MiniMax H3 resolution planner could not read image geometry.")


def _round_to_grid(value: float, grid: int = 32, minimum: int | None = None) -> int:
    minimum = grid if minimum is None else max(int(minimum), grid)
    rounded = int(round(float(value) / float(grid)) * grid)
    return max(minimum, rounded)


def _orientation(width: int, height: int) -> str:
    if width > height:
        return "Landscape"
    if height > width:
        return "Portrait"
    return "Square"


def _format_ratio(format_mode: str, source_ratio: float) -> float:
    mode = str(format_mode or "AUTO").upper()
    if mode == "16:9":
        return 16.0 / 9.0
    if mode == "9:16":
        return 9.0 / 16.0
    if mode == "1:1":
        return 1.0
    return max(0.05, float(source_ratio))


def _status_ui_result(*result, status: str):
    return {"ui": {"status": [status]}, "result": result}


def _resolve_model_name(
    category: str,
    preferred_basename: str,
    selected: str = MINIMAX_H3_AUTO,
    *,
    allow_h3_diffusion_fallback: bool = False,
    optional: bool = False,
) -> str | None:
    names = _model_names(category)
    selected = str(selected or MINIMAX_H3_AUTO)

    if selected != MINIMAX_H3_AUTO:
        selected_normalized = _normalized_model_name(selected)
        for name in names:
            if _normalized_model_name(name) == selected_normalized:
                return name
        moved_match = _best_basename_match(names, _model_basename(selected))
        if moved_match:
            return moved_match
        if optional:
            return None
        raise RuntimeError(
            f"[VELVET VICE] MiniMax H3 model selection is unavailable: "
            f"{category}/{selected}"
        )

    preferred = _best_basename_match(names, preferred_basename)
    if preferred:
        return preferred

    if allow_h3_diffusion_fallback:
        candidates = [name for name in names if _is_h3_i2v_diffusion_candidate(name)]
        if candidates:
            return sorted(candidates, key=_normalized_model_name)[0]

    if optional:
        return None
    raise RuntimeError(
        f"[VELVET VICE] MiniMax H3 required model is missing: "
        f"{category}/{preferred_basename}. Subfolders are supported."
    )


def _auto_combo(category: str) -> tuple[str, ...]:
    names = _model_names(category)
    return tuple([MINIMAX_H3_AUTO, *names])


def _text_encoder_catalog() -> list[str]:
    return _model_catalog("text_encoders", "clip", "clip_gguf")


def _resolve_text_encoder_name(
    selected: str = MINIMAX_H3_AUTO,
    *,
    optional: bool = False,
) -> str | None:
    names = _text_encoder_catalog()
    selected = str(selected or MINIMAX_H3_AUTO)
    if selected != MINIMAX_H3_AUTO:
        normalized = _normalized_model_name(selected)
        for name in names:
            if _normalized_model_name(name) == normalized:
                return name
        moved = _best_basename_match(names, _model_basename(selected))
        if moved:
            return moved
    else:
        preferred = _best_basename_match(names, MINIMAX_H3_TEXT_ENCODER)
        if preferred:
            return preferred
        candidates = [
            name for name in names
            if any(
                token in _normalized_model_name(name)
                for token in ("minimax", "h3", "qwen3vl", "qwen3-vl")
            )
        ]
        if candidates:
            return sorted(candidates, key=_normalized_model_name)[0]
    if optional:
        return None
    raise RuntimeError(
        "[VELVET VICE] MiniMax H3 Qwen text encoder is unavailable. "
        "Native and GGUF files in text_encoders/clip subfolders are supported."
    )


def _missing_model_files() -> list[str]:
    checks = (
        (
            "diffusion_models",
            MINIMAX_H3_DIFFUSION,
            True,
        ),
        ("vae", MINIMAX_H3_VIDEO_VAE, False),
        ("vae", MINIMAX_H3_AUDIO_VAE, False),
    )
    missing = []
    try:
        _resolve_text_encoder_name()
    except RuntimeError:
        missing.append(f"text_encoders/{MINIMAX_H3_TEXT_ENCODER} (native or GGUF)")
    for category, filename, diffusion_fallback in checks:
        try:
            _resolve_model_name(
                category,
                filename,
                allow_h3_diffusion_fallback=diffusion_fallback,
            )
        except RuntimeError:
            missing.append(f"{category}/{filename}")
    return missing


def _missing_core_nodes() -> list[str]:
    try:
        import nodes as comfy_nodes
    except ImportError:
        return ["ComfyUI node registry is unavailable"]
    registry: dict[str, Any] = getattr(
        comfy_nodes, "NODE_CLASS_MAPPINGS", {}
    )
    return [name for name in MINIMAX_H3_CORE_NODES if name not in registry]


class VelvetViceMiniMaxH3UNETLoader:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "unet_name": (
                    _auto_combo("diffusion_models"),
                    {"default": MINIMAX_H3_AUTO},
                ),
                "weight_dtype": (
                    [
                        "default",
                        "fp8_e4m3fn",
                        "fp8_e4m3fn_fast",
                        "fp8_e5m2",
                    ],
                    {"default": "default", "advanced": True},
                ),
            }
        }

    RETURN_TYPES = ("MODEL",)
    FUNCTION = "load_unet"
    CATEGORY = "VELVET VICE/MiniMax H3"
    DESCRIPTION = (
        "Loads the MiniMax H3 I2V diffusion model. AUTO resolves the "
        "official filename in any subfolder and can fall back to a local "
        "MiniMax H3 FL2V-compatible diffusion model."
    )

    def load_unet(self, unet_name, weight_dtype):
        resolved = _resolve_model_name(
            "diffusion_models",
            MINIMAX_H3_DIFFUSION,
            unet_name,
            allow_h3_diffusion_fallback=True,
        )
        import nodes as comfy_nodes

        print(f"[VELVET VICE] MiniMax H3 diffusion resolved: {resolved}")
        return comfy_nodes.UNETLoader().load_unet(resolved, weight_dtype)


class VelvetViceMiniMaxH3CLIPLoader:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "clip_name": (
                    tuple([MINIMAX_H3_AUTO, *_text_encoder_catalog()]),
                    {"default": MINIMAX_H3_AUTO},
                ),
                "device": (
                    ["default", "cpu"],
                    {"default": "default", "advanced": True},
                ),
            }
        }

    RETURN_TYPES = ("CLIP",)
    FUNCTION = "load_clip"
    CATEGORY = "VELVET VICE/MiniMax H3"
    DESCRIPTION = (
        "Loads the MiniMax H3 Qwen3-VL encoder from native safetensors or "
        "GGUF. AUTO matches compatible filenames across current and legacy "
        "ComfyUI folder aliases, including subfolders."
    )

    def load_clip(self, clip_name, device):
        resolved = _resolve_text_encoder_name(clip_name)
        import nodes as comfy_nodes

        print(f"[VELVET VICE] MiniMax H3 text encoder resolved: {resolved}")
        if _normalized_model_name(resolved).endswith(".gguf"):
            registry = getattr(comfy_nodes, "NODE_CLASS_MAPPINGS", {})
            loader_cls = registry.get("CLIPLoaderGGUF")
            if loader_cls is None:
                raise RuntimeError(
                    "[VELVET VICE] A GGUF text encoder is selected, but "
                    "ComfyUI-GGUF / CLIPLoaderGGUF is not installed."
                )
            loader = loader_cls()
            function = getattr(loader, getattr(loader_cls, "FUNCTION", "load_clip"))
            try:
                return function(resolved, type="minimax")
            except TypeError:
                return function(resolved, "minimax")
        return comfy_nodes.CLIPLoader().load_clip(
            resolved,
            type="minimax",
            device=device,
        )


class VelvetViceMiniMaxH3VAELoader:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "vae_name": (
                    _auto_combo("vae"),
                    {"default": MINIMAX_H3_AUTO},
                ),
                "vae_role": (
                    ["video", "audio"],
                    {"default": "video"},
                ),
            }
        }

    RETURN_TYPES = ("VAE",)
    FUNCTION = "load_vae"
    CATEGORY = "VELVET VICE/MiniMax H3"
    DESCRIPTION = (
        "Loads a required MiniMax H3 VAE. AUTO resolves the official "
        "video/audio VAE by basename even when it is stored in a subfolder."
    )

    def load_vae(self, vae_name, vae_role):
        preferred = (
            MINIMAX_H3_AUDIO_VAE
            if vae_role == "audio"
            else MINIMAX_H3_VIDEO_VAE
        )
        resolved = _resolve_model_name("vae", preferred, vae_name)
        import nodes as comfy_nodes

        print(
            f"[VELVET VICE] MiniMax H3 {vae_role} VAE resolved: "
            f"{resolved}"
        )
        return comfy_nodes.VAELoader().load_vae(resolved)


class VelvetViceMiniMaxH3OptionalTurboLora:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "model": ("MODEL",),
                "lora_name": (
                    _auto_combo("loras"),
                    {"default": MINIMAX_H3_AUTO},
                ),
                "strength_model": (
                    "FLOAT",
                    {
                        "default": 1.0,
                        "min": -100.0,
                        "max": 100.0,
                        "step": 0.01,
                    },
                ),
                "enabled": ("BOOLEAN", {"default": False}),
            }
        }

    RETURN_TYPES = ("MODEL",)
    FUNCTION = "load_optional_lora"
    CATEGORY = "VELVET VICE/MiniMax H3"
    DESCRIPTION = (
        "Optional MiniMax H3 Turbo LoRA loader. AUTO applies the official "
        "Turbo LoRA when present in any LoRA subfolder; otherwise it passes "
        "the model through unchanged so Turbo OFF remains truly optional."
    )

    def load_optional_lora(
        self,
        model,
        lora_name,
        strength_model,
        enabled=False,
    ):
        if not bool(enabled) or float(strength_model) == 0.0:
            return (model,)

        resolved = _resolve_model_name(
            "loras",
            MINIMAX_H3_TURBO_LORA,
            lora_name,
        )

        import nodes as comfy_nodes

        print(f"[VELVET VICE] MiniMax H3 Turbo LoRA resolved: {resolved}")
        return comfy_nodes.LoraLoaderModelOnly().load_lora_model_only(
            model,
            resolved,
            strength_model,
        )


class VelvetViceMiniMaxH3ResolutionPlanner:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": ("IMAGE",),
                "format_mode": (
                    ["AUTO", "16:9", "9:16", "1:1", "CUSTOM"],
                    {"default": "AUTO"},
                ),
                "resolution_preset": (
                    ["TEST", "BALANCED", "QUALITY", "CUSTOM"],
                    {"default": "BALANCED"},
                ),
                "rotate_format": ("BOOLEAN", {"default": False}),
                "custom_width": (
                    "INT",
                    {"default": 1344, "min": 256, "max": 4096, "step": 32},
                ),
                "custom_height": (
                    "INT",
                    {"default": 768, "min": 256, "max": 4096, "step": 32},
                ),
                "custom_megapixels": (
                    "FLOAT",
                    {"default": 0.4, "min": 0.1, "max": 4.0, "step": 0.1},
                ),
            },
            "optional": {
                "last_frame": ("IMAGE",),
            },
        }

    RETURN_TYPES = ("INT", "INT", "STRING", "STRING")
    RETURN_NAMES = ("width", "height", "status", "aspect_label")
    FUNCTION = "plan"
    CATEGORY = "VELVET VICE/MiniMax H3"
    DESCRIPTION = (
        "Simple MiniMax H3 resolution planner with AUTO image-format "
        "detection, H3-safe rounding and optional end-frame ratio check."
    )

    def plan(
        self,
        image,
        format_mode,
        resolution_preset,
        rotate_format=False,
        custom_width=1344,
        custom_height=768,
        custom_megapixels=0.4,
        last_frame=None,
    ):
        source_width, source_height = _safe_image_hw(image)
        source_ratio = float(source_width) / float(max(1, source_height))
        chosen_format = str(format_mode or "AUTO").upper()
        chosen_preset = str(resolution_preset or "BALANCED").upper()

        if chosen_format == "CUSTOM":
            width = _round_to_grid(custom_width)
            height = _round_to_grid(custom_height)
            if rotate_format:
                width, height = height, width
        else:
            ratio = _format_ratio(chosen_format, source_ratio)
            if rotate_format:
                ratio = 1.0 / max(ratio, 1e-6)
            mp_map = {"TEST": 0.4, "BALANCED": 0.7, "QUALITY": 1.0}
            target_mp = float(custom_megapixels) if chosen_preset == "CUSTOM" else mp_map.get(chosen_preset, 0.7)
            area = max(100000.0, target_mp * 1_000_000.0)
            raw_width = math.sqrt(area * ratio)
            raw_height = raw_width / max(ratio, 1e-6)
            width = _round_to_grid(raw_width)
            height = _round_to_grid(raw_height)
            if chosen_format == "AUTO":
                source_landscape = source_width >= source_height
                target_landscape = width >= height
                if source_landscape != target_landscape:
                    width, height = height, width

        aspect_label = f"{width}:{height}"
        lines = [
            f"Source: {source_width} × {source_height} · {_orientation(source_width, source_height)}",
            f"Render: {width} × {height} · {_orientation(width, height)}",
        ]
        if chosen_format == "AUTO":
            lines.append("Format: AUTO — source aspect ratio preserved")
        elif chosen_format == "CUSTOM":
            lines.append("Format: CUSTOM — manual width/height")
        else:
            lines.append(f"Format: {chosen_format}")
        lines.append(f"Preset: {chosen_preset}")

        if last_frame is not None:
            end_width, end_height = _safe_image_hw(last_frame)
            end_ratio = float(end_width) / float(max(1, end_height))
            mismatch = abs(end_ratio - source_ratio) / max(source_ratio, 1e-6)
            if mismatch > 0.02:
                lines.append(
                    f"WARNING: End frame {end_width} × {end_height} has a different aspect ratio."
                )
            else:
                lines.append(
                    f"End frame: {end_width} × {end_height} · aspect ratio matches."
                )
        else:
            lines.append("End frame: not connected")

        status = " | ".join(lines)
        print(f"[VELVET VICE] MiniMax H3 resolution planned: {status}")
        return _status_ui_result(width, height, status, aspect_label, status=status)


class VelvetViceMiniMaxH3TurboDirector:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "model": ("MODEL",),
                "turbo_enabled": ("BOOLEAN", {"default": False}),
                "turbo_lora_name": (
                    _auto_combo("loras"),
                    {"default": MINIMAX_H3_AUTO},
                ),
                "model_strength": (
                    "FLOAT",
                    {
                        "default": 1.0,
                        "min": -4.0,
                        "max": 4.0,
                        "step": 0.01,
                    },
                ),
                "base_steps": (
                    "INT",
                    {"default": 20, "min": 1, "max": 80, "step": 1},
                ),
                "turbo_steps": (
                    "INT",
                    {"default": 8, "min": 1, "max": 80, "step": 1},
                ),
                "strict_h3_compatibility": ("BOOLEAN", {"default": True}),
                "bypass_on_missing": ("BOOLEAN", {"default": True}),
            },
            "optional": {
                "turbo_config": ("VELVET_VICE_H3_TURBO_CONFIG",),
            },
        }

    RETURN_TYPES = ("MODEL", "INT", "STRING", "BOOLEAN")
    RETURN_NAMES = ("model", "steps", "status", "turbo_active")
    FUNCTION = "configure"
    CATEGORY = "VELVET VICE/MiniMax H3"
    DESCRIPTION = (
        "Dedicated MiniMax H3 Turbo/Distilled LoRA module. Turbo OFF keeps "
        "the base model at 20 steps. Turbo ON tries to apply a compatible "
        "H3 Turbo/Distilled LoRA and switches to the fast step count. Missing "
        "or incompatible files automatically bypass back to the base model."
    )

    def configure(
        self,
        model,
        turbo_enabled=False,
        turbo_lora_name=MINIMAX_H3_AUTO,
        model_strength=1.0,
        base_steps=20,
        turbo_steps=8,
        strict_h3_compatibility=True,
        bypass_on_missing=True,
        turbo_config=None,
    ):
        config = dict(turbo_config or {})
        if config:
            turbo_lora_name = (
                config.get("resolved_lora")
                or config.get("requested_lora")
                or turbo_lora_name
            )
            model_strength = config.get("model_strength", model_strength)
            base_steps = config.get("base_steps", base_steps)
            turbo_steps = config.get("turbo_steps", turbo_steps)
            strict_h3_compatibility = config.get(
                "strict_h3_compatibility", strict_h3_compatibility
            )
            bypass_on_missing = config.get("bypass_on_missing", bypass_on_missing)
        base_steps = max(1, int(base_steps))
        turbo_steps = max(1, int(turbo_steps))
        if not bool(turbo_enabled):
            status = f"Turbo OFF | Base model active | Steps: {base_steps}"
            return _status_ui_result(model, base_steps, status, False, status=status)

        resolved = _resolve_model_name(
            "loras",
            MINIMAX_H3_TURBO_LORA,
            turbo_lora_name,
            optional=True,
        )
        if not resolved:
            if bypass_on_missing:
                status = (
                    "Turbo ON requested | Turbo LoRA not found | "
                    f"automatic bypass to Base model | Steps: {base_steps}"
                )
                print(f"WARNING: [VELVET VICE] {status}")
                return _status_ui_result(model, base_steps, status, False, status=status)
            raise RuntimeError(
                "[VELVET VICE] MiniMax H3 Turbo LoRA is missing and bypass is disabled."
            )

        compatible = _is_h3_turbo_lora_candidate(resolved)
        if bool(strict_h3_compatibility) and not compatible:
            status = (
                f"Turbo LoRA incompatible: {resolved} | "
                f"automatic bypass to Base model | Steps: {base_steps}"
            )
            print(f"WARNING: [VELVET VICE] {status}")
            return _status_ui_result(model, base_steps, status, False, status=status)

        import nodes as comfy_nodes

        print(f"[VELVET VICE] MiniMax H3 Turbo LoRA resolved: {resolved}")
        patched_model = comfy_nodes.LoraLoaderModelOnly().load_lora_model_only(
            model,
            resolved,
            float(model_strength),
        )[0]
        status = (
            f"Turbo ON | File present: yes | compatible: {'yes' if compatible else 'not checked'} | "
            f"LoRA: {resolved} | Strength: {float(model_strength):.2f} | Steps: {turbo_steps}"
        )
        return _status_ui_result(patched_model, turbo_steps, status, True, status=status)


class VelvetViceMiniMaxH3SystemCheck:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "prompt": ("STRING", {"forceInput": True}),
                "strict_preflight": ("BOOLEAN", {"default": True}),
                "ram_abort_percent": (
                    "FLOAT",
                    {
                        "default": 94.0,
                        "min": 70.0,
                        "max": 99.0,
                        "step": 0.5,
                    },
                ),
                "min_available_ram_gib": (
                    "FLOAT",
                    {
                        "default": 12.0,
                        "min": 4.0,
                        "max": 128.0,
                        "step": 1.0,
                    },
                ),
                "monitor_interval_seconds": (
                    "FLOAT",
                    {
                        "default": 1.0,
                        "min": 0.5,
                        "max": 10.0,
                        "step": 0.5,
                    },
                ),
                "warning_ram_percent": (
                    "FLOAT",
                    {
                        "default": 92.0,
                        "min": 60.0,
                        "max": 98.0,
                        "step": 0.5,
                    },
                ),
                "critical_ram_percent": (
                    "FLOAT",
                    {
                        "default": 97.0,
                        "min": 70.0,
                        "max": 99.5,
                        "step": 0.5,
                    },
                ),
            },
            "optional": {
                "model_config": ("VELVET_VICE_H3_MODEL_CONFIG",),
            },
        }

    RETURN_TYPES = (
        "STRING",
        "VELVET_VICE_MEMORY_POLICY",
        "STRING",
    )
    RETURN_NAMES = ("prompt", "memory_policy", "status")
    FUNCTION = "check"
    CATEGORY = "VELVET VICE/MiniMax H3"
    DESCRIPTION = (
        "Checks current RAM, the local MiniMax H3 model files and required "
        "ComfyUI core nodes before rendering starts."
    )

    @classmethod
    def IS_CHANGED(cls, **kwargs):
        return float("NaN")

    def check(
        self,
        prompt,
        strict_preflight,
        ram_abort_percent,
        min_available_ram_gib,
        monitor_interval_seconds,
        warning_ram_percent,
        critical_ram_percent,
        model_config=None,
    ):
        if critical_ram_percent <= warning_ram_percent:
            raise ValueError(
                "critical_ram_percent must be higher than "
                "warning_ram_percent."
            )

        snapshot = log_memory_snapshot("pre-MiniMax H3 system check")
        issues = []
        if (
            snapshot.ram_percent is not None
            and snapshot.ram_percent >= float(ram_abort_percent)
        ):
            issues.append(f"RAM is already {snapshot.ram_percent:.1f}%")
        if (
            snapshot.ram_available_gib is not None
            and snapshot.ram_available_gib
            < float(min_available_ram_gib)
        ):
            issues.append(
                f"only {snapshot.ram_available_gib:.1f} GiB RAM is available"
            )

        if isinstance(model_config, dict):
            if not bool(model_config.get("ready")):
                requested = model_config.get("requested_backend") or "UNKNOWN"
                active = model_config.get("active_backend") or "NONE"
                issues.append(
                    f"H3 System Hub is not ready (requested {requested}, active {active})"
                )
            elif model_config.get("fallback_active"):
                print(
                    "WARNING: [VELVET VICE] MiniMax H3 preflight is using a "
                    f"visible backend fallback: {model_config.get('requested_backend')} -> "
                    f"{model_config.get('active_backend')}"
                )
        else:
            missing_models = _missing_model_files()
            if missing_models:
                issues.append("missing model file(s): " + ", ".join(missing_models))
        missing_nodes = _missing_core_nodes()
        if missing_nodes:
            issues.append(
                "update ComfyUI; missing core node(s): "
                + ", ".join(missing_nodes)
            )

        if issues and strict_preflight:
            raise RuntimeError(
                "[VELVET VICE] MiniMax H3 preflight stopped rendering: "
                + "; ".join(issues)
            )

        if issues:
            status = "MiniMax H3 preflight warning: " + "; ".join(issues)
            print(f"WARNING: [VELVET VICE] {status}")
        else:
            status = "MiniMax H3 preflight passed; " + snapshot.format()
            print(f"[VELVET VICE] {status}")

        policy = {
            "schema": "VELVET_VICE_MEMORY_POLICY",
            "monitor_interval_seconds": float(monitor_interval_seconds),
            "warning_ram_percent": float(warning_ram_percent),
            "critical_ram_percent": float(critical_ram_percent),
            "startup_flags_ok": not issues,
            "preflight_status": status,
        }
        start_render_memory_monitor(
            monitor_interval_seconds,
            warning_ram_percent,
            critical_ram_percent,
        )
        return (prompt, policy, status)
