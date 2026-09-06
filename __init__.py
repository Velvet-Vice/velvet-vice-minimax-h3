from .nodes import (
    VelvetViceMiniMaxH3CLIPLoader,
    VelvetViceMiniMaxH3FinalPromptPreview,
    VelvetViceMiniMaxH3OllamaReleaseBarrier,
    VelvetViceMiniMaxH3OptionalTurboLora,
    VelvetViceMiniMaxH3PromptDirector,
    VelvetViceMiniMaxH3ResolutionPlanner,
    VelvetViceMiniMaxH3SystemCheck,
    VelvetViceMiniMaxH3TurboDirector,
    VelvetViceMiniMaxH3UNETLoader,
    VelvetViceMiniMaxH3VAELoader,
    VelvetViceMiniMaxH3AudioDecodeGate,
    VelvetViceMiniMaxH3AudioGate,
    VelvetViceMiniMaxH3Director,
    VelvetViceMiniMaxH3ModelRouter,
    VelvetViceMiniMaxH3OutputHub,
    VelvetViceMiniMaxH3ProfileManager,
    VelvetViceMiniMaxH3VAERouter,
    VelvetViceMiniMaxH3SystemHub,
    VelvetViceMiniMaxH3LivePreview,
    VelvetViceMiniMaxH3LivePreviewBridge,
    VelvetViceMiniMaxH3LivePreviewDisplay,
    VelvetViceMiniMaxH3Preflight,
    VelvetViceMiniMaxH3RenderTimer,
    VelvetViceMiniMaxH3PowerLoraAV,
    VelvetViceMiniMaxH3OutputStudio,
    VelvetViceMiniMaxH3WatermarkOverlay,
    VelvetViceMiniMaxH3SingleOutputCleanup,
    VelvetViceMiniMaxH3ImageMemoryCheckpoint,
    VelvetViceMiniMaxH3GhostAnalyzer,
    VelvetViceMiniMaxH3TemporalAntiGhost,
    VelvetViceMiniMaxH3AVRefineMerge,
    VelvetViceMiniMaxH3AVRefineReencodeMerge,
    VelvetViceMiniMaxH3ConditioningRefineSwitch,
    VelvetViceMiniMaxH3ReencodeAVPrepare,
    VelvetViceMiniMaxH3ImageResizeExact,
    VelvetViceMiniMaxH3RefineResolutionPlan,
    VelvetViceMiniMaxH3LatentRefineSwitch,
)
from .services.interrupt_cleanup import install_interruption_cleanup_hook

NODE_CLASS_MAPPINGS = {
    name: value for name, value in globals().copy().items()
    if name.startswith("VelvetViceMiniMaxH3") and isinstance(value, type)
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "VelvetViceMiniMaxH3CLIPLoader": "VELVET VICE MiniMax H3 — AUTO Text Encoder Loader",
    "VelvetViceMiniMaxH3FinalPromptPreview": "VELVET VICE MiniMax H3 — Final Prompt Preview",
    "VelvetViceMiniMaxH3OllamaReleaseBarrier": "VELVET VICE MiniMax H3 — Ollama Release Barrier",
    "VelvetViceMiniMaxH3OptionalTurboLora": "VELVET VICE MiniMax H3 — Optional Turbo LoRA",
    "VelvetViceMiniMaxH3PromptDirector": "VELVET VICE MiniMax H3 — Prompt Director",
    "VelvetViceMiniMaxH3ResolutionPlanner": "VELVET VICE MiniMax H3 — AUTO Resolution Planner",
    "VelvetViceMiniMaxH3SystemCheck": "VELVET VICE MiniMax H3 — System Check",
    "VelvetViceMiniMaxH3TurboDirector": "VELVET VICE MiniMax H3 — Turbo / Distilled LoRA",
    "VelvetViceMiniMaxH3UNETLoader": "VELVET VICE MiniMax H3 — AUTO Model Loader",
    "VelvetViceMiniMaxH3VAELoader": "VELVET VICE MiniMax H3 — AUTO VAE Loader",
    "VelvetViceMiniMaxH3AudioGate": "VELVET VICE MiniMax H3 — Native Audio Gate",
    "VelvetViceMiniMaxH3AudioDecodeGate": "VELVET VICE MiniMax H3 — Audio Decode / Mute Gate",
    "VelvetViceMiniMaxH3Director": "VELVET VICE MiniMax H3 — Director",
    "VelvetViceMiniMaxH3ModelRouter": "VELVET VICE MiniMax H3 — Native / GGUF Model Router",
    "VelvetViceMiniMaxH3OutputHub": "VELVET VICE MiniMax H3 — Output / Finishing Hub",
    "VelvetViceMiniMaxH3ProfileManager": "VELVET VICE MiniMax H3 — Profile Manager",
    "VelvetViceMiniMaxH3VAERouter": "VELVET VICE MiniMax H3 — Typed VAE Router",
    "VelvetViceMiniMaxH3SystemHub": "VELVET VICE MiniMax H3 — System Hub",
    "VelvetViceMiniMaxH3LivePreview": "VELVET VICE MiniMax H3 — Live Preview",
    "VelvetViceMiniMaxH3LivePreviewBridge": "VELVET VICE MiniMax H3 — Live Preview Bridge",
    "VelvetViceMiniMaxH3LivePreviewDisplay": "VELVET VICE MiniMax H3 — Live Preview Display",
    "VelvetViceMiniMaxH3Preflight": "VELVET VICE · H3 PREFLIGHT",
    "VelvetViceMiniMaxH3RenderTimer": "VELVET VICE · H3 RENDER TIMER",
    "VelvetViceMiniMaxH3PowerLoraAV": "VELVET VICE MiniMax H3 — Power LoRA AV",
    "VelvetViceMiniMaxH3OutputStudio": "VELVET VICE MiniMax H3 — Output Studio",
    "VelvetViceMiniMaxH3WatermarkOverlay": "VELVET VICE MiniMax H3 — Internal Watermark Apply",
    "VelvetViceMiniMaxH3SingleOutputCleanup": "VELVET VICE MiniMax H3 — Final Cleanup",
    "VelvetViceMiniMaxH3ImageMemoryCheckpoint": "VELVET VICE MiniMax H3 — Image Memory Checkpoint",
    "VelvetViceMiniMaxH3GhostAnalyzer": "VELVET VICE MiniMax H3 — Ghost Analyzer",
    "VelvetViceMiniMaxH3TemporalAntiGhost": "VELVET VICE MiniMax H3 — Temporal Anti-Ghost",
    "VelvetViceMiniMaxH3AVRefineMerge": "VELVET VICE MiniMax H3 — Quality Refine AV Merge",
    "VelvetViceMiniMaxH3AVRefineReencodeMerge": "VELVET VICE MiniMax H3 — Quality Refine Re-Encode AV Merge",
    "VelvetViceMiniMaxH3RefineResolutionPlan": "VELVET VICE MiniMax H3 — Refine Resolution Plan",
    "VelvetViceMiniMaxH3ImageResizeExact": "VELVET VICE MiniMax H3 — Refine Exact Resize",
    "VelvetViceMiniMaxH3ReencodeAVPrepare": "VELVET VICE MiniMax H3 — Re-Encode AV Prepare",
    "VelvetViceMiniMaxH3ConditioningRefineSwitch": "VELVET VICE MiniMax H3 — Refine Conditioning Switch",
    "VelvetViceMiniMaxH3LatentRefineSwitch": "VELVET VICE MiniMax H3 — Quality Refine Lazy Switch",
}

WEB_DIRECTORY = "./web"

try:
    install_interruption_cleanup_hook()
except Exception as exc:
    print(f"WARNING: [VELVET VICE] MiniMax H3 interruption-cleanup hook unavailable: {exc}")
