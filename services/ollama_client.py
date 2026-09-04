from __future__ import annotations

import json
import time
import urllib.error
import urllib.request
from typing import Any, Iterable


class OllamaError(RuntimeError):
    pass


class OllamaClient:
    def __init__(
        self,
        server_url: str,
        request_timeout_seconds: int = 900,
    ):
        server_url = str(server_url).strip().rstrip("/")
        if not server_url.startswith(("http://", "https://")):
            raise ValueError(
                "Ollama URL must start with http:// or https://."
            )
        self.server_url = server_url
        self.request_timeout_seconds = max(
            3, int(request_timeout_seconds)
        )

    def _request_json(
        self,
        endpoint: str,
        payload: dict[str, Any] | None = None,
        timeout: int | None = None,
    ) -> dict[str, Any]:
        data = None
        headers: dict[str, str] = {}
        method = "GET"
        if payload is not None:
            data = json.dumps(payload).encode("utf-8")
            headers["Content-Type"] = "application/json"
            method = "POST"

        request = urllib.request.Request(
            f"{self.server_url}{endpoint}",
            data=data,
            headers=headers,
            method=method,
        )
        try:
            with urllib.request.urlopen(
                request,
                timeout=timeout or self.request_timeout_seconds,
            ) as response:
                body = response.read().decode("utf-8")
        except urllib.error.HTTPError as error:
            detail = error.read().decode("utf-8", errors="replace")
            raise OllamaError(
                f"Ollama HTTP {error.code} at {endpoint}: {detail}"
            ) from error
        except (urllib.error.URLError, TimeoutError) as error:
            raise OllamaError(
                f"Could not reach Ollama at {self.server_url}: {error}"
            ) from error

        try:
            return json.loads(body) if body else {}
        except json.JSONDecodeError as error:
            raise OllamaError(
                f"Ollama returned invalid JSON from {endpoint}."
            ) from error

    def generate(
        self,
        *,
        model: str,
        system: str,
        prompt: str,
        images: list[str] | None,
        options: dict[str, Any],
        keep_alive: str | int,
        response_format: str | None = None,
    ) -> str:
        payload: dict[str, Any] = {
            "model": model,
            "system": system,
            "prompt": prompt,
            "stream": False,
            "think": False,
            "options": options,
            "keep_alive": keep_alive,
        }
        if images:
            payload["images"] = images
        if response_format:
            payload["format"] = response_format

        response = self._request_json("/api/generate", payload)
        text = response.get("response")
        if not isinstance(text, str):
            raise OllamaError(
                "Ollama generation completed without a text response."
            )
        return text

    def running_models(self, timeout: int = 5) -> list[dict[str, Any]]:
        response = self._request_json("/api/ps", timeout=timeout)
        models = response.get("models", [])
        return models if isinstance(models, list) else []

    @staticmethod
    def _normal_model_name(value: Any) -> tuple[str, str]:
        name = str(value or "").strip().lower()
        return name, name.split(":", 1)[0]

    @classmethod
    def model_is_loaded(
        cls,
        models: Iterable[dict[str, Any]],
        requested_model: str,
    ) -> bool:
        requested, requested_base = cls._normal_model_name(
            requested_model
        )
        for entry in models:
            if not isinstance(entry, dict):
                continue
            candidate = (
                entry.get("name")
                or entry.get("model")
                or entry.get("model_name")
            )
            candidate, candidate_base = cls._normal_model_name(candidate)
            if candidate and (
                candidate == requested
                or candidate_base == requested_base
            ):
                return True
        return False

    def release_models(
        self,
        models: Iterable[str],
        timeout_seconds: int,
    ) -> None:
        unique_models = tuple(
            dict.fromkeys(
                str(model).strip() for model in models if str(model).strip()
            )
        )
        if not unique_models:
            return

        timeout_seconds = max(3, int(timeout_seconds))
        deadline = time.monotonic() + timeout_seconds

        running = self.running_models(timeout=min(5, timeout_seconds))
        loaded_models = [
            model
            for model in unique_models
            if self.model_is_loaded(running, model)
        ]
        if not loaded_models:
            return

        for model in loaded_models:
            self._request_json(
                "/api/generate",
                {
                    "model": model,
                    "prompt": "",
                    "keep_alive": 0,
                    "stream": False,
                },
                timeout=timeout_seconds,
            )

        while time.monotonic() < deadline:
            remaining = max(1, int(deadline - time.monotonic()))
            running = self.running_models(timeout=min(5, remaining))
            still_loaded = [
                model
                for model in loaded_models
                if self.model_is_loaded(running, model)
            ]
            if not still_loaded:
                return
            time.sleep(0.25)

        raise OllamaError(
            "Ollama acknowledged the unload request, but these models "
            f"remained loaded after {timeout_seconds} seconds: "
            f"{', '.join(still_loaded)}"
        )
