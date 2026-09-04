from ..services.ollama_client import OllamaClient, OllamaError
from ..services.prompt_pipeline import DEFAULT_MODEL, DEFAULT_SERVER_URL


class VelvetViceOllamaReleaseBarrier:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "prompt_package": (
                    "VELVET_VICE_PROMPT_PACKAGE",
                    {"forceInput": True},
                ),
                "strict_release": (
                    "BOOLEAN",
                    {"default": True},
                ),
                "timeout_seconds": (
                    "INT",
                    {
                        "default": 20,
                        "min": 3,
                        "max": 120,
                        "step": 1,
                    },
                ),
            }
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("prompt",)
    FUNCTION = "release"
    CATEGORY = "VELVET VICE/Internal"
    DESCRIPTION = (
        "Forces every Ollama model used by the Prompt Director out of "
        "memory before passing the final prompt to the render pipeline."
    )

    @classmethod
    def IS_CHANGED(cls, **kwargs):
        return float("NaN")

    def release(
        self,
        prompt_package,
        strict_release,
        timeout_seconds,
    ):
        if not isinstance(prompt_package, dict):
            raise TypeError(
                "Expected VELVET_VICE_PROMPT_PACKAGE from the "
                "VELVET VICE Prompt Director."
            )
        if prompt_package.get("schema") != "VELVET_VICE_PROMPT_PACKAGE":
            raise ValueError(
                "Invalid prompt package schema. Reconnect the Prompt "
                "Director directly to this Release Barrier."
            )

        prompt = prompt_package.get("final_prompt")
        if not isinstance(prompt, str):
            raise ValueError(
                "The prompt package does not contain a valid prompt."
            )

        models = prompt_package.get("used_models") or []
        release_required = bool(
            prompt_package.get("release_required") and models
        )
        if not release_required:
            print(
                "[VELVET VICE] Ollama release bypassed: "
                "the selected mode made no Ollama calls."
            )
            return (prompt,)

        try:
            client = OllamaClient(prompt_package.get("ollama_url", ""))
            client.release_models(models, timeout_seconds)
            print(
                "[VELVET VICE] Ollama model release confirmed before "
                f"MiniMax H3 rendering: {', '.join(models)}"
            )
        except (OllamaError, ValueError) as error:
            message = (
                "[VELVET VICE] Could not confirm Ollama release "
                f"before MiniMax H3 rendering: {error}"
            )
            if strict_release:
                raise RuntimeError(message) from error
            print(f"WARNING: {message}")
        return (prompt,)


class VelvetViceOllamaRelease:
    """Legacy-compatible wrapper for V1.1 workflows."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "text": ("STRING", {"forceInput": True}),
                "enabled": ("BOOLEAN", {"default": True}),
                "server_url": (
                    "STRING",
                    {"default": DEFAULT_SERVER_URL},
                ),
                "model": (
                    "STRING",
                    {"default": DEFAULT_MODEL},
                ),
                "timeout_seconds": (
                    "INT",
                    {
                        "default": 20,
                        "min": 3,
                        "max": 120,
                        "step": 1,
                    },
                ),
                "strict_cleanup": (
                    "BOOLEAN",
                    {"default": True},
                ),
            }
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("text",)
    FUNCTION = "release"
    CATEGORY = "VELVET VICE/Legacy"
    DESCRIPTION = (
        "Legacy alias retained for existing V1.1 workflows."
    )

    @classmethod
    def IS_CHANGED(cls, **kwargs):
        return float("NaN")

    def release(
        self,
        text,
        enabled,
        server_url,
        model,
        timeout_seconds,
        strict_cleanup,
    ):
        if not enabled:
            return (text,)
        try:
            OllamaClient(server_url).release_models(
                [model], timeout_seconds
            )
        except (OllamaError, ValueError) as error:
            message = (
                "[VELVET VICE] Legacy Ollama cleanup failed: "
                f"{error}"
            )
            if strict_cleanup:
                raise RuntimeError(message) from error
            print(f"WARNING: {message}")
        return (text,)
