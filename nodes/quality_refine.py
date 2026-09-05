from __future__ import annotations


class VelvetViceMiniMaxH3AVRefineMerge:
    """Internal helper: use refined video latent while optionally preserving pass-1 audio."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "base_latent": ("LATENT",),
                "refined_latent": ("LATENT",),
                "preserve_base_audio": ("BOOLEAN", {"default": True}),
            }
        }

    RETURN_TYPES = ("LATENT",)
    RETURN_NAMES = ("latent",)
    FUNCTION = "merge"
    CATEGORY = "VELVET VICE/MiniMax H3/Internal"
    DESCRIPTION = (
        "Internal Quality Refine helper. When Preserve Base Audio is enabled, "
        "the refined video latent is combined with the untouched audio latent from pass 1."
    )

    def merge(self, base_latent, refined_latent, preserve_base_audio=True):
        if not bool(preserve_base_audio):
            return (refined_latent,)

        base_samples = (base_latent or {}).get("samples") if isinstance(base_latent, dict) else None
        refined_samples = (refined_latent or {}).get("samples") if isinstance(refined_latent, dict) else None

        if not (
            getattr(base_samples, "is_nested", False)
            and getattr(refined_samples, "is_nested", False)
        ):
            return (refined_latent,)

        base_parts = list(base_samples.unbind())
        refined_parts = list(refined_samples.unbind())
        if len(base_parts) < 2 or len(refined_parts) < 2:
            return (refined_latent,)

        try:
            import comfy.nested_tensor

            out = dict(refined_latent)
            merged = list(refined_parts)
            # Official MiniMax H3 AV NestedTensor order: [video, audio].
            merged[1] = base_parts[1]
            out["samples"] = comfy.nested_tensor.NestedTensor(merged)
            return (out,)
        except Exception as exc:
            print(
                "WARNING: [VELVET VICE] Could not restore pass-1 H3 audio; "
                f"using refined AV latent: {exc}"
            )
            return (refined_latent,)


class VelvetViceMiniMaxH3LatentRefineSwitch:
    """Internal lazy selector. OFF means the pass-2 branch is never requested."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "enabled": ("BOOLEAN", {"default": False}),
                "base_latent": ("LATENT", {"forceInput": True, "lazy": True}),
                "refined_latent": ("LATENT", {"forceInput": True, "lazy": True}),
            }
        }

    RETURN_TYPES = ("LATENT",)
    RETURN_NAMES = ("latent",)
    FUNCTION = "select"
    CATEGORY = "VELVET VICE/MiniMax H3/Internal"
    DESCRIPTION = (
        "Internal lazy switch for Quality Refine. With Quality Refine OFF, "
        "only the original H3 sampler path executes."
    )

    @classmethod
    def check_lazy_status(cls, enabled, base_latent=None, refined_latent=None):
        if bool(enabled):
            return ["refined_latent"] if refined_latent is None else []
        return ["base_latent"] if base_latent is None else []

    def select(self, enabled, base_latent=None, refined_latent=None):
        if bool(enabled):
            if refined_latent is None:
                raise RuntimeError(
                    "[VELVET VICE] Quality Refine is enabled but the pass-2 latent is unavailable."
                )
            return (refined_latent,)

        if base_latent is None:
            raise RuntimeError(
                "[VELVET VICE] Quality Refine bypass has no pass-1 latent."
            )
        return (base_latent,)
