# Changelog

## 1.4.5 — 2026-09-06

Quality Refine, re-encode refinement, persistence and static UI release.

### Added

- Optional **Quality Refine / Second Sampler** integrated into the H3 System Hub.
- True lazy bypass: with Quality Refine OFF, pass 2 is not requested or executed.
- User-controlled Refine Steps in LIGHT, HIGH and CUSTOM modes.
- LIGHT denoise preset `0.12`, HIGH `0.20`, CUSTOM `0.01–0.35`.
- Optional **Preserve Base Audio** to retain pass-1 audio while pass 2 refines the video latent.
- Optional **Decode → Upscale → Re-Encode** path before pass 2 with adjustable scale.
- H3 AV re-encode helpers that rebuild the required `[video, audio]` NestedTensor before the second sampler.

### Fixed

- H3 Vision / Prompt Director mode now persists across workflow switches instead of resetting to MANUAL.
- Static Midnight Violet / Obsidian styling is reasserted during execution so node bars no longer drift to green/teal or other dynamic colors.
- H3 System Hub keeps Quality Refine controls in the integrated control surface instead of a loose test panel.
- **H3 POWER LoRA AV** and the other packaged H3 DOM panels can now be resized with the visible bottom-right resize grip.
- The resize grip now receives pointer events directly, preventing DOM overlays from swallowing the drag gesture.

### Registry metadata

- Publisher: `velvet-vice`
- Node ID: `velvet-vice-minimax-h3`
- Version: `1.4.5`

## 1.4.4

- Registry synchronization release built from the restored canonical Civitai 1.4.3 master.
- No model, sampler, prompting, workflow-logic, UI-behavior, audio, VAE, preview, or finishing changes.
- Release/version metadata synchronized to 1.4.4 for a clean Comfy Registry package.

## 1.4.3 — 2026-09-05

Synchronization and ComfyUI frontend compatibility release.

### Fixed

- Large H3 DOM panels now use ComfyUI's growable widget layout instead of competing fixed-height resize callbacks.
- Removed dead resize space and the uncontrolled vertical growth caused by mixed `computeSize` / `computeLayoutSize` handling.
- Static Midnight-Violet / Obsidian node styling and full-panel chrome guard are included in the Registry package.
- All public and embedded H3 workflow nodes, including the internal Audio Decode Gate inside the subgraph, carry the same Registry version.
- GitHub reference workflow, Registry package metadata and portable release use one canonical release number.
- Canonical Manager install folder remains `velvet-vice-minimax-h3`; legacy duplicate folders are documented as cleanup-only compatibility paths.

### Registry metadata

- Publisher: `velvet-vice`
- Node ID: `velvet-vice-minimax-h3`
- Version: `1.4.3`

## 1.4.1 — 2026-09-05

Registry update focused on zero-extra-step live preview installation.

### Added

- Lazy automatic download of the MiniMax H3 TAEHV preview decoder for AUTO/MEDIUM live preview
- SHA256 verification before the decoder is installed into `models/vae_approx/taeh3_decoder.safetensors`
- Safe temporary download handling, size limit, and non-destructive behavior for existing files
- Offline/restricted-network fallback to latent2rgb so rendering is never blocked by preview setup

### Updated

- Registry/package version raised to `1.4.1`
- Prompt-template/version markers raised to `1.4.1`
- Public/Civitai workflow metadata prepared for `ver = "1.4.1"`
- Live-preview documentation updated to reflect automatic TAEHV setup

## 1.4.0 — 2026-09-05

Initial standalone Velvet Vice MiniMax H3 Registry release.

### Added

- Dedicated Comfy Registry node ID: `velvet-vice-minimax-h3`
- Native / GGUF MiniMax H3 model routing
- Unified native/GGUF Qwen text-encoder selection
- H3 System Hub, Director, Profile Manager, Preflight and Render Timer
- H3-native Vision / Prompt Director with first-frame anchoring
- `WITH SOUND` and `MUTED · VIDEO ONLY` routing through prompting, VAE handling, decoding and final output
- Power LoRA AV and Turbo / Distilled LoRA controls
- LOW / MEDIUM / HIGH live-preview tiers
- Output / Finishing Hub and Output Studio
- Ghost Analyzer / Temporal Anti-Ghost finishing path
- Integrated watermark controls
- Automatic final-frame PNG export
- Persistent profile and runtime telemetry support
- Standalone H3 styling and isolation from other Velvet Vice packages
- Guided 01 → 07 reference workflow

### Registry metadata

- Publisher: `velvet-vice`
- Node ID: `velvet-vice-minimax-h3`
- Version: `1.4.0`
