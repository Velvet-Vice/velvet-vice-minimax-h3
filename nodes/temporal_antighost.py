from __future__ import annotations

import math
from collections.abc import Iterable

from ..services.memory_lifecycle import log_memory_snapshot


ANALYSIS_MODES = (
    "SOURCE 24 FPS",
    "RIFE INSERTED FRAMES",
)
DETECTION_PROFILES = ("SAFE", "BALANCED", "STRONG")
MEMORY_MODES = ("AUTO", "GPU", "CPU")

PROFILE_THRESHOLDS = {
    "SAFE": 0.080,
    "BALANCED": 0.060,
    "STRONG": 0.043,
}


def analysis_dimensions(
    height: int,
    width: int,
    long_edge: int,
) -> tuple[int, int]:
    """Return aspect-correct analysis dimensions with a bounded long edge."""
    height = max(1, int(height))
    width = max(1, int(width))
    long_edge = max(64, int(long_edge))
    scale = min(1.0, long_edge / float(max(height, width)))
    target_height = max(16, round(height * scale))
    target_width = max(16, round(width * scale))
    return target_height, target_width


def active_frame_indices(
    frame_count: int,
    mode: str,
) -> list[int]:
    """Protect endpoints and, in RIFE mode, all original anchor frames."""
    frame_count = max(0, int(frame_count))
    if frame_count < 3:
        return []
    if mode == "RIFE INSERTED FRAMES":
        return list(range(1, frame_count - 1, 2))
    return list(range(1, frame_count - 1))


def profile_threshold(profile: str, sensitivity: float) -> float:
    base = PROFILE_THRESHOLDS.get(
        str(profile).upper(),
        PROFILE_THRESHOLDS["SAFE"],
    )
    return base / max(0.25, float(sensitivity))


def frame_ranges(
    indices: Iterable[int],
    chunk_size: int,
):
    values = list(indices)
    chunk_size = max(1, int(chunk_size))
    for start in range(0, len(values), chunk_size):
        yield values[start : start + chunk_size]


def _resolve_compute_device(torch, image, memory_mode: str):
    requested = str(memory_mode).upper()
    image_device = getattr(image, "device", torch.device("cpu"))

    if requested == "CPU":
        return torch.device("cpu")
    if requested == "GPU":
        if not torch.cuda.is_available():
            raise RuntimeError(
                "VELVET VICE Ghost Analyzer was set to GPU, but CUDA is "
                "not available. Select AUTO or CPU."
            )
        return image_device if image_device.type == "cuda" else torch.device(
            "cuda"
        )
    if getattr(image_device, "type", "cpu") == "cuda":
        return image_device
    if torch.cuda.is_available():
        return torch.device("cuda")
    return torch.device("cpu")


def _downscale_grayscale(
    torch,
    functional,
    image,
    target_height: int,
    target_width: int,
    compute_device,
    chunk_size: int,
):
    frame_count = int(image.shape[0])
    result = torch.empty(
        (frame_count, 1, target_height, target_width),
        dtype=torch.float32,
        device="cpu",
    )
    weights = None

    with torch.inference_mode():
        for start in range(0, frame_count, max(1, int(chunk_size))):
            end = min(frame_count, start + max(1, int(chunk_size)))
            source = (
                image[start:end]
                .movedim(-1, 1)
                .to(device=compute_device, dtype=torch.float32)
            )
            if int(source.shape[1]) >= 3:
                if weights is None or weights.device != source.device:
                    weights = torch.tensor(
                        [0.2126, 0.7152, 0.0722],
                        device=source.device,
                        dtype=torch.float32,
                    ).view(1, 3, 1, 1)
                gray = (source[:, :3] * weights).sum(dim=1, keepdim=True)
            else:
                gray = source[:, :1]
            if (
                int(gray.shape[-2]) != target_height
                or int(gray.shape[-1]) != target_width
            ):
                gray = functional.interpolate(
                    gray,
                    size=(target_height, target_width),
                    mode="area",
                )
            result[start:end].copy_(gray.detach().to(device="cpu"))
            del source
            del gray
    return result


def _shift_source(torch, source, dx: int, dy: int):
    """Sample source(y + dy, x + dx) at every target position."""
    height = int(source.shape[-2])
    width = int(source.shape[-1])
    shifted = torch.zeros_like(source)
    valid = torch.zeros(
        (1, 1, height, width),
        device=source.device,
        dtype=source.dtype,
    )

    target_x0 = max(0, -dx)
    target_x1 = min(width, width - dx)
    target_y0 = max(0, -dy)
    target_y1 = min(height, height - dy)
    if target_x1 <= target_x0 or target_y1 <= target_y0:
        return shifted, valid

    source_x0 = target_x0 + dx
    source_x1 = target_x1 + dx
    source_y0 = target_y0 + dy
    source_y1 = target_y1 + dy
    shifted[
        ...,
        target_y0:target_y1,
        target_x0:target_x1,
    ] = source[
        ...,
        source_y0:source_y1,
        source_x0:source_x1,
    ]
    valid[
        ...,
        target_y0:target_y1,
        target_x0:target_x1,
    ] = 1.0
    return shifted, valid


def _estimate_local_flow(
    torch,
    functional,
    target,
    source,
    search_radius: int,
    block_radius: int,
):
    """Estimate target-to-source integer flow using local block matching."""
    search_radius = max(1, int(search_radius))
    block_radius = max(1, int(block_radius))
    kernel = block_radius * 2 + 1
    batch, _, height, width = target.shape
    best_cost = torch.full(
        (batch, 1, height, width),
        float("inf"),
        device=target.device,
        dtype=torch.float32,
    )
    second_cost = torch.full_like(best_cost, float("inf"))
    best_dx = torch.zeros_like(best_cost, dtype=torch.int16)
    best_dy = torch.zeros_like(best_cost, dtype=torch.int16)

    for dy in range(-search_radius, search_radius + 1):
        for dx in range(-search_radius, search_radius + 1):
            shifted, valid = _shift_source(torch, source, dx, dy)
            error = (target - shifted).abs() + (1.0 - valid) * 2.0
            cost = functional.avg_pool2d(
                error,
                kernel_size=kernel,
                stride=1,
                padding=block_radius,
            )
            better = cost < best_cost
            second_cost = torch.where(
                better,
                best_cost,
                torch.minimum(second_cost, cost),
            )
            best_cost = torch.where(better, cost, best_cost)
            best_dx = torch.where(
                better,
                torch.full_like(best_dx, dx),
                best_dx,
            )
            best_dy = torch.where(
                better,
                torch.full_like(best_dy, dy),
                best_dy,
            )
            del shifted
            del valid
            del error
            del cost

    return best_dx, best_dy, best_cost, second_cost


def _integer_warp(torch, source, flow_dx, flow_dy):
    batch, channels, height, width = source.shape
    y = torch.arange(
        height,
        device=source.device,
        dtype=torch.int64,
    ).view(1, height, 1)
    x = torch.arange(
        width,
        device=source.device,
        dtype=torch.int64,
    ).view(1, 1, width)
    sample_y = y + flow_dy[:, 0].to(dtype=torch.int64)
    sample_x = x + flow_dx[:, 0].to(dtype=torch.int64)
    valid = (
        (sample_y >= 0)
        & (sample_y < height)
        & (sample_x >= 0)
        & (sample_x < width)
    )
    flat_index = (
        sample_y.clamp(0, height - 1) * width
        + sample_x.clamp(0, width - 1)
    ).reshape(batch, 1, height * width)
    flat_index = flat_index.expand(-1, channels, -1)
    warped = source.reshape(batch, channels, -1).gather(2, flat_index)
    warped = warped.reshape(batch, channels, height, width)
    return warped, valid.unsqueeze(1).to(dtype=source.dtype)


def _edge_strength(torch, functional, image):
    dx = functional.pad(
        (image[..., 1:] - image[..., :-1]).abs(),
        (0, 1, 0, 0),
    )
    dy = functional.pad(
        (image[..., 1:, :] - image[..., :-1, :]).abs(),
        (0, 0, 0, 1),
    )
    magnitude = torch.sqrt(dx.square() + dy.square() + 1e-8)
    return functional.max_pool2d(magnitude, 5, stride=1, padding=2)


def _minimum_area_support(functional, soft_mask, minimum_area: int):
    minimum_area = max(1, int(minimum_area))
    radius = max(1, min(8, math.ceil(math.sqrt(minimum_area) / 2.0)))
    kernel = radius * 2 + 1
    binary = (soft_mask > 0.05).to(dtype=soft_mask.dtype)
    local_count = (
        functional.avg_pool2d(
            binary,
            kernel_size=kernel,
            stride=1,
            padding=radius,
        )
        * float(kernel * kernel)
    )
    support = (local_count / float(minimum_area)).clamp(0.0, 1.0)
    return soft_mask * support


def _build_preview(torch, gray, mask):
    gray = gray[:, 0].clamp(0.0, 1.0)
    base = gray.unsqueeze(-1).repeat(1, 1, 1, 3) * 0.45
    base[..., 0] = torch.maximum(base[..., 0], mask * 0.95)
    base[..., 1] = base[..., 1] * (1.0 - mask * 0.75)
    base[..., 2] = base[..., 2] * (1.0 - mask * 0.75)
    return base.clamp(0.0, 1.0)


def _format_report(
    *,
    mode: str,
    profile: str,
    frame_rate: float,
    frame_scores: list[float],
    active_indices: list[int],
    skipped_scene_cuts: list[int],
    analysis_width: int,
    analysis_height: int,
    average_score: float,
    maximum_score: float,
) -> str:
    ranked = sorted(
        (
            (index, frame_scores[index])
            for index in active_indices
            if frame_scores[index] >= 1.0
        ),
        key=lambda item: item[1],
        reverse=True,
    )[:12]
    if ranked:
        problem_text = ", ".join(
            f"#{index} ({index / max(frame_rate, 0.001):.2f}s, "
            f"{score:.1f})"
            for index, score in ranked
        )
    else:
        problem_text = "none above score 1.0"
    cuts = ", ".join(f"#{index}" for index in skipped_scene_cuts[:16])
    if not cuts:
        cuts = "none"
    return (
        "VELVET VICE GHOST ANALYZER — optional v0.2.0\n"
        f"Mode: {mode}\n"
        f"Profile: {profile}\n"
        f"Analysis: {analysis_width}x{analysis_height}\n"
        f"Average ghost score: {average_score:.2f}\n"
        f"Maximum ghost score: {maximum_score:.2f}\n"
        f"Highest-scoring frames: {problem_text}\n"
        f"Scene-cut protected frames: {cuts}\n"
        "Red areas in the preview are eligible for selective temporal "
        "repair. A score is a detector confidence indicator, not a "
        "percentage of objectively damaged pixels."
    )


class VelvetViceLTXGhostAnalyzer:
    IMPLEMENTATION_VERSION = "0.2.0"

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "images": ("IMAGE", {"forceInput": True}),
                "mode": (ANALYSIS_MODES, {"default": "SOURCE 24 FPS"}),
                "profile": (
                    DETECTION_PROFILES,
                    {"default": "SAFE"},
                ),
                "frame_rate": (
                    "FLOAT",
                    {
                        "default": 24.0,
                        "min": 1.0,
                        "max": 240.0,
                        "step": 1.0,
                    },
                ),
                "sensitivity": (
                    "FLOAT",
                    {
                        "default": 1.0,
                        "min": 0.25,
                        "max": 2.0,
                        "step": 0.05,
                    },
                ),
                "analysis_long_edge": (
                    "INT",
                    {
                        "default": 256,
                        "min": 128,
                        "max": 512,
                        "step": 32,
                    },
                ),
                "motion_search_radius": (
                    "INT",
                    {
                        "default": 5,
                        "min": 1,
                        "max": 12,
                        "step": 1,
                    },
                ),
                "minimum_ghost_area": (
                    "INT",
                    {
                        "default": 24,
                        "min": 1,
                        "max": 512,
                        "step": 1,
                    },
                ),
                "scene_cut_protection": (
                    "BOOLEAN",
                    {"default": True},
                ),
                "scene_cut_threshold": (
                    "FLOAT",
                    {
                        "default": 0.24,
                        "min": 0.05,
                        "max": 0.75,
                        "step": 0.01,
                    },
                ),
                "analysis_chunk_size": (
                    "INT",
                    {
                        "default": 4,
                        "min": 1,
                        "max": 16,
                        "step": 1,
                    },
                ),
                "memory_mode": (MEMORY_MODES, {"default": "AUTO"}),
            }
        }

    RETURN_TYPES = (
        "VELVET_VICE_GHOST_ANALYSIS",
        "MASK",
        "IMAGE",
        "FLOAT",
        "FLOAT",
        "STRING",
    )
    RETURN_NAMES = (
        "ghost_analysis",
        "ghost_mask",
        "mask_preview",
        "average_score",
        "maximum_score",
        "analysis_report",
    )
    FUNCTION = "analyze"
    CATEGORY = "VELVET VICE/LTX/Experimental"
    DESCRIPTION = (
        "Experimental motion-compensated temporal ghost detector. It "
        "analyzes a low-resolution copy, protects endpoints and scene "
        "cuts, and never changes the input frames."
    )

    def analyze(
        self,
        images,
        mode,
        profile,
        frame_rate,
        sensitivity,
        analysis_long_edge,
        motion_search_radius,
        minimum_ghost_area,
        scene_cut_protection,
        scene_cut_threshold,
        analysis_chunk_size,
        memory_mode,
    ):
        if len(images.shape) != 4:
            raise ValueError(
                "VELVET VICE Ghost Analyzer expects IMAGE frames with "
                "shape [frames, height, width, channels]."
            )
        if int(images.shape[-1]) < 1:
            raise ValueError("The image batch contains no color channels.")

        try:
            import torch
            import torch.nn.functional as functional
        except ImportError as error:
            raise RuntimeError(
                "VELVET VICE Ghost Analyzer must run inside ComfyUI with "
                "PyTorch available."
            ) from error

        frame_count, height, width, _ = images.shape
        analysis_height, analysis_width = analysis_dimensions(
            height,
            width,
            analysis_long_edge,
        )
        compute_device = _resolve_compute_device(
            torch,
            images,
            memory_mode,
        )
        active = active_frame_indices(frame_count, str(mode))
        threshold = profile_threshold(profile, sensitivity)

        print(
            "[VELVET VICE] GHOST ANALYZER | "
            f"{int(frame_count)} frame(s), mode={mode}, "
            f"profile={profile}, analysis={analysis_width}x"
            f"{analysis_height}, device={compute_device}"
        )
        log_memory_snapshot("ghost analyzer start")

        gray = _downscale_grayscale(
            torch,
            functional,
            images,
            analysis_height,
            analysis_width,
            compute_device,
            analysis_chunk_size,
        )
        masks = torch.zeros(
            (int(frame_count), analysis_height, analysis_width),
            dtype=torch.float32,
            device="cpu",
        )
        flow_prev_dx = torch.zeros_like(masks, dtype=torch.int16)
        flow_prev_dy = torch.zeros_like(masks, dtype=torch.int16)
        flow_next_dx = torch.zeros_like(masks, dtype=torch.int16)
        flow_next_dy = torch.zeros_like(masks, dtype=torch.int16)
        frame_scores = [0.0] * int(frame_count)

        pair_delta = (
            (gray[1:] - gray[:-1]).abs().mean(dim=(1, 2, 3))
            if int(frame_count) > 1
            else torch.empty(0)
        )
        eligible = []
        skipped_scene_cuts = []
        for index in active:
            crosses_cut = bool(
                scene_cut_protection
                and (
                    float(pair_delta[index - 1]) > float(scene_cut_threshold)
                    or float(pair_delta[index]) > float(scene_cut_threshold)
                )
            )
            if crosses_cut:
                skipped_scene_cuts.append(index)
            else:
                eligible.append(index)

        with torch.inference_mode():
            for index_chunk in frame_ranges(
                eligible,
                analysis_chunk_size,
            ):
                index_tensor = torch.tensor(
                    index_chunk,
                    dtype=torch.int64,
                )
                current = gray[index_tensor].to(compute_device)
                previous = gray[index_tensor - 1].to(compute_device)
                following = gray[index_tensor + 1].to(compute_device)
                combined_target = torch.cat((current, current), dim=0)
                combined_source = torch.cat((previous, following), dim=0)

                dx, dy, best_cost, second_cost = _estimate_local_flow(
                    torch,
                    functional,
                    combined_target,
                    combined_source,
                    motion_search_radius,
                    2,
                )
                batch_size = len(index_chunk)
                prev_dx, next_dx = dx[:batch_size], dx[batch_size:]
                prev_dy, next_dy = dy[:batch_size], dy[batch_size:]
                prev_cost, next_cost = (
                    best_cost[:batch_size],
                    best_cost[batch_size:],
                )
                prev_second, next_second = (
                    second_cost[:batch_size],
                    second_cost[batch_size:],
                )
                aligned_prev, valid_prev = _integer_warp(
                    torch,
                    previous,
                    prev_dx,
                    prev_dy,
                )
                aligned_next, valid_next = _integer_warp(
                    torch,
                    following,
                    next_dx,
                    next_dy,
                )

                consensus = (aligned_prev + aligned_next) * 0.5
                residual = (current - consensus).abs()
                neighbor_gap = (aligned_prev - aligned_next).abs()
                agreement = torch.exp(-neighbor_gap * 10.0)
                edges = (
                    _edge_strength(torch, functional, current)
                    + _edge_strength(torch, functional, aligned_prev)
                    + _edge_strength(torch, functional, aligned_next)
                ) / 3.0
                edge_weight = (edges / (edges + 0.035)).clamp(0.0, 1.0)
                match_cost = (prev_cost + next_cost) * 0.5
                match_quality = (1.0 - match_cost / 0.18).clamp(0.0, 1.0)
                ambiguity_gap = (
                    (prev_second - prev_cost).clamp_min(0.0)
                    + (next_second - next_cost).clamp_min(0.0)
                ) / 2.0
                ambiguity_quality = (
                    ambiguity_gap / (ambiguity_gap + 0.006)
                ).clamp(0.15, 1.0)
                valid = valid_prev * valid_next
                raw_score = (
                    residual
                    * agreement
                    * edge_weight
                    * match_quality
                    * ambiguity_quality
                    * valid
                )
                soft_mask = (
                    (raw_score - threshold) / max(threshold * 1.5, 1e-6)
                ).clamp(0.0, 1.0)
                soft_mask = _minimum_area_support(
                    functional,
                    soft_mask,
                    minimum_ghost_area,
                )
                soft_mask = functional.max_pool2d(
                    soft_mask,
                    kernel_size=5,
                    stride=1,
                    padding=2,
                )
                soft_mask = functional.avg_pool2d(
                    soft_mask,
                    kernel_size=5,
                    stride=1,
                    padding=2,
                ).clamp(0.0, 1.0)

                for local_index, frame_index in enumerate(index_chunk):
                    frame_mask = soft_mask[local_index, 0]
                    flat = frame_mask.flatten()
                    top_count = max(1, int(flat.numel() * 0.05))
                    local_peak = float(
                        flat.topk(top_count).values.mean().detach().cpu()
                    )
                    local_mean = float(
                        frame_mask.mean().detach().cpu()
                    )
                    frame_scores[frame_index] = min(
                        100.0,
                        (local_peak * 0.75 + local_mean * 0.25) * 100.0,
                    )
                    masks[frame_index].copy_(
                        frame_mask.detach().to(device="cpu")
                    )
                    flow_prev_dx[frame_index].copy_(
                        prev_dx[local_index, 0].detach().to(device="cpu")
                    )
                    flow_prev_dy[frame_index].copy_(
                        prev_dy[local_index, 0].detach().to(device="cpu")
                    )
                    flow_next_dx[frame_index].copy_(
                        next_dx[local_index, 0].detach().to(device="cpu")
                    )
                    flow_next_dy[frame_index].copy_(
                        next_dy[local_index, 0].detach().to(device="cpu")
                    )

                del current
                del previous
                del following
                del combined_target
                del combined_source
                del dx
                del dy
                del best_cost
                del second_cost
                del aligned_prev
                del aligned_next

        analyzed_scores = [frame_scores[index] for index in eligible]
        average_score = (
            sum(analyzed_scores) / len(analyzed_scores)
            if analyzed_scores
            else 0.0
        )
        maximum_score = max(analyzed_scores, default=0.0)
        report = _format_report(
            mode=str(mode),
            profile=str(profile),
            frame_rate=float(frame_rate),
            frame_scores=frame_scores,
            active_indices=eligible,
            skipped_scene_cuts=skipped_scene_cuts,
            analysis_width=analysis_width,
            analysis_height=analysis_height,
            average_score=average_score,
            maximum_score=maximum_score,
        )
        preview = _build_preview(torch, gray, masks)
        analysis = {
            "schema": "VELVET_VICE_GHOST_ANALYSIS_V1",
            "implementation_version": self.IMPLEMENTATION_VERSION,
            "mode": str(mode),
            "profile": str(profile),
            "frame_rate": float(frame_rate),
            "frame_count": int(frame_count),
            "height": int(height),
            "width": int(width),
            "analysis_height": int(analysis_height),
            "analysis_width": int(analysis_width),
            "active_indices": eligible,
            "scene_cut_frames": skipped_scene_cuts,
            "mask": masks.to(dtype=torch.float16),
            "flow_prev_dx": flow_prev_dx,
            "flow_prev_dy": flow_prev_dy,
            "flow_next_dx": flow_next_dx,
            "flow_next_dy": flow_next_dy,
            "frame_scores": frame_scores,
            "average_score": float(average_score),
            "maximum_score": float(maximum_score),
            "report": report,
        }

        if getattr(compute_device, "type", "cpu") == "cuda":
            torch.cuda.empty_cache()
        log_memory_snapshot("ghost analyzer complete")
        print(
            "[VELVET VICE] GHOST ANALYZER | completed; "
            f"average={average_score:.2f}, maximum={maximum_score:.2f}"
        )
        return (
            analysis,
            masks,
            preview,
            float(average_score),
            float(maximum_score),
            report,
        )


def _validate_analysis(images, analysis):
    if not isinstance(analysis, dict):
        raise ValueError(
            "The connected input is not an VELVET VICE Ghost Analysis."
        )
    if analysis.get("schema") != "VELVET_VICE_GHOST_ANALYSIS_V1":
        raise ValueError(
            "Unsupported Ghost Analysis schema. Re-run the matching "
            "VELVET VICE Ghost Analyzer."
        )
    expected = (
        int(images.shape[0]),
        int(images.shape[1]),
        int(images.shape[2]),
    )
    actual = (
        int(analysis.get("frame_count", -1)),
        int(analysis.get("height", -1)),
        int(analysis.get("width", -1)),
    )
    if actual != expected:
        raise ValueError(
            "Ghost Analysis does not match the connected image batch: "
            f"analysis={actual}, images={expected}. Re-run the Analyzer."
        )


def _dense_warp(
    torch,
    functional,
    source,
    flow_dx,
    flow_dy,
    target_height: int,
    target_width: int,
):
    analysis_height = int(flow_dx.shape[-2])
    analysis_width = int(flow_dx.shape[-1])
    flow = torch.stack((flow_dx, flow_dy), dim=1).to(
        device=source.device,
        dtype=torch.float32,
    )
    flow = functional.interpolate(
        flow,
        size=(target_height, target_width),
        mode="bilinear",
        align_corners=False,
    )
    flow[:, 0] *= target_width / float(max(1, analysis_width))
    flow[:, 1] *= target_height / float(max(1, analysis_height))

    y = torch.arange(
        target_height,
        device=source.device,
        dtype=torch.float32,
    ).view(1, target_height, 1)
    x = torch.arange(
        target_width,
        device=source.device,
        dtype=torch.float32,
    ).view(1, 1, target_width)
    sample_x = x + flow[:, 0]
    sample_y = y + flow[:, 1]
    if target_width > 1:
        grid_x = sample_x * (2.0 / (target_width - 1)) - 1.0
    else:
        grid_x = torch.zeros_like(sample_x)
    if target_height > 1:
        grid_y = sample_y * (2.0 / (target_height - 1)) - 1.0
    else:
        grid_y = torch.zeros_like(sample_y)
    grid = torch.stack((grid_x, grid_y), dim=-1)
    warped = functional.grid_sample(
        source,
        grid,
        mode="bilinear",
        padding_mode="border",
        align_corners=True,
    )
    valid = (
        (sample_x >= 0.0)
        & (sample_x <= target_width - 1)
        & (sample_y >= 0.0)
        & (sample_y <= target_height - 1)
    ).unsqueeze(1)
    return warped, valid.to(dtype=source.dtype)


class VelvetViceLTXTemporalAntiGhost:
    IMPLEMENTATION_VERSION = "0.2.0"

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "images": ("IMAGE", {"forceInput": True}),
                "ghost_analysis": (
                    "VELVET_VICE_GHOST_ANALYSIS",
                    {"forceInput": True, "lazy": True},
                ),
                "enabled": ("BOOLEAN", {"default": True}),
                "strength": (
                    "FLOAT",
                    {
                        "default": 0.55,
                        "min": 0.0,
                        "max": 1.0,
                        "step": 0.05,
                    },
                ),
                "maximum_pixel_change": (
                    "FLOAT",
                    {
                        "default": 0.20,
                        "min": 0.02,
                        "max": 1.0,
                        "step": 0.01,
                    },
                ),
                "minimum_frame_score": (
                    "FLOAT",
                    {
                        "default": 1.0,
                        "min": 0.0,
                        "max": 100.0,
                        "step": 0.5,
                    },
                ),
                "memory_mode": (MEMORY_MODES, {"default": "AUTO"}),
            }
        }

    RETURN_TYPES = ("IMAGE", "STRING")
    RETURN_NAMES = ("corrected_images", "repair_report")
    FUNCTION = "repair"
    CATEGORY = "VELVET VICE/LTX/Experimental"
    DESCRIPTION = (
        "Selectively replaces only Analyzer-approved ghost regions with "
        "motion-aligned temporal consensus. Original endpoints, protected "
        "scene cuts, and RIFE anchor frames remain untouched."
    )

    def check_lazy_status(
        self,
        images,
        ghost_analysis=None,
        enabled=True,
        strength=0.55,
        maximum_pixel_change=0.20,
        minimum_frame_score=1.0,
        memory_mode="AUTO",
    ):
        del images
        del strength
        del maximum_pixel_change
        del minimum_frame_score
        del memory_mode
        if bool(enabled) and ghost_analysis is None:
            return ["ghost_analysis"]
        return []

    def repair(
        self,
        images,
        ghost_analysis,
        enabled,
        strength,
        maximum_pixel_change,
        minimum_frame_score,
        memory_mode,
    ):
        if not enabled or float(strength) <= 0.0:
            return (
                images,
                "VELVET VICE TEMPORAL ANTI-GHOST bypassed; input returned "
                "without allocation or modification.",
            )
        if len(images.shape) != 4:
            raise ValueError(
                "VELVET VICE Temporal Anti-Ghost expects IMAGE frames with "
                "shape [frames, height, width, channels]."
            )
        _validate_analysis(images, ghost_analysis)

        try:
            import torch
            import torch.nn.functional as functional
        except ImportError as error:
            raise RuntimeError(
                "VELVET VICE Temporal Anti-Ghost must run inside ComfyUI "
                "with PyTorch available."
            ) from error

        compute_device = _resolve_compute_device(
            torch,
            images,
            memory_mode,
        )
        output = images.clone()
        height = int(images.shape[1])
        width = int(images.shape[2])
        mask_bank = ghost_analysis["mask"]
        frame_scores = ghost_analysis["frame_scores"]
        eligible = [
            int(index)
            for index in ghost_analysis["active_indices"]
            if float(frame_scores[int(index)])
            >= float(minimum_frame_score)
            and float(mask_bank[int(index)].max()) > 0.0
        ]
        repaired = []

        print(
            "[VELVET VICE] TEMPORAL ANTI-GHOST | "
            f"{len(eligible)} eligible frame(s), strength={strength:.2f}, "
            f"device={compute_device}"
        )
        log_memory_snapshot("temporal anti-ghost start")
        with torch.inference_mode():
            for index in eligible:
                current = (
                    images[index : index + 1]
                    .movedim(-1, 1)
                    .to(device=compute_device, dtype=torch.float32)
                )
                previous = (
                    images[index - 1 : index]
                    .movedim(-1, 1)
                    .to(device=compute_device, dtype=torch.float32)
                )
                following = (
                    images[index + 1 : index + 2]
                    .movedim(-1, 1)
                    .to(device=compute_device, dtype=torch.float32)
                )
                aligned_prev, valid_prev = _dense_warp(
                    torch,
                    functional,
                    previous,
                    ghost_analysis["flow_prev_dx"][index : index + 1],
                    ghost_analysis["flow_prev_dy"][index : index + 1],
                    height,
                    width,
                )
                aligned_next, valid_next = _dense_warp(
                    torch,
                    functional,
                    following,
                    ghost_analysis["flow_next_dx"][index : index + 1],
                    ghost_analysis["flow_next_dy"][index : index + 1],
                    height,
                    width,
                )
                temporal_consensus = (aligned_prev + aligned_next) * 0.5
                mask = mask_bank[index : index + 1].unsqueeze(1).to(
                    device=compute_device,
                    dtype=torch.float32,
                )
                mask = functional.interpolate(
                    mask,
                    size=(height, width),
                    mode="bilinear",
                    align_corners=False,
                )
                alpha = (
                    mask
                    * valid_prev
                    * valid_next
                    * float(strength)
                ).clamp(0.0, 1.0)
                delta = (temporal_consensus - current).clamp(
                    -float(maximum_pixel_change),
                    float(maximum_pixel_change),
                )
                corrected = (current + delta * alpha).clamp(0.0, 1.0)
                output[index].copy_(
                    corrected[0]
                    .movedim(0, -1)
                    .to(device=output.device, dtype=output.dtype)
                )
                repaired.append(index)
                del current
                del previous
                del following
                del aligned_prev
                del aligned_next
                del temporal_consensus
                del mask
                del alpha
                del delta
                del corrected

        if getattr(compute_device, "type", "cpu") == "cuda":
            torch.cuda.empty_cache()
        log_memory_snapshot("temporal anti-ghost complete")
        if repaired:
            sample = ", ".join(f"#{index}" for index in repaired[:20])
            report = (
                "VELVET VICE TEMPORAL ANTI-GHOST — experimental "
                "v0.2.0\n"
                f"Repaired {len(repaired)} frame(s): {sample}\n"
                f"Mode: {ghost_analysis['mode']}\n"
                f"Strength: {float(strength):.2f}\n"
                f"Maximum pixel change: {float(maximum_pixel_change):.2f}\n"
                "Endpoints, scene-cut frames, low-confidence regions, and "
                "protected RIFE anchor frames were passed through unchanged."
            )
        else:
            report = (
                "VELVET VICE TEMPORAL ANTI-GHOST made no changes because "
                "no frame exceeded the selected confidence threshold."
            )
        print(
            "[VELVET VICE] TEMPORAL ANTI-GHOST | completed; "
            f"repaired {len(repaired)} frame(s)"
        )
        return output, report
