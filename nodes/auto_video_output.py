from contextlib import contextmanager
from datetime import datetime
from functools import lru_cache
from pathlib import Path
import re
import shutil
import subprocess
import sys
import threading
import time


AUTO_MODE = "AUTO — NVIDIA NVENC / CPU H.264 FALLBACK"
NVENC_ONLY_MODE = "NVIDIA NVENC ONLY"
CPU_ONLY_MODE = "CPU H.264 ONLY"

NVENC_FORMAT = "video/nvenc_h264-mp4"
CPU_FORMAT = "video/h264-mp4"
OUTPUT_IMPLEMENTATION_VERSION = "0.1.13"

_VHS_RGB8_PATCH_LOCK = threading.RLock()

_DATE_TOKEN = re.compile(r"%date:([^%]+)%")
_DATE_PARTS = re.compile(r"yyyy|yy|MM|dd|HH|hh|mm|ss")
_DATE_PART_FORMATS = {
    "yyyy": "%Y",
    "yy": "%y",
    "MM": "%m",
    "dd": "%d",
    "HH": "%H",
    "hh": "%H",
    "mm": "%M",
    "ss": "%S",
}
_WINDOWS_INVALID_COMPONENT_CHARS = re.compile(
    r'[<>:"|?*\x00-\x1f]'
)


def resolve_filename_prefix(filename_prefix, now=None):
    """Expand VHS-style date tokens and make every path part Windows-safe."""
    current_time = now or datetime.now()
    raw_prefix = str(filename_prefix or "").replace("\\", "/")

    def expand_date(match):
        date_pattern = match.group(1)
        strftime_pattern = _DATE_PARTS.sub(
            lambda part: _DATE_PART_FORMATS[part.group(0)],
            date_pattern,
        )
        try:
            return current_time.strftime(strftime_pattern)
        except (TypeError, ValueError):
            return "date"

    expanded = _DATE_TOKEN.sub(expand_date, raw_prefix)
    safe_parts = []
    for raw_part in expanded.split("/"):
        part = _WINDOWS_INVALID_COMPONENT_CHARS.sub("-", raw_part)
        part = part.rstrip(" .")
        if not part or part == ".":
            continue
        if part == "..":
            part = "_"
        safe_parts.append(part)
    return "/".join(safe_parts) or "video/LTX23-FINAL"


def _video_combine_class():
    try:
        import nodes as comfy_nodes
    except ImportError as exc:
        raise RuntimeError(
            "ComfyUI's node registry is unavailable."
        ) from exc

    video_combine = comfy_nodes.NODE_CLASS_MAPPINGS.get(
        "VHS_VideoCombine"
    )
    if video_combine is None:
        raise RuntimeError(
            "VideoHelperSuite is required for the automatic final "
            "video output."
        )
    return video_combine


def _save_last_frame(
    images,
    filename_prefix,
    prompt=None,
    extra_pnginfo=None,
):
    """Fallback: save the last tensor frame when video extraction is unavailable."""
    try:
        import nodes as comfy_nodes
    except ImportError as exc:
        raise RuntimeError(
            "ComfyUI's node registry is unavailable for last-frame output."
        ) from exc

    save_image = comfy_nodes.NODE_CLASS_MAPPINGS.get("SaveImage")
    if save_image is None:
        save_image = getattr(comfy_nodes, "SaveImage", None)
    if save_image is None:
        raise RuntimeError(
            "ComfyUI's SaveImage node is unavailable for last-frame output."
        )

    try:
        last_frame = images[-1:]
    except (IndexError, TypeError) as exc:
        raise RuntimeError(
            "The final H3 image stream contains no frame to save."
        ) from exc
    if len(last_frame) == 0:
        raise RuntimeError(
            "The final H3 image stream contains no frame to save."
        )

    last_frame_prefix = f"{filename_prefix}_LAST_FRAME"
    save_image().save_images(
        last_frame,
        filename_prefix=last_frame_prefix,
        prompt=prompt,
        extra_pnginfo=extra_pnginfo,
    )
    print(
        "[VELVET VICE] LAST FRAME | saved tensor fallback PNG with prefix: "
        f"{last_frame_prefix}"
    )


_VIDEO_SUFFIXES = {".mp4", ".mkv", ".mov", ".webm", ".avi", ".gif"}


def _result_video_paths(value):
    """Collect existing video files from VHS_FILENAMES/UI result structures."""
    found = []

    def walk(item):
        if isinstance(item, str):
            path = Path(item)
            if path.suffix.lower() in _VIDEO_SUFFIXES and path.is_file():
                found.append(path)
        elif isinstance(item, dict):
            for nested in item.values():
                walk(nested)
        elif isinstance(item, (list, tuple)):
            for nested in item:
                walk(nested)

    walk(value)
    return found


def _extract_terminal_video_frame(video_path, ffmpeg_path):
    """Decode the true terminal video frame, including ping-pong/trim effects."""
    source = Path(video_path)
    target = source.with_name(f"{source.stem}_LAST_FRAME.png")
    temporary = target.with_name(f".{target.stem}.{time.time_ns()}.tmp.png")
    command = [
        str(ffmpeg_path), "-hide_banner", "-loglevel", "error",
        "-sseof", "-3", "-i", str(source), "-map", "0:v:0",
        "-vsync", "0", "-update", "1", "-y", str(temporary),
    ]
    try:
        completed = subprocess.run(command, capture_output=True, text=True, timeout=120)
        if completed.returncode != 0 or not temporary.is_file():
            detail = (completed.stderr or completed.stdout or "unknown FFmpeg error").strip()
            raise RuntimeError(detail[-600:])
        temporary.replace(target)
    finally:
        if temporary.exists():
            temporary.unlink()
    print(f"[VELVET VICE] LAST FRAME | decoded terminal frame: {target}")
    return target


def _ffmpeg_path(video_combine):
    module = sys.modules.get(video_combine.__module__)
    bundled_path = getattr(module, "ffmpeg_path", None)
    return bundled_path or shutil.which("ffmpeg")


def _format_is_registered(video_combine, format_name):
    try:
        formats = video_combine.INPUT_TYPES()["required"]["format"][0]
    except (AttributeError, KeyError, TypeError):
        return False
    return format_name in formats


@lru_cache(maxsize=4)
def probe_nvenc(ffmpeg_path):
    if not ffmpeg_path:
        return False, "FFmpeg was not found"

    command = [
        ffmpeg_path,
        "-hide_banner",
        "-loglevel",
        "error",
        "-f",
        "lavfi",
        "-i",
        "color=c=black:s=256x256:r=24",
        "-frames:v",
        "1",
        "-pix_fmt",
        "yuv420p",
        "-c:v",
        "h264_nvenc",
        "-f",
        "null",
        "-",
    ]
    try:
        result = subprocess.run(
            command,
            capture_output=True,
            check=False,
            timeout=15,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        return False, str(exc)

    if result.returncode == 0:
        return True, "hardware probe succeeded"

    detail = result.stderr.decode(
        errors="replace"
    ).strip().replace("\n", " ")
    return False, detail or f"FFmpeg exited with {result.returncode}"


def scaled_nvenc_bitrate(base_bitrate_mbps, frame_rate):
    fps_scale = max(1.0, float(frame_rate) / 24.0)
    return max(1, round(float(base_bitrate_mbps) * fps_scale))


def _fp16_tensor_to_rgb8(tensor):
    """Quantize one FP16 frame with fast FP32 NumPy arithmetic.

    VideoHelperSuite normally multiplies a NumPy FP16 array by 255. CPU
    FP16 arithmetic is software-emulated on common desktop processors and
    becomes the dominant cost for multi-gigapixel clips. Converting the
    active frame to FP32 first is substantially faster and gives the
    mathematically correct 8-bit rounding from the stored FP16 values.
    """
    import numpy as np

    value = tensor.detach() if hasattr(tensor, "detach") else tensor
    value = value.cpu() if hasattr(value, "cpu") else value
    array = value.numpy() if hasattr(value, "numpy") else np.asarray(value)
    if array.dtype != np.float16:
        return None

    fp32 = array.astype(np.float32, copy=True)
    fp32 *= np.float32(255.0)
    fp32 += np.float32(0.5)
    np.clip(fp32, 0.0, 255.0, out=fp32)
    return fp32.astype(np.uint8)


@contextmanager
def accelerated_vhs_rgb8(video_combine):
    """Temporarily accelerate VHS FP16 frame conversion.

    The patch is scoped to the single delegated VideoHelperSuite call and
    restored even when FFmpeg raises. Non-FP16 inputs continue through the
    exact original converter.
    """
    module = sys.modules.get(video_combine.__module__)
    original = getattr(module, "tensor_to_bytes", None)
    stats = {
        "enabled": False,
        "frames": 0,
        "seconds": 0.0,
    }
    if module is None or not callable(original):
        yield stats
        return

    with _VHS_RGB8_PATCH_LOCK:
        def convert(tensor):
            started_at = time.perf_counter()
            converted = _fp16_tensor_to_rgb8(tensor)
            if converted is None:
                return original(tensor)
            stats["frames"] += 1
            stats["seconds"] += time.perf_counter() - started_at
            return converted

        module.tensor_to_bytes = convert
        stats["enabled"] = True
        try:
            yield stats
        finally:
            module.tensor_to_bytes = original


class VelvetViceLTXAutoVideoCombine:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "images": ("IMAGE", {"forceInput": True}),
                "frame_rate": (
                    "FLOAT",
                    {
                        "default": 24.0,
                        "min": 1.0,
                        "max": 240.0,
                        "step": 1.0,
                    },
                ),
                "loop_count": (
                    "INT",
                    {
                        "default": 0,
                        "min": 0,
                        "max": 100,
                        "step": 1,
                    },
                ),
                "filename_prefix": (
                    "STRING",
                    {
                        "default": "video/VELVET_VICE_MINIMAX_H3_I2V_FINAL"
                    },
                ),
                "encoder_mode": (
                    [
                        AUTO_MODE,
                        NVENC_ONLY_MODE,
                        CPU_ONLY_MODE,
                    ],
                    {"default": AUTO_MODE},
                ),
                "nvenc_bitrate_mbps_at_24fps": (
                    "INT",
                    {
                        "default": 60,
                        "min": 1,
                        "max": 999,
                        "step": 1,
                    },
                ),
                "cpu_crf": (
                    "INT",
                    {
                        "default": 15,
                        "min": 0,
                        "max": 100,
                        "step": 1,
                    },
                ),
                "pix_fmt": (
                    ["yuv420p"],
                    {"default": "yuv420p"},
                ),
                "pingpong": ("BOOLEAN", {"default": False}),
                "save_metadata": ("BOOLEAN", {"default": False}),
                "trim_to_audio": ("BOOLEAN", {"default": False}),
                "save_output": ("BOOLEAN", {"default": True}),
            },
            "optional": {
                "audio": ("AUDIO",),
            },
            "hidden": {
                "prompt": "PROMPT",
                "extra_pnginfo": "EXTRA_PNGINFO",
                "unique_id": "UNIQUE_ID",
            },
        }

    RETURN_TYPES = ("VHS_FILENAMES",)
    RETURN_NAMES = ("Filenames",)
    FUNCTION = "combine_video"
    OUTPUT_NODE = True
    CATEGORY = "VELVET VICE/MiniMax H3/Internal"
    DESCRIPTION = (
        "Encodes the selected final stream exactly once. AUTO uses "
        "VideoHelperSuite's NVIDIA H.264 preset when a real NVENC "
        "probe succeeds and falls back to CPU H.264 otherwise."
    )

    def _delegate(
        self,
        video_combine,
        *,
        format_name,
        images,
        frame_rate,
        loop_count,
        filename_prefix,
        pix_fmt,
        pingpong,
        save_metadata,
        trim_to_audio,
        save_output,
        audio,
        prompt,
        extra_pnginfo,
        unique_id,
        nvenc_bitrate,
        cpu_crf,
    ):
        kwargs = {
            "images": images,
            "frame_rate": frame_rate,
            "loop_count": loop_count,
            "filename_prefix": filename_prefix,
            "format": format_name,
            "pix_fmt": pix_fmt,
            "pingpong": pingpong,
            "save_metadata": save_metadata,
            "save_output": save_output,
            "audio": audio,
            "prompt": prompt,
            "extra_pnginfo": extra_pnginfo,
            "unique_id": unique_id,
        }
        if format_name == NVENC_FORMAT:
            kwargs.update(
                {
                    "bitrate": nvenc_bitrate,
                    "megabit": True,
                }
            )
        else:
            kwargs.update(
                {
                    "crf": cpu_crf,
                    "trim_to_audio": trim_to_audio,
                }
            )
        return video_combine().combine_video(**kwargs)

    def combine_video(
        self,
        images,
        frame_rate,
        loop_count,
        filename_prefix,
        encoder_mode,
        nvenc_bitrate_mbps_at_24fps,
        cpu_crf,
        pix_fmt,
        pingpong,
        save_metadata,
        trim_to_audio,
        save_output,
        audio=None,
        prompt=None,
        extra_pnginfo=None,
        unique_id=None,
    ):
        video_combine = _video_combine_class()
        resolved_filename_prefix = resolve_filename_prefix(
            filename_prefix
        )
        implementation_version = getattr(
            self,
            "IMPLEMENTATION_VERSION",
            OUTPUT_IMPLEMENTATION_VERSION,
        )
        print(
            "[VELVET VICE] FINAL ENCODE | implementation "
            f"v{implementation_version} active"
        )
        print(
            "[VELVET VICE] FINAL ENCODE | resolved output "
            f"prefix: {resolved_filename_prefix}"
        )
        ffmpeg_path = _ffmpeg_path(video_combine)
        nvenc_registered = _format_is_registered(
            video_combine,
            NVENC_FORMAT,
        )
        if encoder_mode == CPU_ONLY_MODE:
            nvenc_available = False
            probe_detail = "CPU H.264 was selected explicitly"
        elif not nvenc_registered:
            nvenc_available = False
            probe_detail = (
                "VideoHelperSuite's NVENC H.264 format is not "
                "registered"
            )
        else:
            nvenc_available, probe_detail = probe_nvenc(ffmpeg_path)

        if encoder_mode == NVENC_ONLY_MODE and not nvenc_available:
            raise RuntimeError(
                "NVIDIA NVENC was requested but is unavailable: "
                f"{probe_detail}"
            )

        use_nvenc = (
            encoder_mode != CPU_ONLY_MODE and nvenc_available
        )
        nvenc_bitrate = scaled_nvenc_bitrate(
            nvenc_bitrate_mbps_at_24fps,
            frame_rate,
        )
        selected = "NVIDIA NVENC" if use_nvenc else "CPU libx264"
        print(
            "[VELVET VICE] FINAL ENCODE | "
            f"selected {selected} at {float(frame_rate):g} FPS"
            + (
                f", {nvenc_bitrate} Mbit/s"
                if use_nvenc
                else f", CRF {cpu_crf}"
            )
        )
        if encoder_mode == AUTO_MODE and not use_nvenc:
            print(
                "[VELVET VICE] FINAL ENCODE | NVENC fallback "
                f"reason: {probe_detail}"
            )

        started_at = time.perf_counter()
        with accelerated_vhs_rgb8(video_combine) as conversion_stats:
            if conversion_stats["enabled"]:
                print(
                    "[VELVET VICE] FINAL ENCODE | fast FP16 -> "
                    "RGB8 frame adapter active"
                )
            try:
                result = self._delegate(
                    video_combine,
                    format_name=(
                        NVENC_FORMAT if use_nvenc else CPU_FORMAT
                    ),
                    images=images,
                    frame_rate=frame_rate,
                    loop_count=loop_count,
                    filename_prefix=resolved_filename_prefix,
                    pix_fmt=pix_fmt,
                    pingpong=pingpong,
                    save_metadata=save_metadata,
                    trim_to_audio=trim_to_audio,
                    save_output=save_output,
                    audio=audio,
                    prompt=prompt,
                    extra_pnginfo=extra_pnginfo,
                    unique_id=unique_id,
                    nvenc_bitrate=nvenc_bitrate,
                    cpu_crf=cpu_crf,
                )
            except Exception as exc:
                if encoder_mode != AUTO_MODE or not use_nvenc:
                    raise
                print(
                    "[VELVET VICE] FINAL ENCODE WARNING | NVENC "
                    f"failed ({exc}); retrying once with CPU H.264"
                )
                result = self._delegate(
                    video_combine,
                    format_name=CPU_FORMAT,
                    images=images,
                    frame_rate=frame_rate,
                    loop_count=loop_count,
                    filename_prefix=resolved_filename_prefix,
                    pix_fmt="yuv420p",
                    pingpong=pingpong,
                    save_metadata=save_metadata,
                    trim_to_audio=trim_to_audio,
                    save_output=save_output,
                    audio=audio,
                    prompt=prompt,
                    extra_pnginfo=extra_pnginfo,
                    unique_id=unique_id,
                    nvenc_bitrate=nvenc_bitrate,
                    cpu_crf=cpu_crf,
                )

        elapsed = time.perf_counter() - started_at
        if conversion_stats["frames"]:
            print(
                "[VELVET VICE] FINAL ENCODE | fast RGB8 prepared "
                f"{conversion_stats['frames']} frame conversion(s) in "
                f"{conversion_stats['seconds']:.1f}s"
            )
        print(
            "[VELVET VICE] FINAL ENCODE | completed in "
            f"{elapsed:.1f}s"
        )
        if save_output:
            try:
                video_paths = _result_video_paths(result)
                ffmpeg_path = _ffmpeg_path(video_combine)
                if not video_paths or not ffmpeg_path:
                    raise RuntimeError("saved video path or FFmpeg is unavailable")
                _extract_terminal_video_frame(video_paths[-1], ffmpeg_path)
            except Exception as extract_error:
                print(
                    "[VELVET VICE] LAST FRAME WARNING | video extraction failed "
                    f"({extract_error}); trying tensor fallback"
                )
                try:
                    _save_last_frame(
                        images,
                        resolved_filename_prefix,
                        prompt=prompt,
                        extra_pnginfo=extra_pnginfo,
                    )
                except Exception as fallback_error:
                    # The encoded video is already valid; auxiliary PNG failure
                    # must never turn a completed render into a failed workflow.
                    print(
                        "[VELVET VICE] LAST FRAME WARNING | fallback failed "
                        f"({fallback_error}); keeping completed video output"
                    )
        return result


class VelvetViceLTXAutoVideoCombineV019(
    VelvetViceLTXAutoVideoCombine
):
    """Version-bound output node used by the v0.1.9 workflow."""

    IMPLEMENTATION_VERSION = "0.1.9"
    DESCRIPTION = (
        "v0.1.9 version-bound final output. It encodes the selected "
        "stream exactly once, uses a Windows-safe path, probes NVIDIA "
        "NVENC with a 256 × 256 frame, and falls back to CPU H.264."
    )


class VelvetViceLTXAutoVideoCombineV0110(
    VelvetViceLTXAutoVideoCombine
):
    """Version-bound fast output node used by the v0.1.10 workflow."""

    IMPLEMENTATION_VERSION = "0.1.10"
    DESCRIPTION = (
        "v0.1.10 version-bound final output. It retains one automatic "
        "NVENC/CPU encode, accelerates FP16-to-RGB8 frame delivery, and "
        "returns the saved MP4 for a direct preview without a second "
        "preview encode."
    )


class VelvetViceLTXAutoVideoCombineV0112(
    VelvetViceLTXAutoVideoCombine
):
    """Version-bound output used by the portable v0.1.12 workflow."""

    IMPLEMENTATION_VERSION = OUTPUT_IMPLEMENTATION_VERSION
    DESCRIPTION = (
        "v0.1.12 version-bound final output. It retains the proven "
        "single NVENC/CPU encode and fast FP16 delivery while pairing "
        "with a post-configuration direct preview that cannot shift "
        "serialized encoder widget values."
    )


class VelvetViceLTXAutoVideoCombineV0113(
    VelvetViceLTXAutoVideoCombine
):
    """Version-bound output with automatic final-frame PNG export."""

    IMPLEMENTATION_VERSION = OUTPUT_IMPLEMENTATION_VERSION
    DESCRIPTION = (
        "v0.1.13 version-bound final output. It retains one automatic "
        "NVENC/CPU encode, fast FP16 delivery and saves the final frame "
        "of the exact encoded image stream as a PNG beside the video."
    )
