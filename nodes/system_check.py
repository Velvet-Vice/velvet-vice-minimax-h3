from __future__ import annotations

import sys

from ..services.memory_lifecycle import log_memory_snapshot


REQUIRED_BF16_FLAGS = (
    "--fp8_e4m3fn-text-enc",
    "--fast-disk",
)

DANGEROUS_BF16_FLAGS = (
    "--gpu-only",
    "--highvram",
    "--disable-smart-memory",
    "--disable-dynamic-vram",
    "--disable-mmap",
)


def inspect_startup_policy(
    argv,
    ram_abort_percent,
    min_available_ram_gib,
):
    arguments = set(argv)
    snapshot = log_memory_snapshot("pre-LTX system check")
    missing = [
        flag for flag in REQUIRED_BF16_FLAGS if flag not in arguments
    ]
    dangerous = [
        flag for flag in DANGEROUS_BF16_FLAGS if flag in arguments
    ]
    memory_issues = []
    if (
        snapshot.ram_percent is not None
        and snapshot.ram_percent >= float(ram_abort_percent)
    ):
        memory_issues.append(
            f"RAM is already {snapshot.ram_percent:.1f}%"
        )
    if (
        snapshot.ram_available_gib is not None
        and snapshot.ram_available_gib
        < float(min_available_ram_gib)
    ):
        memory_issues.append(
            f"only {snapshot.ram_available_gib:.1f} GiB RAM is available"
        )
    return snapshot, missing, dangerous, memory_issues


class VelvetViceLTXSystemCheck:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "prompt": ("STRING", {"forceInput": True}),
                "strict_startup_flags": (
                    "BOOLEAN",
                    {"default": True},
                ),
                "ram_abort_percent": (
                    "FLOAT",
                    {
                        "default": 90.0,
                        "min": 70.0,
                        "max": 99.0,
                        "step": 0.5,
                    },
                ),
                "min_available_ram_gib": (
                    "FLOAT",
                    {
                        "default": 12.0,
                        "min": 4.0,
                        "max": 128.0,
                        "step": 1.0,
                    },
                ),
                "monitor_interval_seconds": (
                    "FLOAT",
                    {
                        "default": 1.0,
                        "min": 0.5,
                        "max": 10.0,
                        "step": 0.5,
                    },
                ),
                "warning_ram_percent": (
                    "FLOAT",
                    {
                        "default": 90.0,
                        "min": 60.0,
                        "max": 98.0,
                        "step": 0.5,
                    },
                ),
                "critical_ram_percent": (
                    "FLOAT",
                    {
                        "default": 96.0,
                        "min": 70.0,
                        "max": 99.5,
                        "step": 0.5,
                    },
                ),
            }
        }

    RETURN_TYPES = (
        "STRING",
        "VELVET_VICE_MEMORY_POLICY",
        "STRING",
    )
    RETURN_NAMES = (
        "prompt",
        "memory_policy",
        "status",
    )
    FUNCTION = "check"
    CATEGORY = "VELVET VICE/LTX"
    DESCRIPTION = (
        "Checks the BF16 LTX startup policy before any lazy render "
        "models are requested. It can stop the queue before the known "
        "RAM spike when required ComfyUI flags are missing."
    )

    @classmethod
    def IS_CHANGED(cls, **kwargs):
        return float("NaN")

    def check(
        self,
        prompt,
        strict_startup_flags,
        ram_abort_percent,
        min_available_ram_gib,
        monitor_interval_seconds,
        warning_ram_percent,
        critical_ram_percent,
    ):
        if critical_ram_percent <= warning_ram_percent:
            raise ValueError(
                "critical_ram_percent must be higher than "
                "warning_ram_percent."
            )

        snapshot, missing, dangerous, memory_issues = (
            inspect_startup_policy(
                sys.argv[1:],
                ram_abort_percent,
                min_available_ram_gib,
            )
        )
        issues = []
        if missing:
            issues.append(
                "missing startup flag(s): " + ", ".join(missing)
            )
        if dangerous:
            issues.append(
                "unsafe BF16 flag(s): " + ", ".join(dangerous)
            )
        issues.extend(memory_issues)

        if issues and strict_startup_flags:
            raise RuntimeError(
                "[VELVET VICE] BF16 preflight stopped LTX before "
                "model loading: "
                + "; ".join(issues)
                + ". Add --fp8_e4m3fn-text-enc --fast-disk to the "
                "ComfyUI launch command and remove unsafe flags."
            )

        if issues:
            status = "BF16 preflight warning: " + "; ".join(issues)
            print(f"WARNING: [VELVET VICE] {status}")
        else:
            status = (
                "BF16 preflight passed: FP8 text encoder and Fast Disk "
                f"active; {snapshot.format()}"
            )
            print(f"[VELVET VICE] {status}")

        policy = {
            "schema": "VELVET_VICE_MEMORY_POLICY",
            "monitor_interval_seconds": float(
                monitor_interval_seconds
            ),
            "warning_ram_percent": float(warning_ram_percent),
            "critical_ram_percent": float(critical_ram_percent),
            "startup_flags_ok": not missing and not dangerous,
            "preflight_status": status,
        }
        return (prompt, policy, status)
