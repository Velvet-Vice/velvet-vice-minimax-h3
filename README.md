# VELVET VICE — MiniMax H3

Standalone Velvet Vice custom-node package for **MiniMax H3 FL2VA image-to-video** in ComfyUI.

## Scope

This repository is MiniMax H3-only. The public node IDs, workflow metadata, UI, guides, HTTP routes and Comfy Registry package use the standalone ID `velvet-vice-minimax-h3`.

The included reference workflow is:

`workflow_examples/VELVET_VICE_MINIMAX_H3_I2V_v1.4.3.json`

## Main features

- Native / GGUF H3 backend routing with complete installed-model lists
- Automatic native/GGUF Qwen text-encoder routing in one selector
- Native ComfyUI video/audio VAE routing; the audio VAE is skipped in `MUTED · VIDEO ONLY`
- H3 System Hub and H3 Director
- VELVET VICE H3 Preflight and live Render Timer monitors
- H3-native I2VA Vision / Prompt Director with first-frame anchoring, structured audiovisual fields and Ollama release barrier
- `WITH SOUND` / `MUTED · VIDEO ONLY` propagated through prompting, VAE loading, decoding and final output
- Persistent H3 and LoRA profiles
- Power LoRA AV stack
- Turbo / Distilled LoRA path with separate base/turbo steps
- LOW / MEDIUM / HIGH live-preview tiers
- H3 Output / Finishing Hub and Output Studio
- RIFE / Ghost Analyzer / Temporal Anti-Ghost finishing path
- Watermark controls integrated into the H3 Finishing Hub
- Final memory cleanup and runtime telemetry
- Automatic PNG export decoded from the actual saved video's terminal frame, with a non-fatal tensor fallback
- Modern animated violet/blue/turquoise-green styling across every workflow node, with freely resizable control surfaces
- Strict runtime isolation from the separate Velvet Vice Zen MiniMax H3 package
- Unified Preflight/Timer visual construction across the complete large-H3 workflow
- Guided 01 → 07 workflow layout with inline Quick Guides

## Strongly recommended — Turbo LoRA

MiniMax H3 works in Base mode, but a compatible Turbo LoRA is strongly recommended because it can reduce the sampling cost dramatically.

Turbo LoRAs on Civitai:

https://civitai.red/models/2837571/minimax-h3-turbo-loras?modelVersionId=3275758

`Turbo LoRA AVAILABLE/READY` means that the file was detected. The LoRA is only applied when **Turbo is enabled in the H3 Director**. Match `Turbo Steps` to the LoRA you downloaded; for example, a 4-step Turbo LoRA can be used at 4 steps.

## Optional live-preview decoder

Optional file:

`models/vae_approx/taeh3_decoder.safetensors`

Preview tiers:

- **LOW** — latent2rgb; no extra decoder required
- **AUTO / MEDIUM** — TAEHV when installed, otherwise latent2rgb fallback
- **HIGH** — full MiniMax H3 video VAE, with fallback chain

The portable release includes `_INSTALL_H3_PREVIEW_TAEHV.cmd` for the optional decoder.

## Workflow dependencies

The workflow also uses standard/external ComfyUI nodes for supporting tasks, including:

- MiniMax H3 support from current ComfyUI core
- VideoHelperSuite (`VHS_PruneOutputs` and final video encoding backend)
- ComfyUI-VFI (`RIFEInterpolation`) when the optional 48 FPS finishing path is used
- rgthree nodes for decorative labels/bookmark in the supplied workflow

The Velvet Vice custom nodes themselves are distributed by this repository.

## Installation

### Comfy Registry / Manager

Once published to the Comfy Registry, install:

`velvet-vice-minimax-h3`

Then restart ComfyUI and load the workflow example.

### Manual GitHub installation

Clone or copy this repository into:

`ComfyUI/custom_nodes/velvet-vice-minimax-h3`

Restart ComfyUI afterwards.

## Registry

- Publisher: `velvet-vice`
- Node ID: `velvet-vice-minimax-h3`
- Version: `1.4.3`
- Display name: `VELVET VICE — MiniMax H3`

Repository target:

https://github.com/Velvet-Vice/ComfyUI-Velvet-Vice-MiniMax-H3
