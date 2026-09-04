from __future__ import annotations

import logging
from functools import wraps
from typing import Any

from .memory_lifecycle import cleanup_comfy_models_after_interruption


_PATCH_MARKER = "_velvet_vice_interrupt_cleanup_v124"


def prompt_uses_velvet_vice(prompt: Any) -> bool:
    if not isinstance(prompt, dict):
        return False
    for node in prompt.values():
        if not isinstance(node, dict):
            continue
        class_type = str(node.get("class_type", ""))
        if class_type.startswith("VelvetVice"):
            return True
    return False


def execution_was_interrupted(executor: Any) -> bool:
    for message in getattr(executor, "status_messages", ()):
        if isinstance(message, (tuple, list)) and message:
            if message[0] == "execution_interrupted":
                return True
    return False


def install_interruption_cleanup_hook(
    executor_class: type | None = None,
) -> bool:
    """Install one interruption-only cleanup around PromptExecutor."""
    if executor_class is None:
        try:
            import execution
        except ImportError:
            return False
        executor_class = getattr(execution, "PromptExecutor", None)

    if executor_class is None:
        return False
    if getattr(executor_class, _PATCH_MARKER, False):
        return True

    original = getattr(executor_class, "execute_async", None)
    if original is None:
        return False

    @wraps(original)
    async def execute_async_with_interrupt_cleanup(
        executor,
        prompt,
        prompt_id,
        *args,
        **kwargs,
    ):
        try:
            return await original(
                executor,
                prompt,
                prompt_id,
                *args,
                **kwargs,
            )
        finally:
            should_cleanup = (
                prompt_uses_velvet_vice(prompt)
                and execution_was_interrupted(executor)
            )
            if should_cleanup:
                try:
                    cleanup_comfy_models_after_interruption()
                except Exception:
                    logging.exception(
                        "VELVET VICE interrupted-render VRAM cleanup failed"
                    )

    setattr(
        executor_class,
        "_velvet_vice_original_execute_async",
        original,
    )
    setattr(executor_class, "execute_async", execute_async_with_interrupt_cleanup)
    setattr(executor_class, _PATCH_MARKER, True)
    logging.info(
        "VELVET VICE interruption-only VRAM cleanup hook installed"
    )
    return True
