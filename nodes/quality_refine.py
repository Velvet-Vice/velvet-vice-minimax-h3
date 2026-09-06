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


class VelvetViceMiniMaxH3AVRefineReencodeMerge:
    """Advanced helper: preserve pass-1 audio even when pass 2 starts from a re-encoded video-only latent."""

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
        "Quality Refine helper. It restores pass-1 audio even when "
        "the refine path decodes, upscales and re-encodes the pass-1 video before pass 2."
    )

    def merge(self, base_latent, refined_latent, preserve_base_audio=True):
        if not bool(preserve_base_audio):
            return (refined_latent,)

        base_samples = (base_latent or {}).get("samples") if isinstance(base_latent, dict) else None
        refined_samples = (refined_latent or {}).get("samples") if isinstance(refined_latent, dict) else None
        if base_samples is None or refined_samples is None:
            return (refined_latent,)

        try:
            import comfy.nested_tensor

            if not getattr(base_samples, "is_nested", False):
                return (refined_latent,)

            base_parts = list(base_samples.unbind())
            if len(base_parts) < 2:
                return (refined_latent,)
            base_audio = base_parts[1]

            out = dict(refined_latent)
            if getattr(refined_samples, "is_nested", False):
                refined_parts = list(refined_samples.unbind())
                if len(refined_parts) >= 2:
                    refined_parts[1] = base_audio
                else:
                    refined_parts = [refined_parts[0], base_audio]
                out["samples"] = comfy.nested_tensor.NestedTensor(refined_parts)
                return (out,)

            # Re-encoded/refined path can be video-only. Rebuild the expected
            # [video, audio] NestedTensor using the refined video tensor plus the
            # original pass-1 audio tensor.
            out["samples"] = comfy.nested_tensor.NestedTensor([refined_samples, base_audio])
            return (out,)
        except Exception as exc:
            print(
                "WARNING: [VELVET VICE] Re-encode merge could not restore pass-1 H3 audio; "
                f"using refined latent as-is: {exc}"
            )
            return (refined_latent,)


class VelvetViceMiniMaxH3RefineResolutionPlan:
    """Advanced helper: scale H3 video geometry and snap it to the model's 32 px canvas grid."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "width": ("INT", {"default": 1344, "min": 32, "max": 8192, "step": 32}),
                "height": ("INT", {"default": 768, "min": 32, "max": 8192, "step": 32}),
                "scale": ("FLOAT", {"default": 1.25, "min": 1.0, "max": 2.0, "step": 0.05}),
            }
        }

    RETURN_TYPES = ("INT", "INT", "STRING")
    RETURN_NAMES = ("width", "height", "status")
    FUNCTION = "plan"
    CATEGORY = "VELVET VICE/MiniMax H3/Internal"

    def plan(self, width, height, scale):
        scale = max(1.0, min(2.0, float(scale)))
        w = max(32, int(round((int(width) * scale) / 32.0) * 32))
        h = max(32, int(round((int(height) * scale) / 32.0) * 32))
        return (w, h, f"RE-ENCODE TARGET {w}x{h} · ×{scale:.2f}")


class VelvetViceMiniMaxH3ImageResizeExact:
    """Advanced helper: exact Lanczos resize for an IMAGE batch/video sequence."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "images": ("IMAGE",),
                "width": ("INT", {"default": 1344, "min": 32, "max": 8192, "step": 32}),
                "height": ("INT", {"default": 768, "min": 32, "max": 8192, "step": 32}),
            }
        }

    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("images",)
    FUNCTION = "resize"
    CATEGORY = "VELVET VICE/MiniMax H3/Internal"

    def resize(self, images, width, height):
        import comfy.utils
        x = images[..., :3].movedim(-1, 1)
        x = comfy.utils.common_upscale(x, int(width), int(height), "lanczos", "disabled")
        return (x.movedim(1, -1),)


class VelvetViceMiniMaxH3ReencodeAVPrepare:
    """Rebuild a valid H3 [video,audio] NestedTensor before the second sampler."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "base_latent": ("LATENT",),
                "reencoded_video_latent": ("LATENT",),
            }
        }

    RETURN_TYPES = ("LATENT",)
    RETURN_NAMES = ("latent",)
    FUNCTION = "prepare"
    CATEGORY = "VELVET VICE/MiniMax H3/Internal"
    DESCRIPTION = (
        "Advanced re-encode helper. H3 sampling requires a NestedTensor pair "
        "of video and audio. This replaces only the video stream with the re-encoded "
        "higher-resolution video latent and carries the pass-1 audio stream forward."
    )

    def prepare(self, base_latent, reencoded_video_latent):
        base_samples = (base_latent or {}).get("samples") if isinstance(base_latent, dict) else None
        video_samples = (reencoded_video_latent or {}).get("samples") if isinstance(reencoded_video_latent, dict) else None
        if base_samples is None or video_samples is None:
            raise RuntimeError("[VELVET VICE] Re-encode refine requires both base AV latent and re-encoded video latent.")
        if not getattr(base_samples, "is_nested", False):
            raise RuntimeError("[VELVET VICE] Re-encode refine expected the pass-1 MiniMax H3 AV NestedTensor.")

        base_parts = list(base_samples.unbind())
        if len(base_parts) < 2:
            raise RuntimeError("[VELVET VICE] Pass-1 H3 latent has no audio stream; cannot build a valid H3 AV latent for pass 2.")

        if getattr(video_samples, "is_nested", False):
            parts = list(video_samples.unbind())
            if not parts:
                raise RuntimeError("[VELVET VICE] Re-encoded H3 video latent is empty.")
            video_samples = parts[0]

        import comfy.nested_tensor
        out = dict(reencoded_video_latent)
        out["samples"] = comfy.nested_tensor.NestedTensor([video_samples, base_parts[1]])
        return (out,)


class VelvetViceMiniMaxH3ConditioningRefineSwitch:
    """Lazy conditioning selector for direct-latent vs re-encoded-resolution refine paths."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "enabled": ("BOOLEAN", {"default": False}),
                "base_conditioning": ("CONDITIONING", {"forceInput": True, "lazy": True}),
                "refined_conditioning": ("CONDITIONING", {"forceInput": True, "lazy": True}),
            }
        }

    RETURN_TYPES = ("CONDITIONING",)
    RETURN_NAMES = ("conditioning",)
    FUNCTION = "select"
    CATEGORY = "VELVET VICE/MiniMax H3/Internal"

    @classmethod
    def check_lazy_status(cls, enabled, base_conditioning=None, refined_conditioning=None):
        if bool(enabled):
            return ["refined_conditioning"] if refined_conditioning is None else []
        return ["base_conditioning"] if base_conditioning is None else []

    def select(self, enabled, base_conditioning=None, refined_conditioning=None):
        if bool(enabled):
            if refined_conditioning is None:
                raise RuntimeError("[VELVET VICE] Re-encode refine conditioning is unavailable.")
            return (refined_conditioning,)
        if base_conditioning is None:
            raise RuntimeError("[VELVET VICE] Base H3 conditioning is unavailable.")
        return (base_conditioning,)
