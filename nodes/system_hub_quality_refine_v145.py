from __future__ import annotations

from copy import deepcopy

from .minimax_h3_control import VelvetViceMiniMaxH3SystemHub as _BaseSystemHub

H3_QUALITY_REFINE_MODES = ("LIGHT", "HIGH", "CUSTOM")


class VelvetViceMiniMaxH3SystemHub(_BaseSystemHub):
    """v1.4.5 System Hub extension with integrated optional Quality Refine."""

    @classmethod
    def INPUT_TYPES(cls):
        base = deepcopy(_BaseSystemHub.INPUT_TYPES())
        required = dict(base.get("required", {}))
        merged = {}
        for name, spec in required.items():
            merged[name] = spec
            if name == "turbo_steps":
                merged["quality_refine_enabled"] = ("BOOLEAN", {"default": False})
                merged["quality_refine_mode"] = (H3_QUALITY_REFINE_MODES, {"default": "LIGHT"})
                merged["quality_refine_custom_steps"] = (
                    "INT", {"default": 8, "min": 1, "max": 16, "step": 1}
                )
                merged["quality_refine_custom_denoise"] = (
                    "FLOAT", {"default": 0.18, "min": 0.01, "max": 0.35, "step": 0.01}
                )
                merged["quality_refine_preserve_audio"] = ("BOOLEAN", {"default": True})
                merged["quality_refine_reencode_enabled"] = ("BOOLEAN", {"default": False})
                merged["quality_refine_reencode_scale"] = (
                    "FLOAT", {"default": 1.25, "min": 1.0, "max": 2.0, "step": 0.05}
                )
        base["required"] = merged
        return base

    RETURN_TYPES = tuple(_BaseSystemHub.RETURN_TYPES) + (
        "BOOLEAN", "INT", "FLOAT", "BOOLEAN", "BOOLEAN", "FLOAT", "STRING"
    )
    RETURN_NAMES = tuple(_BaseSystemHub.RETURN_NAMES) + (
        "refine_enabled",
        "refine_steps",
        "refine_denoise",
        "refine_preserve_audio",
        "refine_reencode_enabled",
        "refine_reencode_scale",
        "refine_status",
    )
    DESCRIPTION = (
        "Central MiniMax H3 technical hub with Native/GGUF, VAE, Turbo and "
        "optional lazy-bypassed Quality Refine / second sampler controls."
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
        turbo_lora,
        turbo_model_strength,
        base_steps,
        turbo_steps,
        quality_refine_enabled=False,
        quality_refine_mode="LIGHT",
        quality_refine_custom_steps=8,
        quality_refine_custom_denoise=0.18,
        quality_refine_preserve_audio=True,
        quality_refine_reencode_enabled=False,
        quality_refine_reencode_scale=1.25,
        strict_turbo_compatibility=True,
        turbo_bypass_on_missing=True,
        native_weight_dtype="default",
        text_encoder_device="default",
        fallback_if_missing=True,
        unload_on_backend_change=True,
    ):
        base = super().configure(
            model_backend=model_backend,
            auto_preference=auto_preference,
            native_model=native_model,
            gguf_model=gguf_model,
            text_encoder=text_encoder,
            video_vae=video_vae,
            audio_vae=audio_vae,
            turbo_lora=turbo_lora,
            turbo_model_strength=turbo_model_strength,
            base_steps=base_steps,
            turbo_steps=turbo_steps,
            strict_turbo_compatibility=strict_turbo_compatibility,
            turbo_bypass_on_missing=turbo_bypass_on_missing,
            native_weight_dtype=native_weight_dtype,
            text_encoder_device=text_encoder_device,
            fallback_if_missing=fallback_if_missing,
            unload_on_backend_change=unload_on_backend_change,
        )
        if isinstance(base, dict) and "result" in base:
            results = tuple(base["result"])
            ui = dict(base.get("ui") or {})
        else:
            results = tuple(base)
            ui = {}

        enabled = bool(quality_refine_enabled)
        mode = str(quality_refine_mode or "LIGHT").upper()
        steps = max(1, min(16, int(quality_refine_custom_steps)))
        if not enabled:
            denoise = 0.0
            status = "QUALITY REFINE OFF | only the primary H3 sampler runs"
        elif mode == "LIGHT":
            denoise = 0.12
            status = f"QUALITY REFINE ON · LIGHT | pass 2: {steps} steps | denoise 0.12"
        elif mode == "HIGH":
            denoise = 0.20
            status = f"QUALITY REFINE ON · HIGH | pass 2: {steps} steps | denoise 0.20"
        else:
            mode = "CUSTOM"
            denoise = max(0.01, min(0.35, float(quality_refine_custom_denoise)))
            status = f"QUALITY REFINE ON · CUSTOM | pass 2: {steps} steps | denoise {denoise:.2f}"

        preserve = bool(quality_refine_preserve_audio)
        reencode = bool(quality_refine_reencode_enabled) and enabled
        reencode_scale = max(1.0, min(2.0, float(quality_refine_reencode_scale)))

        if enabled:
            status += " | " + ("BASE AUDIO PRESERVED" if preserve else "JOINT AV REFINE")
            if reencode:
                status += f" | DECODE→UPSCALE→RE-ENCODE ×{reencode_scale:.2f}"
            else:
                status += " | DIRECT LATENT REFINE"

        if len(results) > 4:
            ui["status"] = [f"{results[4]} | {status}"]

        return {
            "ui": ui,
            "result": results + (
                enabled,
                steps,
                denoise,
                preserve,
                reencode,
                reencode_scale,
                status,
            ),
        }
