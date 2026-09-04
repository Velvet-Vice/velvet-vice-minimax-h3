from ..services.memory_lifecycle import (
    cleanup_comfy_models_after_render,
    stop_render_memory_monitor,
)


def _finish_render_session(unload_render_models):
    monitor_summary = stop_render_memory_monitor()
    parts = []
    if monitor_summary is not None:
        parts.append(
            "render monitor: " + monitor_summary.format()
        )
    else:
        parts.append("render monitor was not active")

    if unload_render_models:
        cleanup_result = cleanup_comfy_models_after_render()
        parts.append(
            f"unloaded {cleanup_result.loaded_model_count} "
            "tracked ComfyUI model(s)"
        )
    else:
        parts.append("model unload disabled")

    report = "; ".join(parts)
    print(f"[VELVET VICE] FINAL CLEANUP | {report}")
    return (report,)


class VelvetViceLTXFinalMemoryCleanup:
    """Legacy three-output cleanup retained for older workflows."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "final_video": ("VHS_FILENAMES", {"forceInput": True}),
                "original_preview": (
                    "VHS_FILENAMES",
                    {"forceInput": True},
                ),
                "selected_preview": (
                    "VHS_FILENAMES",
                    {"forceInput": True},
                ),
                "unload_render_models": (
                    "BOOLEAN",
                    {"default": True},
                ),
            }
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("cleanup_report",)
    FUNCTION = "cleanup"
    OUTPUT_NODE = True
    CATEGORY = "VELVET VICE/LTX"
    DESCRIPTION = (
        "Waits for the saved video and both previews, reports the full "
        "render-session memory peak, then unloads LTX/CLIP/VAE caches."
    )

    @classmethod
    def IS_CHANGED(cls, **kwargs):
        return float("NaN")

    def cleanup(
        self,
        final_video,
        original_preview,
        selected_preview,
        unload_render_models,
    ):
        del final_video, original_preview, selected_preview
        return _finish_render_session(unload_render_models)


class VelvetViceLTXSingleOutputCleanup:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "final_video": ("VHS_FILENAMES", {"forceInput": True}),
                "unload_render_models": (
                    "BOOLEAN",
                    {"default": True},
                ),
            }
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("cleanup_report",)
    FUNCTION = "cleanup"
    OUTPUT_NODE = True
    CATEGORY = "VELVET VICE/LTX"
    DESCRIPTION = (
        "Waits for the one selected final video encode, reports the full "
        "render-session memory peak, then unloads LTX/CLIP/VAE caches."
    )

    @classmethod
    def IS_CHANGED(cls, **kwargs):
        return float("NaN")

    def cleanup(
        self,
        final_video,
        unload_render_models,
    ):
        del final_video
        return _finish_render_session(unload_render_models)
