from __future__ import annotations

import hashlib
import logging
import os
import threading
from pathlib import Path
from urllib.request import Request, urlopen


TAEH3_FILENAME = "taeh3_decoder.safetensors"
TAEH3_URL = (
    "https://github.com/simsim9-stack/ComfyUI-MiniMaxH3-PreviewOverride/"
    "raw/refs/heads/main/minivae/taeh3_decoder.safetensors"
)
TAEH3_SHA256 = "200B17F16FBDF2AFBD4F5C70B8390D57225BD2671EC17DFE162AD0E866DFF66C"
_MAX_DOWNLOAD_BYTES = 128 * 1024 * 1024
_DOWNLOAD_LOCK = threading.Lock()
_ATTEMPTED_THIS_PROCESS = False
_LAST_RESULT: tuple[bool, str] | None = None


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest().upper()


def _target_path() -> Path:
    import folder_paths  # type: ignore

    models_dir = Path(str(folder_paths.models_dir))
    return models_dir / "vae_approx" / TAEH3_FILENAME


def ensure_taeh3_decoder() -> tuple[bool, str]:
    """Install the optional H3 TAEHV preview decoder once, safely and lazily.

    The decoder is only fetched when the live-preview path asks for it.
    Existing files are never replaced automatically. A failed download is
    non-fatal; callers should continue with their normal latent2rgb fallback.
    """
    global _ATTEMPTED_THIS_PROCESS, _LAST_RESULT

    try:
        target = _target_path()
    except Exception as error:
        return False, f"TAEHV target path could not be resolved: {type(error).__name__}: {error}"

    if target.is_file():
        try:
            digest = _sha256(target)
        except Exception as error:
            return False, f"Existing TAEHV decoder could not be verified: {type(error).__name__}: {error}"
        if digest == TAEH3_SHA256:
            return True, f"TAEHV decoder already installed: {target}"
        return False, (
            f"{target} already exists but has a different SHA256. "
            "Velvet Vice will not overwrite it automatically."
        )

    with _DOWNLOAD_LOCK:
        if target.is_file():
            try:
                digest = _sha256(target)
            except Exception as error:
                return False, f"Existing TAEHV decoder could not be verified: {type(error).__name__}: {error}"
            if digest == TAEH3_SHA256:
                return True, f"TAEHV decoder already installed: {target}"
            return False, (
                f"{target} already exists but has a different SHA256. "
                "Velvet Vice will not overwrite it automatically."
            )

        if _ATTEMPTED_THIS_PROCESS:
            return _LAST_RESULT or (False, "TAEHV automatic download was already attempted in this ComfyUI session.")

        _ATTEMPTED_THIS_PROCESS = True
        target.parent.mkdir(parents=True, exist_ok=True)
        temp = target.with_name(
            f"{target.name}.download-{os.getpid()}-{threading.get_ident()}"
        )

        try:
            logging.info(
                "VELVET VICE H3 PREVIEW | TAEHV decoder missing; downloading verified preview decoder."
            )
            request = Request(
                TAEH3_URL,
                headers={"User-Agent": "VelvetViceMiniMaxH3/1.4.3"},
            )
            total = 0
            with urlopen(request, timeout=60) as response, temp.open("wb") as handle:
                while True:
                    chunk = response.read(1024 * 1024)
                    if not chunk:
                        break
                    total += len(chunk)
                    if total > _MAX_DOWNLOAD_BYTES:
                        raise RuntimeError("TAEHV download exceeded the 128 MiB safety limit.")
                    handle.write(chunk)

            digest = _sha256(temp)
            if digest != TAEH3_SHA256:
                raise RuntimeError(
                    f"SHA256 verification failed. Expected {TAEH3_SHA256}, got {digest}."
                )

            os.replace(temp, target)
            _LAST_RESULT = (True, f"TAEHV decoder installed automatically: {target}")
            logging.info("VELVET VICE H3 PREVIEW | %s", _LAST_RESULT[1])
            return _LAST_RESULT

        except Exception as error:
            _LAST_RESULT = (
                False,
                f"TAEHV automatic download failed: {type(error).__name__}: {error}",
            )
            logging.warning("VELVET VICE H3 PREVIEW | %s", _LAST_RESULT[1])
            return _LAST_RESULT
        finally:
            try:
                if temp.exists():
                    temp.unlink()
            except Exception:
                pass
