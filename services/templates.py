from functools import lru_cache
from pathlib import Path


TEMPLATE_VERSION = "2026.09-v1.4.0-minimax-h3-native-i2va"
TEMPLATE_DIRECTORY = (
    Path(__file__).resolve().parent.parent
    / "resources"
    / "prompt_templates"
)


_SHARED_TEMPLATE_MARKERS = {
    "{{ADULT_POSITION_TAXONOMY}}": "adult_position_taxonomy.txt",
    "{{ADULT_ACTION_TAXONOMY}}": "adult_action_taxonomy.txt",
}


@lru_cache(maxsize=None)
def load_template(name: str) -> str:
    path = TEMPLATE_DIRECTORY / name
    if not path.is_file():
        raise RuntimeError(
            f"VELVET VICE prompt template is missing: {path}"
        )
    text = path.read_text(encoding="utf-8").rstrip("\n")
    for marker, shared_name in _SHARED_TEMPLATE_MARKERS.items():
        if marker not in text:
            continue
        shared_path = TEMPLATE_DIRECTORY / shared_name
        if not shared_path.is_file():
            raise RuntimeError(
                f"VELVET VICE shared prompt template is missing: {shared_path}"
            )
        shared_text = shared_path.read_text(encoding="utf-8").rstrip("\n")
        text = text.replace(marker, shared_text)
    return text
