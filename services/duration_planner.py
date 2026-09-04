from __future__ import annotations

from dataclasses import dataclass
import json
import math
import re
from typing import Any, Iterable


_DEFAULT_SECONDS = 8.0
_DEFAULT_FPS = 24.0
_COMMON_FPS = (12, 15, 16, 18, 20, 23.976, 24, 25, 29.97, 30, 48, 50, 60)


def _number(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        value = float(value)
        return value if math.isfinite(value) else None
    if isinstance(value, str):
        text = value.strip().lower().replace(",", ".")
        match = re.fullmatch(r"[-+]?\d+(?:\.\d+)?", text)
        if match:
            try:
                value = float(text)
                return value if math.isfinite(value) else None
            except ValueError:
                return None
    return None


def _positive_int(value: Any) -> int | None:
    number = _number(value)
    if number is None or number <= 0:
        return None
    return int(round(number))


def _positive_float(value: Any) -> float | None:
    number = _number(value)
    if number is None or number <= 0:
        return None
    return float(number)


def _walk_dicts(value: Any) -> Iterable[dict[str, Any]]:
    if isinstance(value, dict):
        yield value
        for nested in value.values():
            yield from _walk_dicts(nested)
    elif isinstance(value, (list, tuple)):
        for nested in value:
            yield from _walk_dicts(nested)


def _lookup_numeric(mapping: dict[str, Any], names: tuple[str, ...]) -> float | None:
    normalized = {
        str(key).strip().lower().replace("-", "_").replace(" ", "_"): value
        for key, value in mapping.items()
    }
    for name in names:
        if name in normalized:
            result = _positive_float(normalized[name])
            if result is not None:
                return result
    return None


def _is_ltx_director(mapping: dict[str, Any]) -> bool:
    node_type = str(
        mapping.get("class_type")
        or mapping.get("type")
        or mapping.get("node_type")
        or ""
    ).lower()
    title = str(mapping.get("title") or "").lower()
    return "ltxdirector" in node_type.replace("_", "") or (
        "ltx director" in title and "length" in title
    )


def _runtime_duration(prompt: Any) -> tuple[int | None, float | None]:
    if not isinstance(prompt, dict):
        return None, None
    for node in prompt.values():
        if not isinstance(node, dict) or not _is_ltx_director(node):
            continue
        inputs = node.get("inputs")
        if not isinstance(inputs, dict):
            continue
        frames = _lookup_numeric(
            inputs,
            (
                "normaldurationframes",
                "normal_duration_frames",
                "duration_frames",
                "video_frames",
                "num_frames",
                "frames",
                "length_frames",
            ),
        )
        fps = _lookup_numeric(
            inputs,
            ("frame_rate", "framerate", "fps", "source_fps"),
        )
        seconds = _lookup_numeric(
            inputs,
            ("duration_seconds", "video_seconds", "seconds", "duration"),
        )
        frame_count = int(round(frames)) if frames else None
        if frame_count is None and seconds and fps:
            frame_count = int(round(seconds * fps))
        return frame_count, fps
    return None, None


def _workflow_from_extra(extra_pnginfo: Any) -> dict[str, Any] | None:
    if isinstance(extra_pnginfo, dict):
        workflow = extra_pnginfo.get("workflow")
        if isinstance(workflow, dict):
            return workflow
        # Some ComfyUI builds wrap metadata one level deeper.
        for mapping in _walk_dicts(extra_pnginfo):
            nodes = mapping.get("nodes")
            if isinstance(nodes, list):
                return mapping
    return None


def _json_widget_payload(values: list[Any]) -> dict[str, Any] | None:
    for value in values:
        if not isinstance(value, str):
            continue
        text = value.strip()
        if not text.startswith("{"):
            continue
        try:
            payload = json.loads(text)
        except json.JSONDecodeError:
            continue
        if isinstance(payload, dict) and (
            "normalDurationFrames" in payload or "segments" in payload
        ):
            return payload
    return None


def _fps_from_widgets(values: list[Any]) -> float | None:
    # In LTXDirector the source FPS widget is directly before the unit selector.
    for index, value in enumerate(values):
        if isinstance(value, str) and value.strip().lower() in {
            "seconds",
            "frames",
        }:
            for candidate in reversed(values[max(0, index - 5):index]):
                fps = _positive_float(candidate)
                if fps is not None and any(abs(fps - known) < 0.02 for known in _COMMON_FPS):
                    return fps
    # Conservative fallback: choose the last common FPS in the serialized widgets.
    candidates: list[float] = []
    for value in values:
        fps = _positive_float(value)
        if fps is not None and any(abs(fps - known) < 0.02 for known in _COMMON_FPS):
            candidates.append(fps)
    return candidates[-1] if candidates else None


def _frames_from_widget_payload(payload: dict[str, Any]) -> int | None:
    frames = _positive_int(payload.get("normalDurationFrames"))
    if frames:
        return frames
    segments = payload.get("segments")
    if isinstance(segments, list):
        end_frames: list[int] = []
        for segment in segments:
            if not isinstance(segment, dict):
                continue
            start = _positive_int(segment.get("start")) or 0
            length = _positive_int(segment.get("length"))
            if length:
                end_frames.append(start + length)
        if end_frames:
            return max(end_frames)
    return None


def _workflow_duration(extra_pnginfo: Any) -> tuple[int | None, float | None]:
    workflow = _workflow_from_extra(extra_pnginfo)
    if not workflow:
        return None, None
    nodes = workflow.get("nodes")
    if not isinstance(nodes, list):
        return None, None
    for node in nodes:
        if not isinstance(node, dict) or not _is_ltx_director(node):
            continue
        values = node.get("widgets_values")
        if not isinstance(values, list):
            values = []
        payload = _json_widget_payload(values)
        frames = _frames_from_widget_payload(payload or {})
        fps = _fps_from_widgets(values)
        if frames is None:
            # Current LTXDirector serializes frame counts at indices 4 and 5.
            for index in (4, 5):
                if index < len(values):
                    candidate = _positive_int(values[index])
                    if candidate and candidate >= 24:
                        frames = candidate
                        break
        return frames, fps
    return None, None


def _settings_duration(settings: str) -> float | None:
    if not isinstance(settings, str):
        return None
    match = re.search(
        r"(?im)^\s*DURATION\s*:\s*(\d+(?:[\.,]\d+)?)\s*(?:s|sec|seconds?)?\s*$",
        settings,
    )
    if not match:
        return None
    try:
        return float(match.group(1).replace(",", "."))
    except ValueError:
        return None


def duration_profile(seconds: float) -> tuple[str, int]:
    if seconds <= 6.0:
        return "COMPACT", 2
    if seconds <= 10.0:
        return "STANDARD", 3
    if seconds <= 16.0:
        return "DEVELOPED", 4
    if seconds <= 24.0:
        return "EXTENDED", 5
    return "LONG_FORM", min(8, max(6, int(math.ceil(seconds / 4.5))))


@dataclass(frozen=True)
class DurationContext:
    seconds: float
    frames: int
    fps: float
    source: str
    profile: str
    nominal_beats: int

    @property
    def fingerprint(self) -> str:
        return (
            f"{self.frames}:{self.fps:.3f}:{self.seconds:.3f}:"
            f"{self.source}:{self.profile}:{self.nominal_beats}"
        )

    def control_block(self) -> str:
        seconds = f"{self.seconds:.2f}".rstrip("0").rstrip(".")
        return (
            "\n\nVELVET VICE DURATION CONTROL — HARD WORKFLOW OVERRIDE\n"
            f"DETECTED_DURATION_SECONDS: {seconds}\n"
            f"SOURCE_FRAME_COUNT: {self.frames}\n"
            f"SOURCE_FRAME_RATE: {self.fps:g}\n"
            f"DURATION_PROFILE: {self.profile}\n"
            f"NOMINAL_DEVELOPMENT_BEATS: {self.nominal_beats}\n"
            f"DURATION_SOURCE: {self.source}\n"
            "This block overrides every editable or legacy DURATION line. "
            "Plan the complete motion arc for exactly this duration. A longer "
            "clip requires additional causal development, not repetition of "
            "one identical cycle and not random action accumulation."
        )


def resolve_duration_context(
    *,
    prompt: Any = None,
    extra_pnginfo: Any = None,
    full_auto_settings: str = "",
    explicit_seconds: float | None = None,
) -> DurationContext:
    requested_seconds = _positive_float(explicit_seconds)
    if requested_seconds is not None:
        fps = _DEFAULT_FPS
        frames = max(1, int(round(requested_seconds * fps)))
        profile, beats = duration_profile(requested_seconds)
        return DurationContext(
            seconds=float(requested_seconds),
            frames=frames,
            fps=fps,
            source="explicit_workflow_control",
            profile=profile,
            nominal_beats=beats,
        )

    frames, fps = _runtime_duration(prompt)
    source = "runtime_prompt"
    if frames is None:
        frames, workflow_fps = _workflow_duration(extra_pnginfo)
        fps = fps or workflow_fps
        source = "workflow_metadata"

    fps = fps or _DEFAULT_FPS
    if frames is None:
        seconds = _settings_duration(full_auto_settings)
        if seconds is not None and seconds > 0:
            frames = max(1, int(round(seconds * fps)))
            source = "settings_fallback"
        else:
            seconds = _DEFAULT_SECONDS
            frames = int(round(seconds * fps))
            source = "default_fallback"
    else:
        seconds = frames / fps

    profile, beats = duration_profile(seconds)
    return DurationContext(
        seconds=float(seconds),
        frames=int(frames),
        fps=float(fps),
        source=source,
        profile=profile,
        nominal_beats=beats,
    )
