import base64
from io import BytesIO


def encode_comfy_images(images) -> list[str]:
    """Convert a ComfyUI IMAGE tensor or array to Ollama PNG payloads."""
    if images is None:
        return []

    try:
        import numpy as np
        from PIL import Image
    except ImportError as error:
        raise RuntimeError(
            "VELVET VICE requires NumPy and Pillow, which are normally "
            "included with ComfyUI."
        ) from error

    value = images
    if hasattr(value, "detach"):
        value = value.detach()
    if hasattr(value, "cpu"):
        value = value.cpu()
    if hasattr(value, "numpy"):
        value = value.numpy()

    array = np.asarray(value)
    if array.ndim == 3:
        array = array[None, ...]
    if array.ndim != 4:
        raise ValueError(
            "Expected a ComfyUI IMAGE with shape [batch, height, width, "
            f"channels], received shape {array.shape}."
        )

    encoded: list[str] = []
    for frame in array:
        pixels = np.clip(frame * 255.0, 0, 255).astype(np.uint8)
        if pixels.shape[-1] not in (1, 3, 4):
            raise ValueError(
                "Expected 1, 3, or 4 image channels, received "
                f"{pixels.shape[-1]}."
            )
        if pixels.shape[-1] == 1:
            pixels = pixels[..., 0]

        buffer = BytesIO()
        Image.fromarray(pixels).save(buffer, format="PNG")
        encoded.append(
            base64.b64encode(buffer.getvalue()).decode("utf-8")
        )
    return encoded
