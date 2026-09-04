from .minimax_h3 import (
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
)
from .minimax_h3_control import (
    VelvetViceMiniMaxH3AudioDecodeGate,
    VelvetViceMiniMaxH3AudioGate,
    VelvetViceMiniMaxH3Director,
    VelvetViceMiniMaxH3ModelRouter,
    VelvetViceMiniMaxH3OutputHub,
    VelvetViceMiniMaxH3ProfileManager,
    VelvetViceMiniMaxH3VAERouter,
    VelvetViceMiniMaxH3SystemHub,
)
from .minimax_h3_preview import (
    VelvetViceMiniMaxH3LivePreview,
    VelvetViceMiniMaxH3LivePreviewBridge,
    VelvetViceMiniMaxH3LivePreviewDisplay,
)
from .minimax_h3_monitors import (
    VelvetViceMiniMaxH3Preflight,
    VelvetViceMiniMaxH3RenderTimer,
)
from .minimax_h3_public import (
    VelvetViceMiniMaxH3PowerLoraAV,
    VelvetViceMiniMaxH3OutputStudio,
    VelvetViceMiniMaxH3WatermarkOverlay,
    VelvetViceMiniMaxH3SingleOutputCleanup,
    VelvetViceMiniMaxH3ImageMemoryCheckpoint,
    VelvetViceMiniMaxH3GhostAnalyzer,
    VelvetViceMiniMaxH3TemporalAntiGhost,
)

# Lazy TAEHV bootstrap for AUTO/MEDIUM live preview.
# The preview module keeps its normal latent2rgb fallback behavior; this wrapper
# only makes the optional decoder self-installing the first time it is needed.
import logging as _logging
from . import minimax_h3_preview as _h3_preview_module
from ..services.taeh3_auto import ensure_taeh3_decoder as _ensure_taeh3_decoder

_original_taeh3_loader = _h3_preview_module._load_taeh3v_vae


def _load_taeh3v_vae_with_auto_install():
    if _h3_preview_module._select_taeh3v_filename() is None:
        installed, detail = _ensure_taeh3_decoder()
        if installed:
            _logging.info("VELVET VICE H3 PREVIEW | %s", detail)
        else:
            _logging.warning(
                "VELVET VICE H3 PREVIEW | %s Falling back to latent2rgb.",
                detail,
            )
    return _original_taeh3_loader()


_h3_preview_module._load_taeh3v_vae = _load_taeh3v_vae_with_auto_install

__all__ = [name for name in globals() if name.startswith("VelvetViceMiniMaxH3")]
