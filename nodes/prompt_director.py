from ..services.duration_planner import resolve_duration_context
from ..services.image_codec import encode_comfy_images
from ..services.memory_lifecycle import (
    log_memory_snapshot,
    unload_comfy_models_before_ollama,
)
from ..services.ollama_client import OllamaClient
from ..services.prompt_pipeline import (
    DEFAULT_MODEL,
    DEFAULT_SERVER_URL,
    ENDING_MODES,
    FULL_AUTO_DEFAULTS,
    LTX_PROMPT_PROFILES,
    MEMORY_PROFILES,
    MODES,
    PromptPipeline,
    resolve_prompt_profile,
)


class VelvetViceLTXPromptDirector:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "mode": (MODES, {"default": "MANUAL"}),
                "manual_prompt": (
                    "STRING",
                    {"default": "", "multiline": True},
                ),
                "short_idea": (
                    "STRING",
                    {"default": "", "multiline": True},
                ),
                "full_auto_settings": (
                    "STRING",
                    {
                        "default": FULL_AUTO_DEFAULTS,
                        "multiline": True,
                    },
                ),
                "adult_confirmed": (
                    "BOOLEAN",
                    {"default": False},
                ),
                "ollama_model": (
                    "STRING",
                    {"default": DEFAULT_MODEL},
                ),
                "ollama_url": (
                    "STRING",
                    {"default": DEFAULT_SERVER_URL},
                ),
                "ollama_context_profile": (
                    MEMORY_PROFILES,
                    {"default": "8-12 GB"},
                ),
                "ending_mode": (
                    ENDING_MODES,
                    {"default": "AUTO"},
                ),
            },
            "optional": {
                "image": ("IMAGE",),
                "ltx_prompt_profile": (
                    LTX_PROMPT_PROFILES,
                    {"default": "MiniMax H3"},
                ),
            },
            "hidden": {
                "prompt": "PROMPT",
                "extra_pnginfo": "EXTRA_PNGINFO",
                "unique_id": "UNIQUE_ID",
            },
        }

    RETURN_TYPES = (
        "VELVET_VICE_PROMPT_PACKAGE",
        "STRING",
        "STRING",
    )
    RETURN_NAMES = (
        "prompt_package",
        "final_prompt_preview",
        "status",
    )
    FUNCTION = "direct"
    CATEGORY = "VELVET VICE/MiniMax H3/Internal"
    DESCRIPTION = (
        "Combines Manual, Standard Vision, Adult Assisted, and Adult "
        "Full Auto prompt paths for MiniMax H3 with strict image-fidelity "
        "analysis, duration-aware "
        "choreography, participant/anatomy ownership, geometry/contact planning, "
        "and action-bound audio guidance. Manual mode never contacts Ollama."
    )


    @classmethod
    def IS_CHANGED(cls, *args, **kwargs):
        return float("nan")

    def direct(
        self,
        mode,
        manual_prompt,
        short_idea,
        full_auto_settings,
        adult_confirmed,
        ollama_model,
        ollama_url,
        ollama_context_profile,
        ending_mode,
        ltx_prompt_profile=None,
        duration_seconds=None,
        audio_enabled=True,
        image=None,
        prompt=None,
        extra_pnginfo=None,
        unique_id=None,
    ):
        duration_context = resolve_duration_context(
            prompt=prompt,
            extra_pnginfo=extra_pnginfo,
            full_auto_settings=full_auto_settings,
            explicit_seconds=duration_seconds,
        )
        resolved_prompt_profile = resolve_prompt_profile(
            ltx_prompt_profile,
            prompt=prompt,
            extra_pnginfo=extra_pnginfo,
        )
        uses_ollama = mode != "MANUAL" and not (
            mode.startswith("ADULT") and not adult_confirmed
        )
        unload_result = None
        if uses_ollama:
            if image is None:
                raise ValueError(
                    f"{mode} requires a connected reference image."
                )
            unload_result = unload_comfy_models_before_ollama()
            encoded_images = encode_comfy_images(image)
            log_memory_snapshot("after reference image encoding")
        else:
            encoded_images = []

        client = OllamaClient(ollama_url)
        pipeline = PromptPipeline(
            client,
            telemetry=log_memory_snapshot if uses_ollama else None,
        )
        result = pipeline.run(
            mode=mode,
            encoded_images=encoded_images,
            manual_prompt=manual_prompt,
            short_idea=short_idea,
            full_auto_settings=full_auto_settings,
            adult_confirmed=adult_confirmed,
            model=ollama_model,
            server_url=ollama_url,
            memory_profile=ollama_context_profile,
            ending_mode=ending_mode,
            ltx_prompt_profile=resolved_prompt_profile,
            duration_context=duration_context,
            audio_enabled=bool(audio_enabled),
        )
        status = result.status
        if unload_result is not None:
            status = f"{status} {unload_result.summary()}"
        print(f"[VELVET VICE] {status}")
        return {
            "ui": {
                "final_prompt": [result.final_prompt],
                "status": [status],
            },
            "result": (
                result.prompt_package,
                result.final_prompt,
                status,
            ),
        }
