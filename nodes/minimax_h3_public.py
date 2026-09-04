from .velvet_vice_suite import VelvetVicePowerLoraAV, VelvetViceOutputStudio
from .watermark_overlay import VelvetViceWatermarkOverlay
from .final_cleanup import VelvetViceLTXSingleOutputCleanup
from .decode_memory import VelvetViceLTXImageMemoryCheckpoint
from .temporal_antighost import VelvetViceLTXGhostAnalyzer, VelvetViceLTXTemporalAntiGhost


class VelvetViceMiniMaxH3PowerLoraAV(VelvetVicePowerLoraAV):
    DEFAULT_STACK = []

    @classmethod
    def _lora_choices(cls):
        choices = ["None"]
        try:
            from . import velvet_vice_suite as suite
            if suite.folder_paths is not None:
                choices.extend(suite.folder_paths.get_filename_list("loras"))
        except Exception:
            pass
        return list(dict.fromkeys(choices))

    CATEGORY = "VELVET VICE/MiniMax H3"
    DESCRIPTION = (
        "Ordered MiniMax H3 LoRA stack with FULL, VIDEO and AUDIO routing. "
        "Use H3/FL2VA-compatible LoRAs only."
    )


class VelvetViceMiniMaxH3OutputStudio(VelvetViceOutputStudio):
    @classmethod
    def INPUT_TYPES(cls):
        inputs = super().INPUT_TYPES()
        required = dict(inputs.get("required", {}))
        if "filename_prefix" in required:
            required["filename_prefix"] = ("STRING", {"default": "video/VELVET_VICE_MINIMAX_H3_I2V_FINAL"})
        return {**inputs, "required": required}

    CATEGORY = "VELVET VICE/MiniMax H3"
    DESCRIPTION = (
        "MiniMax H3 Output Studio with final video encoding, runtime status "
        "and the adaptive final-video player."
    )


class VelvetViceMiniMaxH3WatermarkOverlay(VelvetViceWatermarkOverlay):
    @classmethod
    def INPUT_TYPES(cls):
        inputs = super().INPUT_TYPES()
        required = dict(inputs.get("required", {}))
        # The Output Hub owns the picker. A real STRING socket makes the file
        # selection part of the executable graph instead of a frontend-only
        # widget mirror.
        required["watermark_file"] = ("STRING", {"forceInput": True})
        return {**inputs, "required": required}

    CATEGORY = "VELVET VICE/MiniMax H3/Internal"
    DESCRIPTION = (
        "Internal MiniMax H3 watermark processor. User-facing watermark "
        "controls live in the H3 Output / Finishing Hub."
    )


class VelvetViceMiniMaxH3SingleOutputCleanup(VelvetViceLTXSingleOutputCleanup):
    CATEGORY = "VELVET VICE/MiniMax H3/Internal"
    DESCRIPTION = (
        "Waits for the final MiniMax H3 video, reports render-session memory "
        "statistics and releases tracked ComfyUI render models."
    )


class VelvetViceMiniMaxH3ImageMemoryCheckpoint(VelvetViceLTXImageMemoryCheckpoint):
    CATEGORY = "VELVET VICE/MiniMax H3/Internal"
    DESCRIPTION = "MiniMax H3 image pass-through with RAM/VRAM checkpoint logging."


class VelvetViceMiniMaxH3GhostAnalyzer(VelvetViceLTXGhostAnalyzer):
    CATEGORY = "VELVET VICE/MiniMax H3/Finishing"
    DESCRIPTION = "Analyzes MiniMax H3 output frames for temporal ghosting artifacts."


class VelvetViceMiniMaxH3TemporalAntiGhost(VelvetViceLTXTemporalAntiGhost):
    CATEGORY = "VELVET VICE/MiniMax H3/Finishing"
    DESCRIPTION = "Optional temporal repair stage driven by the H3 Ghost Analyzer."
