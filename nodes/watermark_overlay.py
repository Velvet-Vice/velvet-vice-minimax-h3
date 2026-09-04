from __future__ import annotations

import os
from pathlib import Path
from typing import Iterable

import numpy as np
from PIL import Image

try:
    import folder_paths  # type: ignore
except Exception:  # pragma: no cover
    folder_paths = None

try:
    import torch  # type: ignore
except Exception:  # pragma: no cover
    torch = None


POSITIONS = (
    "top-left",
    "top-center",
    "top-right",
    "center-left",
    "center",
    "center-right",
    "bottom-left",
    "bottom-center",
    "bottom-right",
)


def _input_directory() -> Path | None:
    if folder_paths is None:
        return None
    try:
        return Path(folder_paths.get_input_directory())
    except Exception:
        return None


def watermark_file_options() -> list[str]:
    base = _input_directory()
    files: list[str] = []
    if base and base.is_dir():
        for path in base.rglob("*"):
            if path.is_file() and path.suffix.lower() in {".png", ".webp", ".jpg", ".jpeg"}:
                try:
                    files.append(path.relative_to(base).as_posix())
                except Exception:
                    files.append(path.name)
    preferred = "Velvet_Vice_Watermark.png"
    files = sorted(set(files), key=lambda value: value.lower())
    if preferred in files:
        files.remove(preferred)
    files.insert(0, preferred)
    return files or [preferred]


def resolve_watermark_path(filename: str) -> Path | None:
    name = str(filename or "").strip()
    if not name:
        return None
    if folder_paths is not None:
        try:
            annotated = folder_paths.get_annotated_filepath(name)
            if annotated and Path(annotated).is_file():
                return Path(annotated)
        except Exception:
            pass
    base = _input_directory()
    if base is not None:
        candidate = base / name
        if candidate.is_file():
            return candidate
    candidate = Path(name)
    return candidate if candidate.is_file() else None


def _placement(
    frame_width: int,
    frame_height: int,
    mark_width: int,
    mark_height: int,
    position: str,
    margin_x: int,
    margin_y: int,
) -> tuple[int, int]:
    left = max(0, int(margin_x))
    top = max(0, int(margin_y))
    right = max(0, frame_width - mark_width - left)
    bottom = max(0, frame_height - mark_height - top)
    center_x = max(0, (frame_width - mark_width) // 2)
    center_y = max(0, (frame_height - mark_height) // 2)
    mapping = {
        "top-left": (left, top),
        "top-center": (center_x, top),
        "top-right": (right, top),
        "center-left": (left, center_y),
        "center": (center_x, center_y),
        "center-right": (right, center_y),
        "bottom-left": (left, bottom),
        "bottom-center": (center_x, bottom),
        "bottom-right": (right, bottom),
    }
    return mapping.get(str(position), mapping["bottom-right"])


def compose_watermark_tensor(
    images,
    rgba: np.ndarray,
    *,
    position: str,
    scale: float,
    opacity: float,
    margin_x: int,
    margin_y: int,
):
    if torch is None:
        raise RuntimeError("PyTorch is required for the Velvet Vice watermark overlay.")
    if not isinstance(images, torch.Tensor) or images.ndim != 4:
        raise ValueError("images must be a ComfyUI IMAGE tensor with shape [B,H,W,C].")
    if images.shape[-1] < 3:
        raise ValueError("images must contain at least RGB channels.")

    batch, frame_height, frame_width, channels = images.shape
    if frame_height < 1 or frame_width < 1:
        return images

    rgba = np.asarray(rgba, dtype=np.float32)
    if rgba.ndim != 3 or rgba.shape[-1] != 4:
        raise ValueError("watermark image must be RGBA.")

    source_h, source_w = rgba.shape[:2]
    target_w = max(1, int(round(frame_width * max(0.01, float(scale)))))
    target_h = max(1, int(round(target_w * source_h / max(1, source_w))))
    max_w = max(1, frame_width - 2 * max(0, int(margin_x)))
    max_h = max(1, frame_height - 2 * max(0, int(margin_y)))
    fit = min(1.0, max_w / target_w, max_h / target_h)
    target_w = max(1, int(round(target_w * fit)))
    target_h = max(1, int(round(target_h * fit)))

    pil = Image.fromarray(np.clip(rgba * 255.0, 0, 255).astype(np.uint8), mode="RGBA")
    pil = pil.resize((target_w, target_h), Image.Resampling.LANCZOS)
    resized = np.asarray(pil, dtype=np.float32) / 255.0

    x, y = _placement(
        frame_width,
        frame_height,
        target_w,
        target_h,
        position,
        margin_x,
        margin_y,
    )
    out = images.clone()
    device = images.device
    dtype = images.dtype
    mark_rgb = torch.as_tensor(resized[..., :3], device=device, dtype=dtype).unsqueeze(0)
    alpha = torch.as_tensor(resized[..., 3:4], device=device, dtype=dtype).unsqueeze(0)
    alpha = alpha * max(0.0, min(1.0, float(opacity)))
    region = out[:, y:y + target_h, x:x + target_w, :3]
    out[:, y:y + target_h, x:x + target_w, :3] = region * (1.0 - alpha) + mark_rgb * alpha
    return out.clamp_(0.0, 1.0)


class VelvetViceWatermarkOverlay:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "images": ("IMAGE",),
                "enabled": ("BOOLEAN", {"default": False}),
                # The watermark file is selected directly on this node. Keeping
                # the picker local prevents another connected node from silently
                # overriding a user's own logo with the bundled default.
                "watermark_file": (
                    watermark_file_options(),
                    {"default": "Velvet_Vice_Watermark.png", "image_upload": True},
                ),
                "position": (
                    "STRING",
                    {"default": "bottom-right", "multiline": False},
                ),
                "scale": ("FLOAT", {"default": 0.18, "min": 0.02, "max": 0.80, "step": 0.01}),
                "opacity": ("FLOAT", {"default": 0.65, "min": 0.0, "max": 1.0, "step": 0.01}),
                "margin_x": ("INT", {"default": 24, "min": 0, "max": 2048, "step": 1}),
                "margin_y": ("INT", {"default": 24, "min": 0, "max": 2048, "step": 1}),
            }
        }

    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("images",)
    FUNCTION = "apply"
    CATEGORY = "VELVET VICE/LTX"
    DESCRIPTION = (
        "Applies the selected RGBA watermark to the final 24/48 FPS frame stack "
        "immediately before encoding. Supports nine placements, scale, opacity "
        "and independent horizontal/vertical margins."
    )

    def apply(
        self,
        images,
        enabled,
        watermark_file,
        position,
        scale,
        opacity,
        margin_x,
        margin_y,
    ):
        if not bool(enabled):
            return (images,)
        path = resolve_watermark_path(str(watermark_file))
        if path is None:
            raise FileNotFoundError(
                f"Velvet Vice watermark not found: {watermark_file}. "
                "Copy it to ComfyUI/input or select another file in Control Hub."
            )
        try:
            with Image.open(path) as image:
                rgba = np.asarray(image.convert("RGBA"), dtype=np.float32) / 255.0
        except Exception as exc:
            raise RuntimeError(f"Could not load watermark '{path}': {exc}") from exc
        return (
            compose_watermark_tensor(
                images,
                rgba,
                position=str(position),
                scale=float(scale),
                opacity=float(opacity),
                margin_x=int(margin_x),
                margin_y=int(margin_y),
            ),
        )

    @classmethod
    def IS_CHANGED(
        cls,
        images,
        enabled,
        watermark_file,
        position,
        scale,
        opacity,
        margin_x,
        margin_y,
    ):
        if not bool(enabled):
            return "watermark-disabled"
        path = resolve_watermark_path(str(watermark_file))
        stamp = path.stat().st_mtime_ns if path and path.exists() else "missing"
        return f"{watermark_file}:{stamp}:{position}:{scale}:{opacity}:{margin_x}:{margin_y}"
