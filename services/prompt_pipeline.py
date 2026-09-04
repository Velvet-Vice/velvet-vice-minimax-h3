from __future__ import annotations

from dataclasses import dataclass
import re
from typing import Any, Callable

from .duration_planner import DurationContext, resolve_duration_context
from .ollama_client import OllamaClient, OllamaError
from .scene_choreography import (
    ChoreographyPlan,
    SceneState,
    analyze_scene_state,
    build_choreography_plan,
)
from .templates import TEMPLATE_VERSION, load_template


DEFAULT_SERVER_URL = "http://127.0.0.1:11434"
DEFAULT_MODEL = (
    "fredrezones55/Qwen3.5-Uncensored-HauhauCS-Aggressive:9b"
)

MODES = (
    "MANUAL",
    "STANDARD VISION",
    "ADULT ASSISTED",
    "ADULT FULL AUTO",
)
ENDING_MODES = (
    "AUTO",
    "NO CLIMAX",
    "CLIMAX",
    "LOOP / CONTINUOUS ACTION",
)
MEMORY_PROFILES = (
    "8-12 GB",
    "16 GB",
    "24-32+ GB",
)
LTX_PROMPT_PROFILES = (
    "MiniMax H3",
)

CONTEXT_WINDOWS = {
    "8-12 GB": (20480, 16384, 8192, 12288),
    "16 GB": (24576, 20480, 10240, 16384),
    "24-32+ GB": (32768, 32768, 12288, 20480),
}

SAFE_FALLBACK = load_template("safe_fallback.txt")
FULL_AUTO_DEFAULTS = load_template("full_auto_defaults.txt")

_ENDING_MODE_CANONICAL = {
    "AUTO": "AUTO",
    "NO CLIMAX": "NO_CLIMAX",
    "NO_CLIMAX": "NO_CLIMAX",
    "CLIMAX": "CLIMAX",
    "LOOP": "LOOP",
    "CONTINUOUS ACTION": "LOOP",
    "LOOP / CONTINUOUS ACTION": "LOOP",
}

_LTX_PROMPT_PROFILE_CANONICAL = {
    "MINIMAX H3": "MiniMax H3",
    "MINIMAX-H3": "MiniMax H3",
    "H3": "MiniMax H3",
}

_ENDING_MODE_RULES = {
    "AUTO": (
        "Choose the most natural non-forced ending for the visible scene. "
        "A climax is optional, not the default, and must not be added merely "
        "because the clip duration can contain one."
    ),
    "NO_CLIMAX": (
        "Do not plan, describe, imply, or preserve any orgasm, ejaculation, "
        "cumshot, new sexual fluid event, climax, or climax aftermath. "
        "Sustain the selected primary action and finish in a stable "
        "non-climactic state."
    ),
    "CLIMAX": (
        "Plan exactly one physically compatible climax near the end, only "
        "after readable buildup. Keep its source, timing, trajectory, "
        "contact, residue, and aftermath anatomically and temporally "
        "coherent."
    ),
    "LOOP": (
        "Do not plan or describe a climax, ejaculation, cumshot, new sexual "
        "fluid event, or terminal aftermath. Sustain one continuous primary "
        "action and end mid-rhythm in a motion phase compatible with the "
        "opening state; do not visibly reset or restart the action."
    ),
}

_MANUAL_PENILE_STIMULATION_RULES = {
    "AUTO": (
        "Special completion rule: when sustained direct manual stimulation "
        "of a clearly visible adult penis is selected as the primary action "
        "and the duration supports readable buildup, complete that action "
        "with exactly one visible ejaculation from the stimulated penis near "
        "the end. Do not apply this special case to a plan that can reach "
        "only approach or first contact."
    ),
    "NO_CLIMAX": (
        "The manual-penile-stimulation completion rule is disabled. Manual "
        "stimulation may continue, but it must not produce orgasm, "
        "ejaculation, climax fluid, or climax aftermath."
    ),
    "CLIMAX": (
        "When the selected primary action is sustained direct manual "
        "stimulation of a clearly visible adult penis, the required single "
        "climax must be a visible ejaculation from that stimulated penis. "
        "Establish the stimulation and readable buildup before emission."
    ),
    "LOOP": (
        "The manual-penile-stimulation completion rule is disabled. Sustain "
        "the stimulation mid-rhythm without orgasm, ejaculation, climax "
        "fluid, or terminal aftermath."
    ),
}


def canonical_ending_mode(value: str) -> str:
    normalized = " ".join(str(value).strip().upper().split())
    try:
        return _ENDING_MODE_CANONICAL[normalized]
    except KeyError as error:
        supported = ", ".join(ENDING_MODES)
        raise ValueError(
            f"Unsupported ending mode: {value!r}. Choose: {supported}."
        ) from error


def ending_control_block(value: str) -> str:
    canonical = canonical_ending_mode(value)
    return (
        "\n\nVELVET VICE ENDING CONTROL — HARD OVERRIDE\n"
        f"ENDING_MODE: {canonical}\n"
        f"{_ENDING_MODE_RULES[canonical]}\n"
        f"{_MANUAL_PENILE_STIMULATION_RULES[canonical]}\n"
        "This selector overrides any conflicting ENDING line, inferred "
        "outcome, draft event, or earlier-stage suggestion. Carry the exact "
        "ENDING_MODE through every stage."
    )


def canonical_prompt_profile(value: str) -> str:
    normalized = " ".join(str(value).strip().upper().split())
    try:
        return _LTX_PROMPT_PROFILE_CANONICAL[normalized]
    except KeyError as error:
        supported = ", ".join(LTX_PROMPT_PROFILES)
        raise ValueError(
            f"Unsupported video prompt profile: {value!r}. Choose: "
            f"{supported}."
        ) from error


def _walk_profile_metadata(value: Any):
    if isinstance(value, dict):
        yield value
        for nested in value.values():
            yield from _walk_profile_metadata(nested)
    elif isinstance(value, (list, tuple)):
        for nested in value:
            yield from _walk_profile_metadata(nested)


def resolve_prompt_profile(
    value: Any = None,
    *,
    prompt: Any = None,
    extra_pnginfo: Any = None,
) -> str:
    """Resolve new widgets and legacy workflows without a required input."""
    if value is not None and str(value).strip():
        return canonical_prompt_profile(str(value))

    for mapping in _walk_profile_metadata(extra_pnginfo):
        for key in (
            "ltx_prompt_profile",
            "velvet_vice_ltx_profile",
        ):
            candidate = mapping.get(key)
            if candidate is None or not str(candidate).strip():
                continue
            try:
                return canonical_prompt_profile(str(candidate))
            except ValueError:
                continue

    # Standalone package supports one video prompt target only.
    return "MiniMax H3"


def prompt_profile_control_block(value: str) -> str:
    canonical = canonical_prompt_profile(value)
    if canonical == "MiniMax H3":
        return "\n\n" + load_template("minimax_h3_prompt_profile.txt")
    raise ValueError(f"Unsupported MiniMax H3 prompt profile: {canonical!r}")


def audio_control_block(audio_enabled: bool) -> str:
    if bool(audio_enabled):
        return (
            "\n\nVELVET VICE AUDIO OUTPUT CONTROL — HARD WORKFLOW OVERRIDE\n"
            "AUDIO_MODE: WITH_SOUND\n"
            "Use MiniMax H3 native synchronized audio when it is supported by "
            "the visible scene or explicitly requested. Keep dialogue and "
            "diegetic sounds next to their visual causes. Use the required "
            "overall_soundscape and non_diegetic_music fields.\n"
        )
    return (
        "\n\nVELVET VICE AUDIO OUTPUT CONTROL — HARD WORKFLOW OVERRIDE\n"
        "AUDIO_MODE: MUTED_VIDEO_ONLY\n"
        "Generate visual motion only. Do not add dialogue, voice, vocalization, "
        "sound effects, ambience, diegetic music or background music. The final "
        "prompt must contain overall_soundscape: N/A and "
        "non_diegetic_music: N/A exactly.\n"
    )


_H3_FIRST_FRAME_LINE = (
    "For the target video, at 0.00 seconds into the target video, "
    "<Picture 1> (from [Shot 1]) is fully referenced."
)
_H3_FIELDS = (
    "integrated_multimodal_description:",
    "overall_soundscape:",
    "non_diegetic_music:",
)


def normalize_h3_i2va_prompt(text: str, *, audio_enabled: bool) -> str:
    """Keep Ollama output executable even when a model ignores formatting.

    Semantic rewriting remains the vision model's job. This function only
    removes a surrounding markdown fence, adds the official I2VA anchor, and
    supplies missing core fields. It deliberately does not rewrite actions.
    """
    prompt = str(text or "").strip()
    if prompt.startswith("```") and prompt.endswith("```"):
        lines = prompt.splitlines()
        if len(lines) >= 2:
            prompt = "\n".join(lines[1:-1]).strip()

    has_integrated = _H3_FIELDS[0] in prompt
    if not has_integrated:
        body = prompt or (
            "[Shot 1] The visible subjects remain in the composition "
            "established by <Picture 1>, with stable identity and framing."
        )
        if not body.lstrip().startswith("[Shot 1]"):
            body = f"[Shot 1] {body}"
        prompt = f"integrated_multimodal_description: {body}"

    if not prompt.startswith(_H3_FIRST_FRAME_LINE):
        prompt = f"{_H3_FIRST_FRAME_LINE}\n\n{prompt}"

    if _H3_FIELDS[1] not in prompt:
        prompt += "\n\noverall_soundscape: N/A"
    if _H3_FIELDS[2] not in prompt:
        prompt += "\n\nnon_diegetic_music: N/A"

    if not audio_enabled:
        prompt = re.sub(
            r"overall_soundscape:\s*.*?(?=\n\s*non_diegetic_music:|\Z)",
            "overall_soundscape: N/A\n",
            prompt,
            flags=re.DOTALL,
        )
        prompt = re.sub(
            r"non_diegetic_music:\s*.*\Z",
            "non_diegetic_music: N/A",
            prompt,
            flags=re.DOTALL,
        )
    return prompt.strip()


@dataclass(frozen=True)
class PromptPipelineResult:
    prompt_package: dict[str, Any]
    final_prompt: str
    status: str


@dataclass(frozen=True)
class _Stage:
    label: str
    template: str
    temperature: float
    seed: int
    num_predict: int
    response_format: str | None
    use_image: bool
    keep_alive: str | int


ADULT_STAGES = (
    _Stage(
        "Vision Scene Analyzer",
        "adult_scene_analyzer.txt",
        0.10,
        123456,
        1600,
        "json",
        True,
        "1m",
    ),
    _Stage(
        "Temporal Action Director",
        "adult_action_director.txt",
        0.15,
        234567,
        1800,
        "json",
        True,
        "1m",
    ),
    _Stage(
        "Production Prompt Writer",
        "adult_prompt_writer.txt",
        0.25,
        345678,
        900,
        None,
        False,
        "1m",
    ),
    _Stage(
        "Continuity Validator",
        "adult_continuity_validator.txt",
        0.10,
        456789,
        1000,
        None,
        True,
        0,
    ),
)


class PromptPipeline:
    def __init__(
        self,
        client: OllamaClient,
        telemetry: Callable[[str], Any] | None = None,
    ):
        self.client = client
        self.telemetry = telemetry

    def _telemetry(self, label: str) -> None:
        if self.telemetry is not None:
            self.telemetry(label)

    @staticmethod
    def _package(
        *,
        final_prompt: str,
        mode: str,
        model: str,
        server_url: str,
        call_count: int,
        release_required: bool,
        ending_mode: str,
        ltx_prompt_profile: str,
        duration_context: DurationContext | None = None,
        scene_state: SceneState | None = None,
        choreography_plan: ChoreographyPlan | None = None,
        audio_enabled: bool = True,
    ) -> dict[str, Any]:
        package = {
            "schema": "VELVET_VICE_PROMPT_PACKAGE",
            "schema_version": 6,
            "final_prompt": final_prompt,
            "mode": mode,
            "ending_mode": ending_mode,
            "ltx_prompt_profile": ltx_prompt_profile,
            "prompt_profile": ltx_prompt_profile,
            "ollama_model": model,
            "ollama_url": server_url,
            "used_models": [model] if release_required else [],
            "ollama_call_count": call_count,
            "template_version": TEMPLATE_VERSION,
            "release_required": bool(release_required),
            "audio_mode": (
                "WITH_SOUND" if audio_enabled else "MUTED_VIDEO_ONLY"
            ),
        }
        if duration_context is not None:
            package["duration"] = {
                "seconds": duration_context.seconds,
                "frames": duration_context.frames,
                "fps": duration_context.fps,
                "source": duration_context.source,
                "profile": duration_context.profile,
            }
        if scene_state is not None:
            package["scene_diagnostics"] = {
                "parsed": scene_state.parsed,
                "participant_count": scene_state.participant_count,
                "anatomy_summary": scene_state.anatomy_summary,
                "position_family": scene_state.position_family,
                "position_confidence": scene_state.position_confidence,
                "complexity": scene_state.complexity,
                "complexity_score": scene_state.complexity_score,
                "support_stability": scene_state.support_stability,
                "motion_freedom": scene_state.motion_freedom,
                "occlusion_risk": scene_state.occlusion_risk,
                "identity_risk": scene_state.identity_risk,
                "persistent_anatomy_locks": list(
                    scene_state.persistent_anatomy_locks
                ),
                "hand_reconstruction_locks": list(
                    scene_state.hand_reconstruction_locks
                ),
                "high_risk_hand_count": scene_state.high_risk_hand_count,
                "penis_resource_locks": list(scene_state.penis_resource_locks),
                "primary_engaged_resources": list(
                    scene_state.primary_engaged_resources
                ),
                "free_manual_penis_targets": list(
                    scene_state.free_manual_penis_targets
                ),
                "forbidden_manual_penis_targets": list(
                    scene_state.forbidden_manual_penis_targets
                ),
            }
        if choreography_plan is not None:
            package["choreography"] = {
                "safe_beat_budget": choreography_plan.beat_budget,
                "nominal_beat_budget": choreography_plan.nominal_beats,
                "transition_budget": choreography_plan.transition_budget,
                "new_secondary_action_allowed": (
                    choreography_plan.secondary_action_allowed
                ),
                "new_manual_penis_secondary_allowed": (
                    choreography_plan.manual_penis_secondary_allowed
                ),
                "preserve_existing_secondary": (
                    choreography_plan.preserve_existing_secondary
                ),
                "legacy_fallback": choreography_plan.legacy_fallback,
            }
        return package

    @staticmethod
    def _options(
        *,
        num_ctx: int,
        temperature: float,
        seed: int,
        num_predict: int,
    ) -> dict[str, Any]:
        return {
            "num_ctx": int(num_ctx),
            "repeat_penalty": 1.1,
            "temperature": float(temperature),
            "seed": int(seed),
            "num_predict": int(num_predict),
            "top_p": 0.85,
        }

    @staticmethod
    def _require_image(mode: str, encoded_images: list[str]) -> None:
        if not encoded_images:
            raise ValueError(
                f"{mode} requires a connected reference image."
            )

    def run(
        self,
        *,
        mode: str,
        encoded_images: list[str],
        manual_prompt: str,
        short_idea: str,
        full_auto_settings: str,
        adult_confirmed: bool,
        model: str,
        server_url: str,
        memory_profile: str,
        ending_mode: str = "AUTO",
        ltx_prompt_profile: str = "MiniMax H3",
        duration_context: DurationContext | None = None,
        audio_enabled: bool = True,
    ) -> PromptPipelineResult:
        if mode not in MODES:
            raise ValueError(f"Unsupported prompt mode: {mode}")
        if memory_profile not in CONTEXT_WINDOWS:
            raise ValueError(
                f"Unsupported memory profile: {memory_profile}"
            )
        model = str(model).strip()
        canonical_ending = canonical_ending_mode(ending_mode)
        canonical_profile = canonical_prompt_profile(ltx_prompt_profile)
        profile_control = prompt_profile_control_block(canonical_profile)
        audio_control = audio_control_block(audio_enabled)
        resolved_duration = duration_context or resolve_duration_context(
            full_auto_settings=full_auto_settings
        )
        if not model and mode != "MANUAL":
            raise ValueError("An Ollama model name is required.")

        if mode == "MANUAL":
            package = self._package(
                final_prompt=manual_prompt,
                mode=mode,
                model=model,
                server_url=server_url,
                call_count=0,
                release_required=False,
                ending_mode=canonical_ending,
                ltx_prompt_profile=canonical_profile,
                audio_enabled=audio_enabled,
            )
            return PromptPipelineResult(
                package,
                manual_prompt,
                "MANUAL — 0 Ollama calls; prompt passed unchanged.",
            )

        if mode.startswith("ADULT") and not adult_confirmed:
            safe_prompt = normalize_h3_i2va_prompt(
                SAFE_FALLBACK, audio_enabled=audio_enabled
            )
            package = self._package(
                final_prompt=safe_prompt,
                mode=mode,
                model=model,
                server_url=server_url,
                call_count=0,
                release_required=False,
                ending_mode=canonical_ending,
                ltx_prompt_profile=canonical_profile,
                audio_enabled=audio_enabled,
            )
            return PromptPipelineResult(
                package,
                safe_prompt,
                "ADULT GATE BLOCKED — safe fallback; 0 Ollama calls.",
            )

        self._require_image(mode, encoded_images)

        if mode == "STANDARD VISION":
            standard_system = load_template("standard_vision.txt")
            duration_control = resolved_duration.control_block()
            standard_prompt = (
                f"{short_idea}{duration_control}{audio_control}"
                f"{profile_control}"
            )
            standard_options = self._options(
                num_ctx=16384,
                temperature=0.25,
                seed=123456,
                num_predict=600,
            )
            standard_call_count = 1
            try:
                self._telemetry("before Standard Vision")
                final_prompt = self.client.generate(
                    model=model,
                    system=standard_system,
                    prompt=standard_prompt,
                    images=encoded_images,
                    options=standard_options,
                    keep_alive=0,
                    response_format=None,
                )
                self._telemetry("after Standard Vision")
            except OllamaError as error:
                if "exceed_context_size_error" not in str(error):
                    raise RuntimeError(
                        f"STANDARD VISION failed: {error}"
                    ) from error

                retry_options = dict(standard_options)
                retry_options["num_ctx"] = 32768
                standard_call_count = 2
                try:
                    self._telemetry(
                        "Standard Vision context exceeded; retrying at 32768"
                    )
                    final_prompt = self.client.generate(
                        model=model,
                        system=standard_system,
                        prompt=standard_prompt,
                        images=encoded_images,
                        options=retry_options,
                        keep_alive=0,
                        response_format=None,
                    )
                    self._telemetry("after Standard Vision retry")
                except OllamaError as retry_error:
                    raise RuntimeError(
                        f"STANDARD VISION failed: {retry_error}"
                    ) from retry_error
            final_prompt = normalize_h3_i2va_prompt(
                final_prompt, audio_enabled=audio_enabled
            )
            package = self._package(
                final_prompt=final_prompt,
                mode=mode,
                model=model,
                server_url=server_url,
                call_count=standard_call_count,
                release_required=True,
                ending_mode=canonical_ending,
                ltx_prompt_profile=canonical_profile,
                duration_context=resolved_duration,
                audio_enabled=audio_enabled,
            )
            call_label = (
                "1 Ollama call completed"
                if standard_call_count == 1
                else "2 Ollama calls completed (32K context retry)"
            )
            return PromptPipelineResult(
                package,
                final_prompt,
                f"STANDARD VISION — {call_label}; "
                f"audio mode {'WITH_SOUND' if audio_enabled else 'MUTED_VIDEO_ONLY'}; "
                f"prompt profile {canonical_profile}.",
            )

        context_windows = CONTEXT_WINDOWS[memory_profile]
        current_prompt = (
            short_idea
            if mode == "ADULT ASSISTED"
            else full_auto_settings
        )
        ending_control = ending_control_block(canonical_ending)
        duration_control = resolved_duration.control_block()
        scene_state: SceneState | None = None
        choreography_plan: ChoreographyPlan | None = None
        lock_block = ""

        for index, stage in enumerate(ADULT_STAGES):
            if index == 0:
                stage_prompt = (
                    f"{current_prompt}{duration_control}{ending_control}"
                    f"{audio_control}"
                    f"{profile_control}"
                )
            else:
                if scene_state is None:
                    scene_state = analyze_scene_state(current_prompt)
                    if scene_state.blocked:
                        safe_prompt = normalize_h3_i2va_prompt(
                            SAFE_FALLBACK, audio_enabled=audio_enabled
                        )
                        package = self._package(
                            final_prompt=safe_prompt,
                            mode=mode,
                            model=model,
                            server_url=server_url,
                            call_count=1,
                            release_required=True,
                            ending_mode=canonical_ending,
                            ltx_prompt_profile=canonical_profile,
                            duration_context=resolved_duration,
                            scene_state=scene_state,
                            audio_enabled=audio_enabled,
                        )
                        return PromptPipelineResult(
                            package,
                            safe_prompt,
                            "ADULT VISION GATE BLOCKED after Stage 1; "
                            "safe fallback returned.",
                        )
                    choreography_plan = build_choreography_plan(
                        resolved_duration, scene_state
                    )
                    lock_block = scene_state.lock_block()

                assert choreography_plan is not None
                planning_control = choreography_plan.control_block(
                    resolved_duration
                )
                stage_prompt = (
                    f"{current_prompt}{duration_control}"
                    f"{planning_control}{lock_block}{ending_control}"
                    f"{audio_control}"
                    f"{profile_control}"
                )

            try:
                self._telemetry(
                    f"before stage {index + 1}: {stage.label}"
                )
                current_prompt = self.client.generate(
                    model=model,
                    system=load_template(stage.template),
                    prompt=stage_prompt,
                    images=encoded_images if stage.use_image else None,
                    options=self._options(
                        num_ctx=context_windows[index],
                        temperature=stage.temperature,
                        seed=stage.seed,
                        num_predict=stage.num_predict,
                    ),
                    keep_alive=stage.keep_alive,
                    response_format=stage.response_format,
                )
                self._telemetry(
                    f"after stage {index + 1}: {stage.label}"
                )
            except OllamaError as error:
                raise RuntimeError(
                    f"Adult prompt stage {index + 1} "
                    f"({stage.label}) failed: {error}"
                ) from error

        if scene_state is None:
            scene_state = analyze_scene_state("")
        if choreography_plan is None:
            choreography_plan = build_choreography_plan(
                resolved_duration, scene_state
            )

        current_prompt = normalize_h3_i2va_prompt(
            current_prompt, audio_enabled=audio_enabled
        )
        package = self._package(
            final_prompt=current_prompt,
            mode=mode,
            model=model,
            server_url=server_url,
            call_count=4,
            release_required=True,
            ending_mode=canonical_ending,
            ltx_prompt_profile=canonical_profile,
            duration_context=resolved_duration,
            scene_state=scene_state,
            choreography_plan=choreography_plan,
            audio_enabled=audio_enabled,
        )
        duration_text = (
            f"{resolved_duration.seconds:.2f}".rstrip("0").rstrip(".")
        )
        return PromptPipelineResult(
            package,
            current_prompt,
            f"{mode} — 4 Ollama stages completed; "
            f"duration {duration_text}s / {resolved_duration.frames} frames "
            f"at {resolved_duration.fps:g} FPS from "
            f"{resolved_duration.source}; profile "
            f"{resolved_duration.profile}; participants "
            f"{scene_state.participant_count}; anatomy "
            f"{scene_state.anatomy_summary}; complexity "
            f"{scene_state.complexity}; safe beats "
            f"{choreography_plan.beat_budget}; ending mode "
            f"{canonical_ending}; audio mode "
            f"{'WITH_SOUND' if audio_enabled else 'MUTED_VIDEO_ONLY'}; "
            f"prompt profile {canonical_profile}."
        )
