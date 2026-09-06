# VELVET VICE — MiniMax H3

Standalone Velvet Vice custom-node package for **MiniMax H3 FL2VA image-to-video** in ComfyUI.

## Scope

This repository is MiniMax H3-only. The public node IDs, workflow metadata, UI, guides, HTTP routes and Comfy Registry package use the standalone ID `velvet-vice-minimax-h3`.

The included reference workflow is:

`workflow_examples/VELVET_VICE_MINIMAX_H3_I2V_v1.4.5.json`

## Main features

- Native / GGUF H3 backend routing with complete installed-model lists
- Automatic native/GGUF Qwen text-encoder routing in one selector
- Native ComfyUI video/audio VAE routing; the audio VAE is skipped in `MUTED · VIDEO ONLY`
- H3 System Hub and H3 Director
- **Quality Refine / Second Sampler integrated into H3 System Hub**
- Quality Refine is **OFF by default** and uses a true lazy bypass when disabled
- Refine Steps remain directly user-controlled in LIGHT, HIGH and CUSTOM modes
- LIGHT uses denoise `0.12`; HIGH uses `0.20`; CUSTOM exposes denoise `0.01–0.35`
- Optional **Preserve Base Audio** keeps pass-1 audio while pass 2 refines the video latent
- Optional **Decode → Upscale → Re-Encode** path before Pass 2 with adjustable scale
- H3-native I2VA Vision / Prompt Director with persistent mode across workflow switches
- VELVET VICE H3 Preflight and live Render Timer monitors
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
- **Static Midnight Violet / Obsidian styling** across the H3 workflow; execution no longer recolors node bars green/teal
- Freely resizable control surfaces, including the H3 POWER LoRA AV panel
- Strict runtime isolation from the separate Velvet Vice Zen MiniMax H3 package
- Guided 01 → 07 workflow layout with inline Quick Guides

## Quality Refine / Second Sampler

Quality Refine runs after the primary H3 sampling pass and before final VAE decode.

- **OFF** — default; pass 2 is not executed
- **LIGHT** — user-selected Refine Steps, denoise `0.12`
- **HIGH** — user-selected Refine Steps, denoise `0.20`
- **CUSTOM** — user-selected Refine Steps `1–16`, denoise `0.01–0.35`
- **Preserve Base Audio ON** — final audio remains from pass 1 while pass 2 refines video

The second pass uses the same effective H3 model/conditioning with `res_multistep + simple`. An optional Decode → Upscale → Re-Encode path can prepare a higher-resolution video latent before Pass 2 while rebuilding the H3 AV latent structure.

## Strongly recommended — Turbo LoRA

MiniMax H3 works in Base mode, but a compatible Turbo LoRA is strongly recommended because it can reduce sampling cost dramatically.

Turbo LoRAs on Civitai:

https://civitai.red/models/2837571/minimax-h3-turbo-loras?modelVersionId=3275758

`Turbo LoRA AVAILABLE/READY` means that the file was detected. The LoRA is only applied when **Turbo is enabled in the H3 Director**. Match `Turbo Steps` to the LoRA you downloaded.

## Optional live-preview decoder

Optional file:

`models/vae_approx/taeh3_decoder.safetensors`

Preview tiers:

- **LOW** — latent2rgb; no extra decoder required
- **AUTO / MEDIUM** — TAEHV when installed, otherwise latent2rgb fallback
- **HIGH** — full MiniMax H3 video VAE, with fallback chain

The portable release includes `_INSTALL_H3_PREVIEW_TAEHV.cmd`.

## Installation

### Comfy Registry / Manager

Install:

`velvet-vice-minimax-h3`

Then restart ComfyUI and load the workflow example.

### Manual GitHub installation

Clone or copy this repository into:

`ComfyUI/custom_nodes/velvet-vice-minimax-h3`

Restart ComfyUI afterwards.

## Registry

- Publisher: `velvet-vice`
- Node ID: `velvet-vice-minimax-h3`
- Version: `1.4.5`
- Display name: `VELVET VICE — MiniMax H3`
