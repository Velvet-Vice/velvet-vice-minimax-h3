from __future__ import annotations

import gc
import threading
import time
from dataclasses import dataclass
from typing import Any


GIB = 1024**3


@dataclass(frozen=True)
class MemorySnapshot:
    label: str
    ram_percent: float | None
    ram_available_gib: float | None
    process_rss_gib: float | None
    vram_free_gib: float | None
    vram_total_gib: float | None

    def format(self) -> str:
        fields = [self.label]
        if self.ram_percent is not None:
            fields.append(f"RAM {self.ram_percent:.1f}%")
        if self.ram_available_gib is not None:
            fields.append(
                f"{self.ram_available_gib:.1f} GiB RAM available"
            )
        if self.process_rss_gib is not None:
            fields.append(
                f"ComfyUI RSS {self.process_rss_gib:.1f} GiB"
            )
        if (
            self.vram_free_gib is not None
            and self.vram_total_gib is not None
        ):
            fields.append(
                f"VRAM free {self.vram_free_gib:.1f}/"
                f"{self.vram_total_gib:.1f} GiB"
            )
        return " | ".join(fields)


@dataclass(frozen=True)
class ComfyUnloadResult:
    loaded_model_count: int
    before: MemorySnapshot
    after: MemorySnapshot

    def summary(self) -> str:
        return (
            f"pre-Qwen ComfyUI unload completed "
            f"({self.loaded_model_count} tracked model(s)); "
            f"{self.after.format()}"
        )


@dataclass(frozen=True)
class RenderMonitorSummary:
    duration_seconds: float
    samples: int
    peak_ram_percent: float | None
    minimum_ram_available_gib: float | None
    minimum_vram_free_gib: float | None

    def format(self) -> str:
        fields = [
            f"duration {self.duration_seconds:.1f}s",
            f"{self.samples} sample(s)",
        ]
        if self.peak_ram_percent is not None:
            fields.append(f"peak RAM {self.peak_ram_percent:.1f}%")
        if self.minimum_ram_available_gib is not None:
            fields.append(
                f"minimum RAM available "
                f"{self.minimum_ram_available_gib:.1f} GiB"
            )
        if self.minimum_vram_free_gib is not None:
            fields.append(
                f"minimum VRAM free "
                f"{self.minimum_vram_free_gib:.1f} GiB"
            )
        return " | ".join(fields)


class RenderMemoryMonitor:
    def __init__(
        self,
        interval_seconds: float,
        warning_ram_percent: float,
        critical_ram_percent: float,
    ):
        self.interval_seconds = max(0.5, float(interval_seconds))
        self.warning_ram_percent = float(warning_ram_percent)
        self.critical_ram_percent = float(critical_ram_percent)
        self.started_at = time.monotonic()
        self._stop_event = threading.Event()
        self._thread: threading.Thread | None = None
        self._samples = 0
        self._peak_ram_percent: float | None = None
        self._minimum_ram_available_gib: float | None = None
        self._minimum_vram_free_gib: float | None = None
        self._last_logged_band = "normal"
        self._lock = threading.Lock()

    def start(self) -> None:
        self._sample("render monitor start", force_log=True)
        self._thread = threading.Thread(
            target=self._run,
            name="VelvetViceH3MemoryMonitor",
            daemon=True,
        )
        self._thread.start()

    def stop(self) -> RenderMonitorSummary:
        self._stop_event.set()
        if self._thread is not None:
            self._thread.join(timeout=max(2.0, self.interval_seconds * 2))
        self._sample("render monitor stop", force_log=True)
        with self._lock:
            return RenderMonitorSummary(
                duration_seconds=time.monotonic() - self.started_at,
                samples=self._samples,
                peak_ram_percent=self._peak_ram_percent,
                minimum_ram_available_gib=(
                    self._minimum_ram_available_gib
                ),
                minimum_vram_free_gib=self._minimum_vram_free_gib,
            )

    def _run(self) -> None:
        while not self._stop_event.wait(self.interval_seconds):
            self._sample("render monitor")

    def _sample(self, label: str, force_log: bool = False) -> None:
        snapshot = take_memory_snapshot(label)
        band = self._pressure_band(snapshot.ram_percent)
        new_peak = False
        with self._lock:
            self._samples += 1
            if snapshot.ram_percent is not None and (
                self._peak_ram_percent is None
                or snapshot.ram_percent > self._peak_ram_percent
            ):
                new_peak = (
                    self._peak_ram_percent is None
                    or snapshot.ram_percent
                    >= self._peak_ram_percent + 1.0
                )
                self._peak_ram_percent = snapshot.ram_percent
            if snapshot.ram_available_gib is not None and (
                self._minimum_ram_available_gib is None
                or snapshot.ram_available_gib
                < self._minimum_ram_available_gib
            ):
                self._minimum_ram_available_gib = (
                    snapshot.ram_available_gib
                )
            if snapshot.vram_free_gib is not None and (
                self._minimum_vram_free_gib is None
                or snapshot.vram_free_gib < self._minimum_vram_free_gib
            ):
                self._minimum_vram_free_gib = snapshot.vram_free_gib
            band_changed = band != self._last_logged_band
            self._last_logged_band = band

        if force_log or band_changed or (new_peak and band != "normal"):
            prefix = {
                "normal": "MEMORY",
                "warning": "MEMORY WARNING",
                "critical": "MEMORY CRITICAL",
            }[band]
            print(f"[VELVET VICE] {prefix} | {snapshot.format()}")

    def _pressure_band(self, ram_percent: float | None) -> str:
        if ram_percent is None:
            return "normal"
        if ram_percent >= self.critical_ram_percent:
            return "critical"
        if ram_percent >= self.warning_ram_percent:
            return "warning"
        return "normal"


_MONITOR_LOCK = threading.Lock()
_ACTIVE_RENDER_MONITOR: RenderMemoryMonitor | None = None
_INTERRUPT_CLEANUP_LOCK = threading.Lock()


def _psutil_snapshot() -> tuple[
    float | None,
    float | None,
    float | None,
]:
    try:
        import psutil

        virtual = psutil.virtual_memory()
        process = psutil.Process()
        return (
            float(virtual.percent),
            float(virtual.available) / GIB,
            float(process.memory_info().rss) / GIB,
        )
    except (ImportError, OSError, RuntimeError):
        return (None, None, None)


def _vram_snapshot() -> tuple[float | None, float | None]:
    try:
        import comfy.model_management as model_management

        device = model_management.get_torch_device()
        total = float(model_management.get_total_memory(device))
        free = float(model_management.get_free_memory(device))
        return (free / GIB, total / GIB)
    except (ImportError, AttributeError, RuntimeError, TypeError):
        return (None, None)


def take_memory_snapshot(label: str) -> MemorySnapshot:
    ram_percent, ram_available, process_rss = _psutil_snapshot()
    vram_free, vram_total = _vram_snapshot()
    return MemorySnapshot(
        label=str(label),
        ram_percent=ram_percent,
        ram_available_gib=ram_available,
        process_rss_gib=process_rss,
        vram_free_gib=vram_free,
        vram_total_gib=vram_total,
    )


def log_memory_snapshot(label: str) -> MemorySnapshot:
    snapshot = take_memory_snapshot(label)
    print(f"[VELVET VICE] MEMORY | {snapshot.format()}")
    return snapshot


def unload_comfy_models_before_ollama() -> ComfyUnloadResult:
    try:
        import comfy.model_management as model_management
    except ImportError as error:
        raise RuntimeError(
            "ComfyUI model management is unavailable. The Prompt Director "
            "must run inside ComfyUI."
        ) from error

    before = log_memory_snapshot("before pre-Qwen unload")
    try:
        loaded_models: list[Any] = list(
            model_management.loaded_models()
        )
        model_management.unload_all_models()
        gc.collect()
        model_management.soft_empty_cache()
    except (AttributeError, RuntimeError) as error:
        raise RuntimeError(
            "Could not unload ComfyUI models before starting Ollama/Qwen."
        ) from error

    after = log_memory_snapshot("after pre-Qwen unload")
    result = ComfyUnloadResult(len(loaded_models), before, after)
    print(f"[VELVET VICE] MEMORY | {result.summary()}")
    return result


def start_render_memory_monitor(
    interval_seconds: float = 1.0,
    warning_ram_percent: float = 90.0,
    critical_ram_percent: float = 96.0,
) -> RenderMemoryMonitor:
    global _ACTIVE_RENDER_MONITOR
    with _MONITOR_LOCK:
        if _ACTIVE_RENDER_MONITOR is not None:
            summary = _ACTIVE_RENDER_MONITOR.stop()
            print(
                "[VELVET VICE] MEMORY | Replaced unfinished monitor: "
                f"{summary.format()}"
            )
        monitor = RenderMemoryMonitor(
            interval_seconds,
            warning_ram_percent,
            critical_ram_percent,
        )
        _ACTIVE_RENDER_MONITOR = monitor
        monitor.start()
        return monitor


def stop_render_memory_monitor() -> RenderMonitorSummary | None:
    global _ACTIVE_RENDER_MONITOR
    with _MONITOR_LOCK:
        monitor = _ACTIVE_RENDER_MONITOR
        _ACTIVE_RENDER_MONITOR = None
    if monitor is None:
        return None
    summary = monitor.stop()
    print(
        "[VELVET VICE] MEMORY | Render session summary: "
        f"{summary.format()}"
    )
    return summary


def cleanup_comfy_models_after_render() -> ComfyUnloadResult:
    try:
        import comfy.model_management as model_management
    except ImportError as error:
        raise RuntimeError(
            "ComfyUI model management is unavailable. Final cleanup "
            "must run inside ComfyUI."
        ) from error

    before = log_memory_snapshot("before final render cleanup")
    try:
        loaded_models: list[Any] = list(
            model_management.loaded_models()
        )
        model_management.unload_all_models()
        gc.collect()
        model_management.soft_empty_cache()
    except (AttributeError, RuntimeError) as error:
        raise RuntimeError(
            "Could not unload ComfyUI models after the MiniMax H3 render."
        ) from error

    after = log_memory_snapshot("after final render cleanup")
    result = ComfyUnloadResult(len(loaded_models), before, after)
    print(
        "[VELVET VICE] MEMORY | final MiniMax H3 cleanup completed "
        f"({result.loaded_model_count} tracked model(s)); "
        f"{result.after.format()}"
    )
    return result


def cleanup_comfy_models_after_interruption() -> ComfyUnloadResult:
    """Immediately release tracked models after a cancelled VV prompt."""
    try:
        import comfy.model_management as model_management
    except ImportError as error:
        raise RuntimeError(
            "ComfyUI model management is unavailable. Interrupted-render "
            "cleanup must run inside ComfyUI."
        ) from error

    with _INTERRUPT_CLEANUP_LOCK:
        stop_render_memory_monitor()
        before = log_memory_snapshot("before interrupted-render cleanup")
        try:
            loaded_model_count = len(model_management.loaded_models())
            model_management.unload_all_models()
            gc.collect()
            model_management.soft_empty_cache(force=True)
        except (AttributeError, RuntimeError) as error:
            raise RuntimeError(
                "Could not release ComfyUI models after the interrupted "
                "Velvet Vice render."
            ) from error

        after = log_memory_snapshot("after interrupted-render cleanup")
        result = ComfyUnloadResult(
            loaded_model_count,
            before,
            after,
        )
        print(
            "[VELVET VICE] INTERRUPT CLEANUP | unloaded "
            f"{result.loaded_model_count} tracked model(s); "
            f"{result.after.format()}"
        )
        return result


def unload_sampling_models_before_decode() -> ComfyUnloadResult:
    """Release tracked sampling models before video/audio VAE decoding."""
    try:
        import comfy.model_management as model_management
    except ImportError as error:
        raise RuntimeError(
            "ComfyUI model management is unavailable. The pre-decode "
            "memory gate must run inside ComfyUI."
        ) from error

    before = log_memory_snapshot("before pre-decode model unload")
    try:
        loaded_models: list[Any] = list(
            model_management.loaded_models()
        )
        model_management.unload_all_models()
        gc.collect()
        model_management.soft_empty_cache()
    except (AttributeError, RuntimeError) as error:
        raise RuntimeError(
            "Could not release sampling models before the VAE decode."
        ) from error

    after = log_memory_snapshot("after pre-decode model unload")
    result = ComfyUnloadResult(len(loaded_models), before, after)
    print(
        "[VELVET VICE] MEMORY | pre-decode sampling-model unload "
        f"completed ({result.loaded_model_count} tracked model(s)); "
        f"{result.after.format()}"
    )
    return result
