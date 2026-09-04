from __future__ import annotations

import hashlib
import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable

try:
    import folder_paths  # type: ignore
except Exception:  # pragma: no cover
    folder_paths = None

PROFILE_SCHEMA_VERSION = 1
STATE_SCHEMA_VERSION = 1
VALID_SCOPES = {"h3", "lora"}
VALID_STATE_NAMES = {"system_hub", "director", "output_hub"}


def _user_root() -> Path:
    override = os.environ.get("VELVET_VICE_USER_DIR")
    if override:
        return Path(override).expanduser().resolve()
    if folder_paths is not None:
        getter = getattr(folder_paths, "get_user_directory", None)
        if callable(getter):
            try:
                root = Path(getter())
                # Standard portable installs expose ComfyUI/user here. Keep
                # Velvet Vice data under default so package updates never touch it.
                return root / "default" / "velvet_vice"
            except Exception:
                pass
        base_path = getattr(folder_paths, "base_path", None)
        if base_path:
            return Path(base_path) / "user" / "default" / "velvet_vice"
    return Path.home() / ".velvet_vice"


def profile_directory(scope: str) -> Path:
    scope = str(scope or "h3").lower()
    if scope not in VALID_SCOPES:
        raise ValueError(f"Unsupported profile scope: {scope}")
    directory = _user_root() / "profiles" / scope
    directory.mkdir(parents=True, exist_ok=True)
    return directory


def _profile_name(name: Any) -> str:
    value = str(name or "").strip()
    value = re.sub(r"[\x00-\x1f\x7f]", "", value)
    if not value:
        raise ValueError("Profile name cannot be empty.")
    if len(value) > 96:
        raise ValueError("Profile name is limited to 96 characters.")
    return value


def _profile_path(scope: str, name: str) -> Path:
    safe_name = _profile_name(name)
    digest = hashlib.sha256(safe_name.casefold().encode("utf-8")).hexdigest()[:24]
    return profile_directory(scope) / f"{digest}.json"


def _read_json(path: Path) -> Dict[str, Any]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        raise ValueError(f"Invalid profile file: {path.name}") from exc
    if not isinstance(data, dict):
        raise ValueError(f"Invalid profile root: {path.name}")
    return data


def list_profiles(scope: str) -> list[Dict[str, Any]]:
    entries: list[Dict[str, Any]] = []
    for path in profile_directory(scope).glob("*.json"):
        try:
            data = _read_json(path)
            entries.append(
                {
                    "name": str(data.get("name") or path.stem),
                    "scope": str(data.get("scope") or scope),
                    "schema_version": int(data.get("schema_version") or 0),
                    "saved_at": str(data.get("saved_at") or ""),
                }
            )
        except Exception:
            continue
    return sorted(entries, key=lambda item: item["name"].casefold())


def load_profile(scope: str, name: str) -> Dict[str, Any]:
    path = _profile_path(scope, name)
    if not path.is_file():
        raise FileNotFoundError(f"Profile not found: {name}")
    data = _read_json(path)
    schema = int(data.get("schema_version") or 0)
    if schema > PROFILE_SCHEMA_VERSION:
        raise ValueError(
            f"Profile schema {schema} is newer than supported schema "
            f"{PROFILE_SCHEMA_VERSION}."
        )
    data.setdefault("schema_version", PROFILE_SCHEMA_VERSION)
    data.setdefault("scope", scope)
    data.setdefault("payload", {})
    return data


def save_profile(scope: str, name: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    name = _profile_name(name)
    if not isinstance(payload, dict):
        raise ValueError("Profile payload must be an object.")
    data = {
        "schema_version": PROFILE_SCHEMA_VERSION,
        "name": name,
        "scope": str(scope).lower(),
        "saved_at": datetime.now(timezone.utc).isoformat(),
        "payload": payload,
    }
    path = _profile_path(scope, name)
    temp = path.with_suffix(".tmp")
    temp.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
    temp.replace(path)
    return data


def delete_profile(scope: str, name: str) -> bool:
    path = _profile_path(scope, name)
    if not path.exists():
        return False
    path.unlink()
    return True


def rename_profile(scope: str, old_name: str, new_name: str) -> Dict[str, Any]:
    data = load_profile(scope, old_name)
    saved = save_profile(scope, new_name, dict(data.get("payload") or {}))
    old_path = _profile_path(scope, old_name)
    new_path = _profile_path(scope, new_name)
    if old_path != new_path and old_path.exists():
        old_path.unlink()
    return saved


def import_profile(scope: str, document: Dict[str, Any], *, overwrite_name: str | None = None) -> Dict[str, Any]:
    if not isinstance(document, dict):
        raise ValueError("Imported profile must be a JSON object.")
    payload = document.get("payload")
    if not isinstance(payload, dict):
        raise ValueError("Imported profile does not contain a valid payload.")
    name = overwrite_name or document.get("name")
    return save_profile(scope, _profile_name(name), payload)


def export_profile(scope: str, name: str) -> Dict[str, Any]:
    return load_profile(scope, name)


def state_directory() -> Path:
    directory = _user_root() / "state"
    directory.mkdir(parents=True, exist_ok=True)
    return directory


def _state_path(name: str) -> Path:
    key = str(name or "").strip().lower()
    if key not in VALID_STATE_NAMES:
        raise ValueError(f"Unsupported H3 state name: {key}")
    return state_directory() / f"{key}.json"


def load_state(name: str) -> Dict[str, Any]:
    path = _state_path(name)
    if not path.is_file():
        return {
            "schema_version": STATE_SCHEMA_VERSION,
            "name": str(name).lower(),
            "payload": {},
        }
    data = _read_json(path)
    schema = int(data.get("schema_version") or 0)
    if schema > STATE_SCHEMA_VERSION:
        raise ValueError(
            f"State schema {schema} is newer than supported schema "
            f"{STATE_SCHEMA_VERSION}."
        )
    payload = data.get("payload")
    if not isinstance(payload, dict):
        payload = {}
    return {
        "schema_version": schema or STATE_SCHEMA_VERSION,
        "name": str(data.get("name") or name).lower(),
        "saved_at": str(data.get("saved_at") or ""),
        "payload": payload,
    }


def save_state(name: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    if not isinstance(payload, dict):
        raise ValueError("State payload must be an object.")
    path = _state_path(name)
    data = {
        "schema_version": STATE_SCHEMA_VERSION,
        "name": str(name).lower(),
        "saved_at": datetime.now(timezone.utc).isoformat(),
        "payload": payload,
    }
    temp = path.with_suffix(".tmp")
    temp.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
    temp.replace(path)
    return data
