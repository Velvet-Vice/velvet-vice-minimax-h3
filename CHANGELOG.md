# Changelog

## 1.5.0 — 2026-09-06

Unified public release matching the current Civitai workflow, GitHub package and Comfy Registry version.

### Added / finalized

- Optional **Quality Refine / Second Sampler** integrated into the H3 System Hub.
- True lazy bypass when Quality Refine is OFF.
- User-controlled Refine Steps in LIGHT, HIGH and CUSTOM modes.
- LIGHT denoise `0.12`, HIGH `0.20`, CUSTOM `0.01–0.35`.
- Optional **Preserve Base Audio**.
- Optional **Decode → Upscale → Re-Encode** path before pass 2 with adjustable scale.
- Correct H3 `[video, audio]` latent reconstruction for the re-encode path.
- Persistent H3 Vision / Prompt Director mode across workflow switches.
- Static Midnight Violet / Obsidian execution styling.
- Manual resize fix for H3 DOM panels, including **H3 POWER LoRA AV**.

### Release synchronization

- Civitai workflow/package: `v1.5.0`
- GitHub package: `v1.5.0`
- Comfy Registry: `v1.5.0`
- Registry ID: `velvet-vice-minimax-h3`

## 1.4.6 — 2026-09-06

Temporary Registry synchronization release used before the public version was unified to v1.5.0.

## 1.4.5 — 2026-09-06

Quality Refine, re-encode refinement, persistence and static UI development release.

## 1.4.4

Registry synchronization release built from the restored canonical Civitai 1.4.3 master.

## 1.4.3 — 2026-09-05

Synchronization and ComfyUI frontend compatibility release.

## 1.4.1 — 2026-09-05

Registry update focused on zero-extra-step live preview installation.

## 1.4.0 — 2026-09-05

Initial standalone Velvet Vice MiniMax H3 Registry release.
