from __future__ import annotations

from typing import Any, Dict, Iterable, Tuple

ModelEntry = Tuple[str, str, Tuple[str, ...], bool]

MODEL_PROFILES: Dict[str, Dict[str, Any]] = {
    "2.3": {
        "label": "LTX 2.3",
        "models": (
            ("Base model", "10Eros_v1_bf16.safetensors", ("diffusion_models", "unet", "checkpoints"), True),
            ("Text encoder", "gemma-3-12b-it-heretic-v2_fp8_e4m3fn.safetensors", ("text_encoders", "clip"), True),
            ("Text projection", "ltx-2.3_text_projection_bf16.safetensors", ("text_encoders", "clip"), True),
            ("Full video VAE", "LTX23_video_vae_bf16.safetensors", ("vae",), True),
            ("Audio VAE", "LTX23_audio_vae_bf16.safetensors", ("vae", "audio_encoders"), True),
            ("Spatial upscaler", "ltx-2.3-spatial-upscaler-x2-1.1.safetensors", ("latent_upscale_models", "upscale_models"), True),
            ("Preview VAE", "taeltx2_3.safetensors", ("vae",), False),
        ),
    },
    "2.5": {
        "label": "LTX 2.5",
        "models": (
            ("Base model", "10Eros_v1.5_bf16.safetensors", ("diffusion_models", "unet", "checkpoints"), True),
            ("Text encoder + projection", "LTX 2.5/gemma4-12b-with-proj-ltx-2.5-comfy-int8-convrot.safetensors", ("text_encoders", "clip"), True),
            ("Prompt enhancer", "LTX 2.5/gemma4_e2b_it_bf16.safetensors", ("text_encoders", "clip"), True),
            ("Full video VAE", "LTX 2.5/ltx-2.5-video-vae-bf16.safetensors", ("vae",), True),
            ("Audio VAE", "LTX 2.5/ltx-2.5-audio-vae-bf16.safetensors", ("vae", "audio_encoders"), True),
            ("Spatial upscaler", "ltx-2.5-latent-spatial-upscaler-x2-bf16-1.0.safetensors", ("latent_upscale_models", "upscale_models"), True),
            ("Turbo distilled LoRA", "LTX 2.5/ltx25_turbo_distill_r256.safetensors", ("loras",), False),
            ("Preview VAE (2.3 fallback)", "taeltx2_3.safetensors", ("vae",), False),
        ),
    },
}


def normalize_ltx_version(value: Any) -> str:
    text = str(value or "2.3").strip().lower().replace("ltx", "").replace("v", "")
    text = text.strip(" -_")
    if text in MODEL_PROFILES:
        return text
    raise ValueError(f"Unsupported LTX version: {value!r}. Expected 2.3 or 2.5.")


def model_profile(version: Any) -> Dict[str, Any]:
    return MODEL_PROFILES[normalize_ltx_version(version)]


def required_models(version: Any) -> Iterable[ModelEntry]:
    return model_profile(version)["models"]
