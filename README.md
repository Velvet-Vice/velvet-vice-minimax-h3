# VELVET VICE — MiniMax H3

Standalone Velvet Vice custom-node package for **MiniMax H3 FL2VA image-to-video** in ComfyUI.

## Scope

This repository is MiniMax H3-only. The public node IDs, workflow metadata, UI, guides, HTTP routes and Comfy Registry package use the standalone ID `velvet-vice-minimax-h3`.

The current public/Civitai v1.4.3 workflow should carry `cnr_id = "velvet-vice-minimax-h3"` and `ver = "1.4.3"` on all Velvet Vice H3 nodes so Missing Nodes resolves the current Registry package.

The synchronized GitHub reference workflow is:

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
- Static Midnight-Violet / Obsidian H3 UI with no idle color cycling or repaint timer
- Native ComfyUI growable DOM-widget resizing for the large H3 control panels
- Full-panel chrome guard to prevent duplicate native title/chrome space on custom DOM panels
- Strict runtime isolation from the separate Velvet Vice Zen MiniMax H3 package
- Unified Preflight/Timer visual construction across the complete large-H3 workflow
- Guided 01 → 07 workflow layout with inline Quick Guides

## Strongly recommended — Turbo LoRA

MiniMax H3 works in Base mode, but a compatible Turbo LoRA is strongly recommended because it can reduce the sampling cost dramatically.

Turbo LoRAs on Civitai:

https://civitai.red/models/2837571/minimax-h3-turbo-loras?modelVersionId=3275758

`Turbo LoRA AVAILABLE/READY` means that the file was detected. The LoRA is only applied when **Turbo is enabled in the H3 Director**. Match `Turbo Steps` to the LoRA you downloaded; for example, a 4-step Turbo LoRA can be used at 4 steps.

## Live-preview decoder

Preview tiers:

- **LOW** — latent2rgb; no extra decoder required
- **AUTO / MEDIUM** — uses the H3 TAEHV decoder when available; if it is missing, Velvet Vice downloads it automatically on first use, verifies its SHA256 and stores it in `models/vae_approx/taeh3_decoder.safetensors`
- **HIGH** — full MiniMax H3 video VAE, with fallback chain

The automatic TAEHV download is lazy: nothing is fetched when ComfyUI starts. It is triggered only when AUTO/MEDIUM live preview actually needs the decoder. If the download fails, the render continues and the preview falls back to latent2rgb.

Existing decoder files are never overwritten automatically. The portable release may still include `_INSTALL_H3_PREVIEW_TAEHV.cmd` as a manual fallback.

## Workflow dependencies

The workflow also uses standard/external ComfyUI nodes for supporting tasks, including:

- MiniMax H3 support from current ComfyUI core
- VideoHelperSuite (`VHS_PruneOutputs` and final video encoding backend)
- ComfyUI-VFI (`RIFEInterpolation`) when the optional 48 FPS finishing path is used
- rgthree nodes for decorative labels/bookmark in the supplied workflow

The Velvet Vice custom nodes themselves are distributed by this repository.

## Installation

### Comfy Registry / Manager

Install:

`velvet-vice-minimax-h3`

Then restart ComfyUI and load the workflow.

A Registry/Manager install is tracked as a concrete semantic version. A manual Git clone is intentionally shown by ComfyUI Manager as `nightly` because it is a Git checkout rather than a Registry package.

### Manual GitHub installation

Clone or copy this repository into:

`ComfyUI/custom_nodes/velvet-vice-minimax-h3`

Restart ComfyUI afterwards.

Use only one copy of the package in `custom_nodes`; old legacy folders such as `ComfyUI-Velvet-Vice-MiniMax-H3` should be removed to avoid duplicate loading and incomplete Manager uninstall behavior.

## Registry

- Publisher: `velvet-vice`
- Node ID: `velvet-vice-minimax-h3`
- Version: `1.4.3`
- Display name: `VELVET VICE — MiniMax H3`

Repository target:

https://github.com/Velvet-Vice/velvet-vice-minimax-h3

## Publishing updates

This repository includes `.github/workflows/publish_action.yml` for Comfy Registry publishing. Add a GitHub Actions repository secret named `REGISTRY_ACCESS_TOKEN` containing the Registry publishing API key for publisher `velvet-vice`. See `REGISTRY_PUBLISHING.md` for the release checklist.
