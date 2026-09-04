from ..services.memory_lifecycle import (
    log_memory_snapshot,
    unload_sampling_models_before_decode,
)


class VelvetViceLTXFP16VAEDecode:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "samples": ("LATENT", {"forceInput": True}),
                "vae": ("VAE", {"forceInput": True}),
            }
        }

    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("image",)
    FUNCTION = "decode"
    CATEGORY = "VELVET VICE/LTX"
    DESCRIPTION = (
        "Runs a full, non-tiled VAE decode while asking ComfyUI to "
        "allocate the decoded image buffer directly as FP16. VAE compute "
        "dtype, temporal context, frame order, and motion remain unchanged."
    )

    def decode(self, samples, vae):
        try:
            import torch
            from types import MethodType
        except ImportError as error:
            raise RuntimeError(
                "VELVET VICE FP16 Full VAE Decode must run inside "
                "ComfyUI with PyTorch available."
            ) from error

        output_dtype_method = getattr(vae, "vae_output_dtype", None)
        if not callable(output_dtype_method):
            raise RuntimeError(
                "This ComfyUI build does not expose VAE.vae_output_dtype(). "
                "Update ComfyUI before using VELVET VICE FP16 Full VAE "
                "Decode; a downstream FP16 conversion would recreate the "
                "RAM peak this node is designed to prevent."
            )

        latent = samples["samples"]
        if getattr(latent, "is_nested", False):
            latent = latent.unbind()[0]

        instance_attributes = getattr(vae, "__dict__", {})
        had_instance_override = "vae_output_dtype" in instance_attributes
        previous_instance_value = instance_attributes.get(
            "vae_output_dtype"
        )

        def fp16_output_dtype(_vae):
            return torch.float16

        log_memory_snapshot("before FP16 full video VAE decode")
        override_installed = False
        try:
            vae.vae_output_dtype = MethodType(fp16_output_dtype, vae)
            override_installed = True
            images = vae.decode(latent)
        finally:
            if override_installed:
                if had_instance_override:
                    vae.vae_output_dtype = previous_instance_value
                else:
                    delattr(vae, "vae_output_dtype")

        if getattr(images, "dtype", None) != torch.float16:
            raise RuntimeError(
                "ComfyUI returned a non-FP16 VAE output even though the "
                "FP16 output allocator was requested. No fallback copy was "
                "created because that could reproduce the 99% RAM peak. "
                "Update ComfyUI and retry."
            )

        if len(images.shape) == 5:
            images = images.reshape(
                -1,
                images.shape[-3],
                images.shape[-2],
                images.shape[-1],
            )

        print(
            "[VELVET VICE] FP16 FULL VAE | decoded full temporal "
            f"sequence directly to {images.dtype}"
        )
        log_memory_snapshot("after FP16 full video VAE decode")
        return (images,)


class VelvetViceLTXPreDecodeMemoryGate:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "video_latent": ("LATENT", {"forceInput": True}),
                "audio_latent": ("LATENT", {"forceInput": True}),
                "release_sampling_models": (
                    "BOOLEAN",
                    {"default": True},
                ),
            }
        }

    RETURN_TYPES = ("LATENT", "LATENT")
    RETURN_NAMES = ("video_latent", "audio_latent")
    FUNCTION = "release_before_decode"
    CATEGORY = "VELVET VICE/LTX"
    DESCRIPTION = (
        "Waits for the final video and audio latents, then releases "
        "tracked sampling models and GPU caches before VAE decoding."
    )

    @classmethod
    def IS_CHANGED(cls, **kwargs):
        return float("NaN")

    def release_before_decode(
        self,
        video_latent,
        audio_latent,
        release_sampling_models,
    ):
        log_memory_snapshot("pre-decode gate reached")
        if release_sampling_models:
            unload_sampling_models_before_decode()
        else:
            print(
                "[VELVET VICE] MEMORY | pre-decode sampling-model "
                "unload disabled"
            )
        return (video_latent, audio_latent)


class VelvetViceLTXImageMemoryCheckpoint:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": ("IMAGE", {"forceInput": True}),
                "checkpoint_label": (
                    "STRING",
                    {"default": "image checkpoint"},
                ),
            }
        }

    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("image",)
    FUNCTION = "checkpoint"
    CATEGORY = "VELVET VICE/LTX"
    DESCRIPTION = (
        "Logs a RAM/VRAM snapshot while passing the image through "
        "unchanged."
    )

    def checkpoint(self, image, checkpoint_label):
        log_memory_snapshot(str(checkpoint_label))
        return (image,)


class VelvetViceLTXAudioMemoryCheckpoint:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "audio": ("AUDIO", {"forceInput": True}),
                "checkpoint_label": (
                    "STRING",
                    {"default": "audio checkpoint"},
                ),
            }
        }

    RETURN_TYPES = ("AUDIO",)
    RETURN_NAMES = ("audio",)
    FUNCTION = "checkpoint"
    CATEGORY = "VELVET VICE/LTX"
    DESCRIPTION = (
        "Logs a RAM/VRAM snapshot while passing the audio through "
        "unchanged."
    )

    def checkpoint(self, audio, checkpoint_label):
        log_memory_snapshot(str(checkpoint_label))
        return (audio,)
