from __future__ import annotations

import base64
import logging
import re
import time
from io import BytesIO
from pathlib import Path
from typing import Any


EVENT_NAME = "velvet_vice.h3_live_preview"
WRAPPER_KEY = "velvet_vice_minimax_h3_live_preview_v2"
H3_FPS = 24.0
MAX_BUFFERED_FRAMES = 144
MIN_EMIT_INTERVAL_SECONDS = 0.12
PREVIEW_QUALITY_OPTIONS = ("AUTO", "LOW", "MEDIUM", "HIGH")
_TAEH3V_CACHE = {"path": None, "mtime": None, "vae": None, "error": None}



def _resolve_preview_fps(value: Any) -> float:
    text = str(value or "AUTO").strip().upper().replace(" FPS", "")
    if text == "AUTO":
        return H3_FPS
    try:
        return max(1.0, min(30.0, float(text)))
    except (TypeError, ValueError):
        return H3_FPS


def _normalize_quality_code(value: Any) -> int:
    """Return stable AUTO/LOW/MEDIUM/HIGH quality code (0/1/2/3)."""
    if isinstance(value, str):
        text = value.strip().upper()
        names = {"AUTO": 0, "LOW": 1, "MEDIUM": 2, "HIGH": 3}
        if text in names:
            return names[text]
        try:
            value = int(float(text))
        except (TypeError, ValueError):
            return 2
    try:
        number = int(value)
    except (TypeError, ValueError):
        return 2
    if number in (0, 1, 2, 3):
        return number
    # Backward compatibility with the previous q80/q88/q92 numeric transport.
    if number <= 82:
        return 1
    if number <= 90:
        return 2
    return 3


def _resolve_preview_quality(value: Any, max_edge: int = 768) -> dict[str, Any]:
    """Resolve a quality tier into visibly different runtime parameters.

    Quality now controls spatial preview detail as well as compression/frame
    budget. `max_edge` remains a user-selected hard cap.
    """
    code = _normalize_quality_code(value)
    profiles = {
        # Quality tiers now set decode quality and a transport ceiling. The
        # actual buffered frame count is derived from timeline duration × the
        # selected preview FPS so motion speed stays close to real time.
        0: {"mode": "AUTO", "target_edge": 512, "jpeg_quality": 90, "max_frame_budget": 72},
        1: {"mode": "LOW", "target_edge": 384, "jpeg_quality": 82, "max_frame_budget": 48},
        2: {"mode": "MEDIUM", "target_edge": 640, "jpeg_quality": 90, "max_frame_budget": 96},
        3: {"mode": "HIGH", "target_edge": 1024, "jpeg_quality": 95, "max_frame_budget": 144},
    }
    profile = dict(profiles[code])
    cap = max(384, min(1024, int(max_edge)))
    effective_edge = min(cap, int(profile["target_edge"]))
    profile.update({"code": code, "max_edge": cap, "effective_edge": effective_edge})
    return profile


def _h3_timeline_frame_count(latent_frames: int) -> int:
    """Map H3 latent T back to the represented 24-FPS pixel-frame count."""
    latent_t = max(1, int(latent_frames))
    if latent_t <= 2:
        return 5
    blocks, remainder = divmod(latent_t - 2, 5)
    if remainder == 0:
        return 17 * blocks + 5
    return max(5, int(round(latent_t * 17.0 / 5.0)))


def _send_event(payload: dict[str, Any], node_id: str | None = None) -> None:
    try:
        from server import PromptServer  # type: ignore

        data = dict(payload)
        data["node_id"] = None if node_id in (None, "") else str(node_id)
        server = PromptServer.instance
        # Omitting a client id follows the normal custom-event path and avoids
        # losing the preview when ComfyUI's current client id is not populated.
        server.send_sync(EVENT_NAME, data)
    except ModuleNotFoundError:
        # Unit-test/import contexts outside ComfyUI have no PromptServer.
        return
    except Exception:
        logging.exception("VELVET VICE H3 preview event delivery failed.")


def _send_status(node_id: str | None, stage: str, message: str) -> None:
    _send_event(
        {
            "kind": "status",
            "stage": str(stage),
            "message": str(message),
            "timestamp": time.time(),
        },
        node_id,
    )


def _video_stream(x0, latent_shapes=None):
    """Return H3's [B,C,T,H,W] video stream from the sampler callback value."""
    if x0 is None:
        return None
    if getattr(x0, "is_nested", False):
        tensors = getattr(x0, "tensors", ())
        return tensors[0] if tensors else None
    if getattr(x0, "ndim", 0) == 5:
        return x0
    if latent_shapes and len(latent_shapes) > 1:
        import comfy.utils  # type: ignore

        streams = comfy.utils.unpack_latents(x0, list(latent_shapes))
        if streams:
            return streams[0]
    return None


def _pick_frames(video, max_frames: int = MAX_BUFFERED_FRAMES):
    """Evenly thin video latent frames while preserving the whole shot."""
    import torch

    count = int(video.shape[2])
    if max_frames <= 0 or count <= max_frames:
        return video
    indices = torch.linspace(
        0,
        count - 1,
        steps=max_frames,
        device=video.device,
    ).round().long().unique()
    return video[:, :, indices]


def _select_taeh3v_filename() -> str | None:
    """Select only the H3-trained 24-channel TAEHV preview decoder."""
    try:
        import folder_paths  # type: ignore
        names = [str(name) for name in folder_paths.get_filename_list("vae_approx")]
    except Exception:
        return None
    exact = [
        name for name in names
        if name.replace("\\", "/").split("/")[-1].lower() == "taeh3_decoder.safetensors"
    ]
    return sorted(exact, key=len)[0] if exact else None


def _frame_indices(frame_count: int, max_frames: int):
    import torch

    count = max(1, int(frame_count))
    limit = max(1, int(max_frames))
    if count <= limit:
        return list(range(count))
    return torch.linspace(0, count - 1, steps=limit).round().long().unique().tolist()


class _DropMissingVAEKeys(logging.Filter):
    """Decoder-only tiny VAEs intentionally have no encoder weights."""
    def filter(self, record):
        return "Missing VAE keys" not in record.getMessage()


def _load_taeh3v_vae():
    """Load the trained H3 TAEHV decoder through ComfyUI's own VAE class."""
    name = _select_taeh3v_filename()
    if not name:
        return None, "taeh3_decoder.safetensors was not found in models/vae_approx."
    try:
        import folder_paths  # type: ignore
        import comfy.utils  # type: ignore
        import comfy.sd  # type: ignore

        path = folder_paths.get_full_path("vae_approx", name)
        if not path:
            return None, f"H3 TAEHV preview decoder '{name}' could not be resolved."
        mtime = Path(path).stat().st_mtime_ns
        if _TAEH3V_CACHE["path"] == path and _TAEH3V_CACHE["mtime"] == mtime:
            return _TAEH3V_CACHE["vae"], _TAEH3V_CACHE["error"]

        state = comfy.utils.load_torch_file(path, safe_load=True)
        root_logger = logging.getLogger()
        flt = _DropMissingVAEKeys()
        root_logger.addFilter(flt)
        try:
            vae = comfy.sd.VAE(sd=state)
        finally:
            root_logger.removeFilter(flt)
        if hasattr(vae, "throw_exception_if_invalid"):
            vae.throw_exception_if_invalid()
        latent_channels = getattr(vae, "latent_channels", None)
        if latent_channels is not None and int(latent_channels) != 24:
            raise RuntimeError(
                f"Loaded preview VAE exposes {latent_channels} latent channels; H3 requires 24."
            )
        stage = getattr(vae, "first_stage_model", None)
        stage_name = stage.__class__.__name__ if stage is not None else "UNKNOWN"
        if stage_name not in ("TAEHV", "TAESD"):
            raise RuntimeError(
                f"Preview checkpoint loaded as {stage_name}, not a tiny TAEHV/TAESD decoder."
            )
        _TAEH3V_CACHE.update(path=path, mtime=mtime, vae=vae, error=None)
        logging.info("VELVET VICE H3 PREVIEW | TAEHV decoder active: %s", path)
        return vae, None
    except Exception as error:
        message = f"H3 TAEHV could not be loaded: {type(error).__name__}: {error}"
        _TAEH3V_CACHE.update(path=None, mtime=None, vae=None, error=message)
        logging.exception("VELVET VICE H3 TAEHV preview decoder load failed.")
        return None, message


def _video_vae_to_pil(vae, video, max_frames: int, max_edge: int):
    """Decode the complete H3 temporal latent through a real VAE object.

    Supports both the lightweight H3 TAEHV decoder and the workflow's full
    MiniMax H3 video VAE. Frames are selected only after decoding so HIGH
    quality is sourced from the actual H3 VAE rather than an enlarged preview.
    """
    import torch
    from PIL import Image

    if video is None or getattr(video, "ndim", 0) != 5:
        return []
    if int(video.shape[1]) != 24:
        raise RuntimeError(f"H3 preview received {int(video.shape[1])} latent channels instead of 24.")

    with torch.inference_mode():
        images = vae.decode(video[:1])

    ndim = getattr(images, "ndim", 0)
    if ndim == 5:
        # Preferred ComfyUI video decode layout: [B,T,H,W,C].
        if int(images.shape[-1]) in (1, 3, 4):
            images = images.reshape((-1,) + tuple(images.shape[-3:]))
        # Defensive compatibility: [B,C,T,H,W].
        elif int(images.shape[1]) in (1, 3, 4):
            images = images.movedim(1, -1).reshape((-1,) + tuple(images.movedim(1, -1).shape[-3:]))
        else:
            raise RuntimeError(f"H3 preview VAE returned unsupported 5D image shape {getattr(images, 'shape', None)}")
    elif ndim == 4:
        # ComfyUI normally returns NHWC. Accept NCHW defensively.
        if int(images.shape[-1]) not in (1, 3, 4) and int(images.shape[1]) in (1, 3, 4):
            images = images.movedim(1, -1)
    else:
        raise RuntimeError(f"H3 preview VAE returned unsupported image shape {getattr(images, 'shape', None)}")

    count = int(images.shape[0])
    indices = _frame_indices(count, max_frames)
    images = images[indices]
    # ComfyUI TAEHV uses [-1,1]. Be defensive for versions returning [0,1].
    sample_min = float(images.detach().amin().item()) if images.numel() else 0.0
    if sample_min < -0.01:
        images = (images + 1.0) * 0.5
    images = images.clamp(0.0, 1.0)

    output = []
    for frame in images:
        array = frame.mul(255.0).to(device="cpu", dtype=torch.uint8).numpy()
        image = Image.fromarray(array)
        if max_edge > 0 and max(image.width, image.height) > max_edge:
            resampling = getattr(Image, "Resampling", Image)
            image.thumbnail((max_edge, max_edge), resampling.LANCZOS)
        output.append(image)
    return output


def _taeh3v_to_pil(vae, video, max_frames: int, max_edge: int):
    """Backward-compatible name for the lightweight H3 TAEHV path."""
    return _video_vae_to_pil(vae, video, max_frames, max_edge)


class _RGBFactors:
    """Fast H3 latent2rgb projection; no final VAE decode is performed."""

    def __init__(self, latent_format):
        import torch

        factors = getattr(latent_format, "latent_rgb_factors", None)
        if factors is None:
            raise RuntimeError("MiniMax H3 latent format has no RGB preview factors.")
        self.weight = torch.as_tensor(factors, device="cpu").transpose(0, 1)
        bias = getattr(latent_format, "latent_rgb_factors_bias", None)
        self.bias = None if bias is None else torch.as_tensor(bias, device="cpu")

    def __call__(self, video):
        import torch.nn.functional as F

        # [B,C,T,H,W] -> [B,T,C,H,W] -> [B*T,C,H,W]
        moved = video.movedim(2, 1)
        channels = int(self.weight.shape[1])
        x = moved.reshape((-1,) + tuple(moved.shape[-3:]))[:, :channels].to(
            dtype=self.weight.dtype
        )
        weight = self.weight.to(device=x.device, dtype=x.dtype)
        bias = None if self.bias is None else self.bias.to(device=x.device, dtype=x.dtype)
        return ((F.linear(x.movedim(1, -1), weight, bias=bias) + 1.0) / 2.0).clamp(0.0, 1.0)


def _to_pil(images, max_edge: int):
    import torch
    from PIL import Image

    output = []
    for frame in images:
        array = frame.mul(255.0).to(device="cpu", dtype=torch.uint8).numpy()
        image = Image.fromarray(array)
        longest = max(image.width, image.height)
        if max_edge > 0 and longest > 0 and longest != max_edge:
            scale = float(max_edge) / float(longest)
            target = (
                max(1, int(round(image.width * scale))),
                max(1, int(round(image.height * scale))),
            )
            resampling = getattr(Image, "Resampling", Image)
            image = image.resize(target, resampling.BICUBIC)
        output.append(image)
    return output




def _effective_preview_frame_budget(
    timeline_frame_count: int,
    preview_fps: float,
    quality_budget_cap: int,
    preview_frames_cap: int,
) -> int:
    timeline_frame_count = max(1, int(timeline_frame_count))
    timeline_duration_seconds = timeline_frame_count / H3_FPS
    desired = int(round(timeline_duration_seconds * max(1.0, float(preview_fps))))
    desired = max(2, desired)
    cap = max(2, min(int(quality_budget_cap), int(preview_frames_cap), timeline_frame_count))
    return max(2, min(desired, cap))


def _effective_source_playback_fps(frame_count: int, timeline_frame_count: int) -> float:
    duration = max(1.0 / H3_FPS, max(1, int(timeline_frame_count)) / H3_FPS)
    return max(0.5, min(60.0, float(frame_count) / duration))
def _encode_preview_frames_jpeg(frames, quality: int) -> list[str]:
    """Encode static RGB preview frames for the buffered H3 preview transport."""
    encoded: list[str] = []
    q = max(75, min(95, int(quality)))
    for frame in frames:
        buffer = BytesIO()
        try:
            rgb = frame.convert("RGB")
            rgb.save(buffer, format="JPEG", quality=q, optimize=False, progressive=False)
            encoded.append(base64.b64encode(buffer.getvalue()).decode("ascii"))
        except Exception:
            logging.exception("VELVET VICE H3 JPEG preview frame encode failed.")
            return []
    return encoded


class _MiniMaxH3PreviewOuterWrapper:
    """Observe H3's real sampler callback and stream a whole-shot preview."""

    def __init__(
        self,
        *,
        preview_fps: float,
        quality_code: Any = 3,
        max_edge: int = 768,
        node_id: str | None = None,
        preview_frames: int = MAX_BUFFERED_FRAMES,
        webp_quality: int | None = None,
        video_vae=None,
    ):
        self.preview_fps = max(1.0, min(30.0, float(preview_fps)))
        if webp_quality is not None and quality_code == 3:
            # Compatibility for old internal callers/tests that supplied only q-value.
            quality_code = webp_quality
        self.quality = _resolve_preview_quality(quality_code, max_edge)
        self.quality_mode = str(self.quality["mode"])
        self.jpeg_quality = int(self.quality["jpeg_quality"])
        self._last_emit = 0.0
        self.max_edge_cap = int(self.quality["max_edge"])
        self.max_edge = int(self.quality["effective_edge"])
        self.preview_frames = max(2, min(144, int(preview_frames)))
        self.frame_budget_cap = min(self.preview_frames, int(self.quality["max_frame_budget"]))
        self.node_id = None if node_id in (None, "") else str(node_id)
        self.video_vae = video_vae

    def __call__(
        self,
        executor,
        noise,
        latent_image,
        sampler,
        sigmas,
        denoise_mask,
        callback,
        disable_pbar,
        seed,
        **kwargs,
    ):
        guider = executor.class_obj
        latent_shapes = kwargs.get("latent_shapes")
        latent_format = getattr(
            getattr(getattr(guider, "model_patcher", None), "model", None),
            "latent_format",
            None,
        )
        if self.quality_mode == "LOW":
            taeh3v, taeh3v_error = None, "LOW quality intentionally uses latent2rgb only."
        else:
            taeh3v, taeh3v_error = _load_taeh3v_vae()
        rgb = None
        if latent_format is not None:
            try:
                rgb = _RGBFactors(latent_format)
            except Exception:
                logging.exception("VELVET VICE H3 latent2rgb fallback could not initialize.")
        if taeh3v is None and rgb is None:
            _send_status(
                self.node_id,
                "NO_PREVIEW_DECODER",
                taeh3v_error or "Neither H3 TAEHV nor latent2rgb is available. Render continues.",
            )
            return executor(
                noise,
                latent_image,
                sampler,
                sigmas,
                denoise_mask,
                callback,
                disable_pbar,
                seed,
                **kwargs,
            )

        if self.quality_mode == "LOW":
            _send_status(
                self.node_id,
                "LOW_LATENT2RGB_READY",
                "LOW quality selected: fast latent2rgb preview source active.",
            )
        elif taeh3v is not None:
            _send_status(
                self.node_id,
                "TAEH3V_READY",
                "H3 TAEHV true-RGB preview decoder loaded. Waiting for the first H3 sampler buffer…",
            )
        else:
            _send_status(
                self.node_id,
                "LATENT2RGB_FALLBACK",
                (taeh3v_error or "H3 TAEHV unavailable") + " Using coarse latent2rgb fallback.",
            )
        _send_status(
            self.node_id,
            "SAMPLING",
            "H3 sampler hook active. Waiting for the first denoised latent buffer…",
        )
        original_callback = callback
        state = {"warned": False, "warned_taeh3v": False, "sent": 0}

        def combined(step, x0, x, total_steps):
            if x0 is not None:
                if state["sent"] == 0:
                    _send_status(
                        self.node_id,
                        "FRAME_RECEIVED",
                        "First H3 sampler buffer received. Building whole-shot preview…",
                    )
                try:
                    now = time.time()
                    if state["sent"] > 0 and (now - self._last_emit) < MIN_EMIT_INTERVAL_SECONDS:
                        if original_callback is not None:
                            original_callback(step, x0, x, total_steps)
                        return
                    video = _video_stream(x0, latent_shapes)
                    if video is not None and getattr(video, "ndim", 0) == 5:
                        latent_t = int(video.shape[2])
                        timeline_frames = _h3_timeline_frame_count(latent_t)
                        effective_frame_budget = _effective_preview_frame_budget(
                            timeline_frames, self.preview_fps, self.frame_budget_cap, self.preview_frames
                        )
                        frames = []
                        preview_mode = f"H3 LATENT2RGB · {self.quality_mode}"

                        # Quality tiers use genuinely different decoder sources.
                        # LOW: latent2rgb only. MEDIUM/AUTO: lightweight TAEHV.
                        # HIGH: the workflow's actual MiniMax H3 video VAE.
                        if self.quality_mode == "HIGH" and self.video_vae is not None:
                            try:
                                frames = _video_vae_to_pil(
                                    self.video_vae, video, effective_frame_budget, self.max_edge
                                )
                                if frames:
                                    preview_mode = "H3 FULL VIDEO VAE · HIGH"
                            except Exception as error:
                                _send_status(
                                    self.node_id,
                                    "FULL_VAE_FALLBACK",
                                    f"Full H3 video-VAE preview failed: {type(error).__name__}: {error}. Falling back to TAEHV.",
                                )
                                logging.exception("VELVET VICE H3 full video-VAE preview failed; falling back to TAEHV.")

                        if not frames and self.quality_mode in ("AUTO", "MEDIUM", "HIGH") and taeh3v is not None:
                            try:
                                frames = _taeh3v_to_pil(
                                    taeh3v, video, effective_frame_budget, self.max_edge
                                )
                                if frames:
                                    preview_mode = (
                                        "H3 TAEHV · MEDIUM"
                                        if self.quality_mode == "MEDIUM"
                                        else "H3 TAEHV · AUTO"
                                        if self.quality_mode == "AUTO"
                                        else "H3 TAEHV · HIGH FALLBACK"
                                    )
                            except Exception as error:
                                state["warned_taeh3v"] = True
                                _send_status(
                                    self.node_id,
                                    "TAEH3V_FALLBACK",
                                    f"H3 TAEHV preview failed for this render: {type(error).__name__}: {error}. Falling back to latent2rgb.",
                                )
                                logging.exception("VELVET VICE H3 TAEHV decode failed; using latent2rgb fallback.")

                        if not frames and rgb is not None:
                            selected = _pick_frames(video, effective_frame_budget)
                            decoded = rgb(selected)
                            frames = _to_pil(decoded, self.max_edge)
                            preview_mode = f"H3 LATENT2RGB · {self.quality_mode} FALLBACK"
                        source_playback_fps = _effective_source_playback_fps(len(frames), timeline_frames)
                        encoded_frames = _encode_preview_frames_jpeg(frames, self.jpeg_quality)
                        if encoded_frames:
                            state["sent"] += 1
                            _send_event(
                                {
                                    "kind": "preview_frames",
                                    "stage": "STREAMING",
                                    # Backward-compatible first-frame payload for older frontends.
                                    "webp": encoded_frames[0],
                                    "frames": encoded_frames,
                                    "mime": "image/jpeg",
                                    "width": int(frames[0].width),
                                    "height": int(frames[0].height),
                                    "frame_count": len(encoded_frames),
                                    "timeline_frame_count": timeline_frames,
                                    "timeline_duration_seconds": timeline_frames / H3_FPS,
                                    "source_playback_fps": source_playback_fps,
                                    "preview_fps": self.preview_fps,
                                    "step": int(step) + 1,
                                    "steps": int(total_steps),
                                    "timestamp": time.time(),
                                    "preview_mode": preview_mode,
                                    "quality_mode": self.quality_mode,
                                    "quality_code": int(self.quality["code"]),
                                    "max_edge_cap": self.max_edge_cap,
                                    "effective_max_edge": self.max_edge,
                                    "jpeg_quality": self.jpeg_quality,
                                    "webp_quality": self.jpeg_quality,
                                    "preview_frame_budget": effective_frame_budget,
                                    "preview_frame_budget_cap": self.frame_budget_cap,
                                    "playback_mode": "FRONTEND_FRAME_CLOCK",
                                },
                                self.node_id,
                            )
                            self._last_emit = now
                    elif not state["warned"]:
                        state["warned"] = True
                        _send_status(
                            self.node_id,
                            "UNPACK_FAILED",
                            "Sampler buffer arrived, but the H3 video stream could not be unpacked. Render continues.",
                        )
                except Exception as error:
                    if not state["warned"]:
                        state["warned"] = True
                        _send_status(
                            self.node_id,
                            "PREVIEW_ERROR",
                            f"H3 preview decode failed: {type(error).__name__}: {error}",
                        )
                        logging.exception(
                            "VELVET VICE H3 Live Preview failed; sampling continues unchanged."
                        )
            if original_callback is not None:
                original_callback(step, x0, x, total_steps)

        try:
            return executor(
                noise,
                latent_image,
                sampler,
                sigmas,
                denoise_mask,
                combined,
                disable_pbar,
                seed,
                **kwargs,
            )
        finally:
            if state["sent"] == 0 and not state["warned"]:
                _send_status(
                    self.node_id,
                    "NO_CALLBACK",
                    "H3 sampling finished without a preview callback. The final render was not affected.",
                )


def _register_outer_sample_wrapper(model, wrapper):
    """Register exactly where current CFGGuider reads OUTER_SAMPLE wrappers."""
    import comfy.patcher_extension  # type: ignore

    cloned = model.clone()
    model_options = getattr(cloned, "model_options", None)
    if model_options is None:
        raise RuntimeError("The active H3 ModelPatcher exposes no model_options.")

    comfy.patcher_extension.add_wrapper_with_key(
        comfy.patcher_extension.WrappersMP.OUTER_SAMPLE,
        WRAPPER_KEY,
        wrapper,
        model_options,
        is_model_options=True,
    )
    current = comfy.patcher_extension.get_all_wrappers(
        comfy.patcher_extension.WrappersMP.OUTER_SAMPLE,
        model_options,
        is_model_options=True,
    )
    if wrapper not in current:
        patcher_add = getattr(cloned, "add_wrapper_with_key", None)
        if not callable(patcher_add):
            raise RuntimeError(
                "This ComfyUI build did not retain the H3 OUTER_SAMPLE preview wrapper."
            )
        patcher_add(
            comfy.patcher_extension.WrappersMP.OUTER_SAMPLE,
            WRAPPER_KEY,
            wrapper,
        )
    return cloned


class VelvetViceMiniMaxH3LivePreview:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "model": ("MODEL",),
                "enabled": ("BOOLEAN", {"default": True}),
                "preview_fps": (
                    "FLOAT",
                    {"default": 24.0, "min": 1.0, "max": 30.0, "step": 1.0},
                ),
                "preview_quality": (
                    "INT", {"default": 3, "min": 0, "max": 3, "step": 1}
                ),
                "max_preview_edge": (
                    "INT",
                    {"default": 1024, "min": 384, "max": 1024, "step": 128},
                ),
            },
            "optional": {"video_vae": ("VAE",)},
            "hidden": {"unique_id": "UNIQUE_ID"},
        }

    RETURN_TYPES = ("MODEL",)
    RETURN_NAMES = ("model",)
    FUNCTION = "apply_preview"
    CATEGORY = "VELVET VICE/MiniMax H3/Preview"
    DESCRIPTION = (
        "MiniMax H3 whole-shot live sampler preview. It attaches directly to "
        "ComfyUI's OUTER_SAMPLE callback, unpacks H3's packed AV latent with "
        "ComfyUI's own unpacker and streams a buffered RGB JPEG frame set to a precise frontend FPS clock. "
        "LOW uses latent2rgb, MEDIUM uses H3 TAEHV and HIGH uses the connected full H3 video VAE. "
        "Preview failures never abort or modify final sampling."
    )

    @classmethod
    def IS_CHANGED(cls, **kwargs):
        # Force this pass-through node to install a fresh runtime wrapper for
        # every queued render instead of reusing a cached wrapped ModelPatcher.
        return float("NaN")

    def apply_preview(
        self,
        model,
        enabled=True,
        preview_fps=24.0,
        preview_quality=3,
        max_preview_edge=1024,
        video_vae=None,
        unique_id=None,
    ):
        if not bool(enabled):
            _send_status(unique_id, "DISABLED", "MiniMax H3 Live Preview is disabled.")
            return (model,)
        try:
            requested_edge = int(max_preview_edge)
        except (TypeError, ValueError):
            requested_edge = 1024
        quality_code = _normalize_quality_code(preview_quality)
        wrapper = _MiniMaxH3PreviewOuterWrapper(
            preview_fps=float(preview_fps),
            quality_code=quality_code,
            max_edge=max(384, min(1024, requested_edge)),
            node_id=unique_id,
            video_vae=video_vae,
        )
        wrapped = _register_outer_sample_wrapper(model, wrapper)
        _send_status(
            unique_id,
            "HOOKED",
            f"MiniMax H3 preview hook installed · {wrapper.quality_mode} · "
            f"effective {wrapper.max_edge}px / cap {wrapper.max_edge_cap}px · "
            f"JPEG Q{wrapper.jpeg_quality} · up to {wrapper.frame_budget_cap} frames · "
            f"decoder tier {wrapper.quality_mode}.",
        )
        return (wrapped,)


# Backward-compatible internal aliases. The active v1.4 workflow uses the
# visible combined node above, but old saved workflows should still load.
class VelvetViceMiniMaxH3LivePreviewBridge(VelvetViceMiniMaxH3LivePreview):
    FUNCTION = "apply_preview_bridge"
    CATEGORY = "VELVET VICE/MiniMax H3/Internal"

    def apply_preview_bridge(
        self,
        model,
        enabled=True,
        preview_fps=24.0,
        preview_quality=3,
        max_preview_edge=1024,
        video_vae=None,
        unique_id=None,
    ):
        return self.apply_preview(
            model,
            enabled,
            preview_fps,
            preview_quality,
            max_preview_edge,
            video_vae,
            unique_id,
        )


class VelvetViceMiniMaxH3LivePreviewDisplay:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {}}

    RETURN_TYPES = ()
    FUNCTION = "display"
    OUTPUT_NODE = True
    CATEGORY = "VELVET VICE/MiniMax H3/Preview"

    def display(self):
        return {"ui": {"status": ["VELVET VICE H3 LIVE PREVIEW READY"]}, "result": ()}
