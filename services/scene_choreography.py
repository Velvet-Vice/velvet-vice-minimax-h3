from __future__ import annotations

from dataclasses import dataclass
import json
from typing import Any, Iterable

from .duration_planner import DurationContext


_OPENINGS = {
    "NONE",
    "EXTERNAL_VULVA",
    "VAGINAL_OPENING",
    "EXTERNAL_ANUS",
    "ANAL_OPENING",
    "UNCLEAR",
}
_INACTIVE_ACTION_CLASSES = {"", "NONE", "NO_ACTION", "INACTIVE", "UNCLEAR"}
_INACTIVE_CONTACT_STATES = {"", "NONE", "NO_CONTACT", "ENDED"}
_ACTIVE_CONTACT_STATES = {
    "FIRST_CONTACT",
    "ESTABLISHED",
    "SUSTAINED_CONTACT",
    "RHYTHMIC",
    "RHYTHMIC_CONTACT",
    "OCCLUDED",
}
_PENIS_VISIBLE_EVIDENCE = {"CLEARLY_VISIBLE", "VISIBLE", "PRESENT", "PENIS_VISIBLE"}
_PENIS_PARTIAL_EVIDENCE = {
    "PARTIAL",
    "PENIS_PARTIAL",
    "USER_LABEL_SUPPORTED_PARTIAL",
    "PENIS_PARTIAL_USER_LABEL_SUPPORTED",
}


def parse_json_object(text: str) -> dict[str, Any] | None:
    if not isinstance(text, str):
        return None
    stripped = text.strip()
    if not stripped:
        return None
    try:
        value = json.loads(stripped)
        return value if isinstance(value, dict) else None
    except json.JSONDecodeError:
        pass

    decoder = json.JSONDecoder()
    for index, char in enumerate(stripped):
        if char != "{":
            continue
        try:
            value, _ = decoder.raw_decode(stripped[index:])
        except json.JSONDecodeError:
            continue
        if isinstance(value, dict):
            return value
    return None


def _first(mapping: dict[str, Any], *names: str) -> Any:
    for name in names:
        if name in mapping:
            return mapping[name]
    return None


def _text(value: Any, default: str = "UNCLEAR") -> str:
    if value is None:
        return default
    if isinstance(value, (dict, list)):
        return default
    text = str(value).strip()
    return text.upper() if text else default


def _confidence(value: Any) -> int:
    if isinstance(value, bool):
        return 0
    try:
        number = float(value)
    except (TypeError, ValueError):
        return 0
    if 0 <= number <= 1:
        number *= 100
    return max(0, min(100, int(round(number))))


def _bool(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    return str(value).strip().upper() in {"TRUE", "YES", "ON", "1", "COMPATIBLE"}


def _compact(value: Any, default: str = "NONE", limit: int = 180) -> str:
    if value is None:
        return default
    if isinstance(value, str):
        result = " ".join(value.split())
    elif isinstance(value, (list, tuple)):
        parts = [_compact(item, default="", limit=80) for item in value]
        result = ", ".join(item for item in parts if item)
    elif isinstance(value, dict):
        parts = []
        for key, nested in value.items():
            item = _compact(nested, default="", limit=70)
            if item:
                parts.append(f"{key}={item}")
        result = "; ".join(parts)
    else:
        result = str(value)
    result = result.strip() or default
    return result[:limit]


def _participant_items(data: dict[str, Any]) -> list[tuple[str, dict[str, Any]]]:
    participants = data.get("participants")
    items: list[tuple[str, dict[str, Any]]] = []
    if isinstance(participants, list):
        for index, participant in enumerate(participants[:4]):
            if not isinstance(participant, dict):
                continue
            participant_id = _text(
                _first(participant, "id", "participant_id", "label"),
                chr(ord("A") + index),
            )
            items.append((participant_id, participant))
    elif isinstance(participants, dict):
        for participant_id, participant in list(participants.items())[:4]:
            if isinstance(participant, dict):
                items.append((_text(participant_id), participant))

    if items:
        return items

    for participant_id in ("A", "B", "C", "D"):
        for key in (
            f"participant_{participant_id}",
            f"participant_{participant_id.lower()}",
            participant_id,
        ):
            participant = data.get(key)
            if isinstance(participant, dict):
                items.append((participant_id, participant))
                break
    return items


def _normalize_anatomy_label(label: str) -> str:
    upper = _text(label)
    if "FUTANARI" in upper or upper in {
        "FEMININE_WITH_PENIS",
        "MIXED_FEMININE_PENILE_ANATOMY",
    }:
        return "FUTANARI"
    if upper in {
        "WOMAN",
        "WOMAN_CONFIRMED",
        "FEMALE",
        "FEMALE_ANATOMY",
        "VULVA_ONLY",
    }:
        return "WOMAN"
    if upper in {
        "OTHER",
        "OTHER_ADULT_ANATOMY",
        "MALE",
        "MAN",
        "PENIS_ONLY",
    }:
        return "OTHER_ADULT_ANATOMY"
    return "UNCLEAR"


def _anatomy_label(participant: dict[str, Any]) -> tuple[str, int]:
    user_label = _text(
        _first(participant, "user_label", "requested_label", "identity_label"),
        "",
    )
    user_futanari = "FUTANARI" in user_label
    raw_label = _text(
        _first(
            participant,
            "anatomy_class",
            "generation_anatomy_class",
            "generation_label",
            "anatomy_profile",
            "anatomy_lock",
            "presentation_anatomy_class",
        )
    )
    normalized = _normalize_anatomy_label(raw_label)
    confidence = _confidence(
        _first(
            participant,
            "anatomy_confidence",
            "confidence",
            "anatomy_class_confidence",
        )
    )

    blob = json.dumps(participant, ensure_ascii=False).upper()
    penis = any(
        token in blob
        for token in (
            "PENIS_VISIBLE",
            "PENIS_PRESENT",
            "PENIS_PARTIAL",
            "PENIS_PARTIAL_USER_LABEL_SUPPORTED",
            "USER_LABEL_SUPPORTED_PARTIAL",
            "CLEARLY_VISIBLE_PENIS",
            "ATTACHED_PENIS",
            '"PENIS": "PRESENT"',
            '"PENIS":"PRESENT"',
            '"PENIS": "PARTIAL"',
            '"PENIS":"PARTIAL"',
            '"PENIS": "CLEARLY_VISIBLE"',
            '"PENIS":"CLEARLY_VISIBLE"',
        )
    )
    feminine = any(
        token in blob
        for token in (
            "FEMININE",
            "BREASTS_VISIBLE",
            "BREAST_REFERENCE_GEOMETRY",
            '"GENERATION_ANATOMY_CLASS": "WOMAN"',
            '"GENERATION_ANATOMY_CLASS":"WOMAN"',
            '"GENERATION_ANATOMY_CLASS": "FUTANARI"',
            '"GENERATION_ANATOMY_CLASS":"FUTANARI"',
        )
    )
    vulva = any(
        token in blob
        for token in (
            "VULVA_VISIBLE",
            "CLEARLY_VISIBLE_VULVA",
            '"VULVA": "PRESENT"',
            '"VULVA":"PRESENT"',
            '"VULVA": "PARTIAL"',
            '"VULVA":"PARTIAL"',
            '"VULVA": "CLEARLY_VISIBLE"',
            '"VULVA":"CLEARLY_VISIBLE"',
        )
    )

    # Literal visible mixed anatomy wins over an accidental WOMAN label.
    if penis and (feminine or normalized == "FUTANARI" or user_futanari):
        return "FUTANARI", confidence or 75
    participant_occlusion = _text(
        _first(participant, "occlusion", "occlusion_level", "visibility"),
        "UNCLEAR",
    )
    if user_futanari and (
        normalized in {"FUTANARI", "UNCLEAR", "WOMAN"}
        and participant_occlusion in {"PARTIAL", "STRONG", "OCCLUDED", "UNCLEAR"}
    ):
        return "FUTANARI", max(confidence, 70)
    if normalized == "FUTANARI":
        return "FUTANARI", confidence
    if normalized == "WOMAN":
        return "WOMAN", confidence
    if normalized == "OTHER_ADULT_ANATOMY":
        return "OTHER_ADULT_ANATOMY", confidence
    if vulva and feminine and not penis:
        return "WOMAN", confidence or 70
    return "UNCLEAR", confidence



def _participant_penis_evidence(participant: dict[str, Any]) -> str:
    genital = _first(participant, "genital_evidence", "anatomy_evidence")
    if isinstance(genital, dict):
        raw = _first(genital, "penis", "penis_evidence", "visible_penis")
    else:
        raw = _first(
            participant,
            "penis",
            "penis_evidence",
            "visible_penis",
        )
    value = _text(raw, "UNCLEAR")
    if value in _PENIS_VISIBLE_EVIDENCE or "CLEARLY_VISIBLE" in value:
        return "CLEARLY_VISIBLE"
    if value in _PENIS_PARTIAL_EVIDENCE or "PARTIAL" in value:
        return "PARTIAL"
    if value in {"NONE", "ABSENT", "NO", "NOT_VISIBLE_AND_ABSENT"}:
        return "NONE"

    blob = json.dumps(participant, ensure_ascii=False).upper()
    if any(
        token in blob
        for token in (
            "CLEARLY_VISIBLE_PENIS",
            "PENIS_VISIBLE",
            '"PENIS": "PRESENT"',
            '"PENIS":"PRESENT"',
            '"PENIS": "CLEARLY_VISIBLE"',
            '"PENIS":"CLEARLY_VISIBLE"',
        )
    ):
        return "CLEARLY_VISIBLE"
    if any(
        token in blob
        for token in (
            "PENIS_PARTIAL",
            "USER_LABEL_SUPPORTED_PARTIAL",
            '"PENIS": "PARTIAL"',
            '"PENIS":"PARTIAL"',
        )
    ):
        return "PARTIAL"
    return "UNCLEAR"



@dataclass(frozen=True)
class HandState:
    owner: str
    side: str
    state: str
    visibility: str
    palm_visibility: str
    finger_visibility: str
    visible_digit_count: int | None
    wrist_forearm_continuity: str
    function: str
    confidence: int
    reconstruction_policy: str

    @property
    def new_action_safe(self) -> bool:
        return (
            self.state == "VISIBLE_FREE"
            and self.visibility == "VISIBLE"
            and self.confidence >= 55
            and self.reconstruction_policy
            not in {
                "PRESERVE_OCCLUSION_NO_COMPLETION",
                "PRESERVE_OUT_OF_FRAME_NO_REENTRY",
                "UNCLEAR_HAND_NO_NEW_ACTION",
            }
        )

    @property
    def high_risk(self) -> bool:
        return self.reconstruction_policy in {
            "PRESERVE_OCCLUSION_NO_COMPLETION",
            "PRESERVE_OUT_OF_FRAME_NO_REENTRY",
            "UNCLEAR_HAND_NO_NEW_ACTION",
        }

    def lock_line(self) -> str:
        digit_count = (
            str(self.visible_digit_count)
            if self.visible_digit_count is not None
            else "UNRESOLVED"
        )
        return (
            f"{self.owner}.{self.side}_HAND:state={self.state};"
            f"visibility={self.visibility};palm={self.palm_visibility};"
            f"fingers={self.finger_visibility};visible_digits={digit_count};"
            f"wrist_forearm={self.wrist_forearm_continuity};"
            f"function={self.function};confidence={self.confidence};"
            f"reconstruction={self.reconstruction_policy}"
        )


def _optional_int(value: Any) -> int | None:
    if value is None or isinstance(value, bool):
        return None
    try:
        number = int(value)
    except (TypeError, ValueError):
        return None
    return number if 0 <= number <= 10 else None


def _hand_state(
    participant_id: str,
    side: str,
    value: Any,
) -> HandState:
    mapping = value if isinstance(value, dict) else {}
    state = _text(
        _first(mapping, "state", "status", "hand_state")
        if mapping
        else value,
        "UNCLEAR",
    )
    visibility = _text(
        _first(mapping, "visibility", "hand_visibility"),
        "",
    )
    if not visibility:
        if state.startswith("VISIBLE"):
            visibility = "VISIBLE"
        elif state == "PARTIAL":
            visibility = "PARTIAL"
        elif state == "OCCLUDED":
            visibility = "OCCLUDED"
        elif state in {"OUT_OF_FRAME", "OFF_FRAME"}:
            visibility = "OUT_OF_FRAME"
        else:
            visibility = "UNCLEAR"
    if visibility == "OFF_FRAME":
        visibility = "OUT_OF_FRAME"

    palm_visibility = _text(
        _first(mapping, "palm_visibility", "palm"),
        "UNCLEAR",
    )
    finger_visibility = _text(
        _first(mapping, "finger_visibility", "fingers_visibility", "fingers"),
        "UNCLEAR",
    )
    digit_count = _optional_int(
        _first(mapping, "visible_digit_count", "visible_finger_count", "digit_count")
    )
    wrist_forearm = _text(
        _first(mapping, "wrist_forearm_continuity", "arm_continuity"),
        "UNCLEAR",
    )
    function = _text(
        _first(mapping, "function", "role", "current_function"),
        state.replace("VISIBLE_", "") if state.startswith("VISIBLE_") else "UNCLEAR",
    )
    confidence = _confidence(_first(mapping, "confidence", "hand_confidence"))
    if confidence == 0 and state.startswith("VISIBLE"):
        confidence = 70

    if visibility in {"OCCLUDED", "PARTIAL"}:
        policy = "PRESERVE_OCCLUSION_NO_COMPLETION"
    elif visibility == "OUT_OF_FRAME":
        policy = "PRESERVE_OUT_OF_FRAME_NO_REENTRY"
    elif visibility == "UNCLEAR":
        policy = "UNCLEAR_HAND_NO_NEW_ACTION"
    elif digit_count == 5 and finger_visibility in {
        "VISIBLE",
        "CLEAR",
        "CLEARLY_VISIBLE",
        "ALL_VISIBLE",
    }:
        policy = "FIVE_DIGITS_LOCKED"
    else:
        policy = "PRESERVE_VISIBLE_SILHOUETTE_NO_NEW_DIGITS"

    explicit_policy = _text(
        _first(mapping, "reconstruction_policy", "reconstruction"),
        "",
    )
    if explicit_policy:
        policy = explicit_policy

    return HandState(
        owner=participant_id,
        side=side,
        state=state,
        visibility=visibility,
        palm_visibility=palm_visibility,
        finger_visibility=finger_visibility,
        visible_digit_count=digit_count,
        wrist_forearm_continuity=wrist_forearm,
        function=function,
        confidence=confidence,
        reconstruction_policy=policy,
    )


def _penis_existence_visibility(
    participant: dict[str, Any],
    anatomy_class: str,
    evidence: str,
) -> tuple[str, str]:
    genital = _first(participant, "genital_evidence", "anatomy_evidence")
    genital_visibility = None
    if isinstance(genital, dict):
        genital_visibility = _first(
            genital,
            "penis_visibility",
            "visibility",
            "penis_occlusion",
        )
    explicit_visibility = _text(
        genital_visibility
        or _first(participant, "penis_visibility", "genital_visibility"),
        "",
    )
    participant_occlusion = _text(
        _first(participant, "occlusion", "occlusion_level", "visibility"),
        "UNCLEAR",
    )

    if anatomy_class == "FUTANARI":
        existence = "PRESENT_LOCKED"
    elif evidence in {"CLEARLY_VISIBLE", "PARTIAL"}:
        existence = "PRESENT_LOCKED"
    elif evidence == "NONE" and anatomy_class == "WOMAN":
        existence = "ABSENT_LOCKED"
    elif evidence == "NONE":
        existence = "ABSENT"
    else:
        existence = "UNCLEAR"

    if explicit_visibility in {
        "VISIBLE",
        "CLEARLY_VISIBLE",
        "PARTIAL",
        "OCCLUDED",
        "OUT_OF_FRAME",
        "OFF_FRAME",
        "UNCLEAR",
    }:
        visibility = (
            "OUT_OF_FRAME" if explicit_visibility == "OFF_FRAME" else explicit_visibility
        )
    elif evidence == "CLEARLY_VISIBLE":
        visibility = "VISIBLE"
    elif evidence == "PARTIAL":
        visibility = "PARTIAL"
    elif participant_occlusion in {"OCCLUDED", "STRONG"}:
        visibility = "OCCLUDED"
    elif participant_occlusion in {"OUT_OF_FRAME", "OFF_FRAME"}:
        visibility = "OUT_OF_FRAME"
    elif existence in {"ABSENT", "ABSENT_LOCKED"}:
        visibility = "NOT_APPLICABLE"
    else:
        visibility = "UNCLEAR"

    return existence, visibility

def _resolve_owner(value: Any, participant_ids: tuple[str, ...]) -> str:
    owner = _text(value, "UNCLEAR")
    if owner == "SELF" and len(participant_ids) == 1:
        return participant_ids[0]
    return owner


def _action_resource_owner(action: dict[str, Any], participant_ids: tuple[str, ...]) -> str:
    owner = _first(action, "source_owner", "active_owner", "initiator")
    if owner is None:
        effector = _text(action.get("active_effector"), "")
        for participant_id in participant_ids:
            if effector.startswith(f"{participant_id}_") or effector.startswith(
                f"{participant_id}."
            ):
                return participant_id
    return _resolve_owner(owner, participant_ids)


def _penis_resource_registry(
    data: dict[str, Any],
    contacts: list[dict[str, Any]],
    participant_items: list[tuple[str, dict[str, Any]]],
) -> tuple[
    tuple[str, ...],
    tuple[str, ...],
    tuple[str, ...],
    tuple[str, ...],
    dict[str, str],
    tuple[str, ...],
    dict[str, str],
    dict[str, str],
]:
    """Return resource locks, free targets, exclusions, primary locks and state map.

    A penis used by an established primary penetrative action is immutable
    `ENGAGED_PRIMARY`. It can never become a new manual target or be reassigned
    merely because another hand is free.
    """

    participant_ids = tuple(participant_id for participant_id, _ in participant_items)
    participant_map = dict(participant_items)
    occupied: dict[str, str] = {}
    primary_engaged: list[str] = []

    def reserve(resource: str, state: str) -> None:
        if not resource or resource.startswith("UNCLEAR"):
            return
        current = occupied.get(resource)
        priority = {
            "ENGAGED_PRIMARY": 4,
            "ENGAGED_SECONDARY": 3,
            "ENGAGED_CONTACT": 2,
            "PRESENT_NOT_CONFIRMED_FREE": 1,
        }
        if current is None or priority.get(state, 0) > priority.get(current, 0):
            occupied[resource] = state

    for slot, key in (
        ("PRIMARY", "primary_action_signature"),
        ("SECONDARY", "secondary_action_signature"),
    ):
        action = data.get(key)
        if not isinstance(action, dict) or not _action_active(action):
            continue
        state = "ENGAGED_PRIMARY" if slot == "PRIMARY" else "ENGAGED_SECONDARY"
        action_class = _text(_first(action, "action_class", "class", "type"), "")
        source_owner = _action_resource_owner(action, participant_ids)
        active_effector = _text(action.get("active_effector"), "")
        target_owner = _resolve_owner(
            _first(action, "target_owner", "target_opening_owner"),
            participant_ids,
        )
        target_surface = _text(action.get("target_surface"), "")
        target_opening = _text(action.get("target_opening"), "NONE")

        source_has_confirmed_penis = False
        participant = participant_map.get(source_owner)
        if isinstance(participant, dict):
            anatomy_class, _ = _anatomy_label(participant)
            evidence = _participant_penis_evidence(participant)
            source_has_confirmed_penis = (
                anatomy_class in {"FUTANARI", "OTHER_ADULT_ANATOMY"}
                and evidence != "NONE"
            )

        penetrative_source = (
            action_class == "PENETRATIVE"
            and target_opening in {"VAGINAL_OPENING", "ANAL_OPENING"}
            and (
                "PENIS" in active_effector
                or "ACTIVE_ANATOMY" in active_effector
                or source_has_confirmed_penis
            )
        )
        if penetrative_source and source_owner in participant_ids:
            resource = f"{source_owner}.PENIS"
            reserve(resource, state)
            if slot == "PRIMARY" and resource not in primary_engaged:
                primary_engaged.append(resource)

        if target_surface == "PENIS" and target_owner in participant_ids:
            reserve(f"{target_owner}.PENIS", state)

    for contact in contacts:
        contact_state = _text(
            _first(contact, "state", "contact_state", "phase"), "UNCLEAR"
        )
        if contact_state not in _ACTIVE_CONTACT_STATES:
            continue
        source_owner = _resolve_owner(contact.get("source_owner"), participant_ids)
        source_part = _text(contact.get("source_body_part"), "")
        target_owner = _resolve_owner(
            _first(contact, "target_owner_or_object", "target_owner"),
            participant_ids,
        )
        target_surface = _text(contact.get("target_surface"), "")
        if "PENIS" in source_part and source_owner in participant_ids:
            reserve(f"{source_owner}.PENIS", "ENGAGED_CONTACT")
        if target_surface == "PENIS" and target_owner in participant_ids:
            reserve(f"{target_owner}.PENIS", "ENGAGED_CONTACT")

    states: dict[str, str] = {}
    existence_by_owner: dict[str, str] = {}
    visibility_by_owner: dict[str, str] = {}
    free_targets: list[str] = []
    exclusions: list[str] = []
    locks: list[str] = []
    anatomy_inventory_locks: list[str] = []
    for participant_id, participant in participant_items:
        resource = f"{participant_id}.PENIS"
        evidence = _participant_penis_evidence(participant)
        anatomy_class, anatomy_confidence = _anatomy_label(participant)
        existence, visibility = _penis_existence_visibility(
            participant,
            anatomy_class,
            evidence,
        )
        existence_by_owner[participant_id] = existence
        visibility_by_owner[participant_id] = visibility
        anatomy_inventory_locks.append(
            f"{participant_id}.ANATOMY_CLASS={anatomy_class}_LOCKED;"
            f"{resource}:owner={participant_id};existence={existence};"
            f"visibility={visibility};evidence={evidence};"
            f"confidence={anatomy_confidence}"
        )

        if resource in occupied:
            state = occupied[resource]
        elif existence in {"ABSENT", "ABSENT_LOCKED"}:
            state = "ABSENT"
        elif visibility == "VISIBLE":
            state = "FREE_VISIBLE"
        elif visibility == "PARTIAL":
            state = "NOT_FREE_UNCERTAIN"
        elif visibility in {"OCCLUDED", "OUT_OF_FRAME"}:
            state = "PRESENT_LOCKED_OCCLUDED"
        elif existence == "PRESENT_LOCKED":
            state = "PRESENT_NOT_CONFIRMED_FREE"
        else:
            state = "UNCLEAR"
        states[participant_id] = state
        locks.append(
            f"{resource}={state};existence={existence};"
            f"visibility={visibility};evidence={evidence}"
        )
        if state == "FREE_VISIBLE":
            free_targets.append(resource)
        elif state not in {"ABSENT"}:
            exclusions.append(resource)

    return (
        tuple(locks),
        tuple(free_targets),
        tuple(exclusions),
        tuple(primary_engaged),
        states,
        tuple(anatomy_inventory_locks),
        existence_by_owner,
        visibility_by_owner,
    )


def _action_active(value: Any) -> bool:
    if not isinstance(value, dict):
        return bool(value)
    action_class = _text(
        _first(value, "action_class", "class", "type"),
        "",
    )
    return action_class not in _INACTIVE_ACTION_CLASSES


def _active_contacts(value: Any) -> list[dict[str, Any]]:
    contacts: list[dict[str, Any]] = []
    if isinstance(value, list):
        candidates = value
    elif isinstance(value, dict):
        candidates = list(value.values())
    else:
        candidates = []
    for contact in candidates:
        if not isinstance(contact, dict):
            continue
        state = _text(_first(contact, "state", "contact_state", "phase"), "")
        if state in _INACTIVE_CONTACT_STATES:
            continue
        contacts.append(contact)
    return contacts


def _opening_lock(
    opening: Any,
    owner: Any,
    source: str,
) -> str | None:
    opening_text = _text(opening, "NONE")
    if opening_text not in _OPENINGS or opening_text == "NONE":
        return None
    owner_text = _text(owner, "UNCLEAR")
    return f"{source}:{owner_text}={opening_text}"


def _target_opening_locks(
    data: dict[str, Any],
    contacts: list[dict[str, Any]],
) -> tuple[str, ...]:
    locks: list[str] = []
    for index, contact in enumerate(contacts, 1):
        lock = _opening_lock(
            contact.get("target_opening"),
            _first(contact, "target_owner_or_object", "target_owner"),
            str(contact.get("contact_id") or f"CONTACT_{index}"),
        )
        if lock and lock not in locks:
            locks.append(lock)

    for slot, key in (
        ("PRIMARY", "primary_action_signature"),
        ("SECONDARY", "secondary_action_signature"),
    ):
        action = data.get(key)
        if not isinstance(action, dict) or not _action_active(action):
            continue
        lock = _opening_lock(
            action.get("target_opening"),
            _first(action, "target_opening_owner", "target_owner"),
            slot,
        )
        if lock and lock not in locks:
            locks.append(lock)
    return tuple(locks)


def _geometry_locks(data: dict[str, Any]) -> tuple[str, ...]:
    geometry = data.get("pairwise_geometry")
    if not isinstance(geometry, list):
        return ()
    locks: list[str] = []
    for relation in geometry[:6]:
        if not isinstance(relation, dict):
            continue
        pair = _text(_first(relation, "participants", "pair"), "PAIR")
        confidence = _confidence(relation.get("confidence"))
        parts = []
        for key in (
            "facing_relation",
            "vertical_relation",
            "depth_relation",
            "pelvis_relation",
            "support_relation",
        ):
            value = _compact(relation.get(key), default="", limit=55)
            if value:
                parts.append(f"{key}={value}")
        if parts:
            locks.append(f"{pair}[{confidence}]:" + ";".join(parts))
    return tuple(locks)


def _contact_locks(contacts: list[dict[str, Any]]) -> tuple[str, ...]:
    locks: list[str] = []
    for index, contact in enumerate(contacts[:12], 1):
        contact_id = str(contact.get("contact_id") or f"CONTACT_{index}")
        source_owner = _text(contact.get("source_owner"), "UNCLEAR")
        source_part = _text(contact.get("source_body_part"), "UNCLEAR")
        target_owner = _text(
            _first(contact, "target_owner_or_object", "target_owner"),
            "UNCLEAR",
        )
        target_surface = _text(contact.get("target_surface"), "UNCLEAR")
        target_opening = _text(contact.get("target_opening"), "NONE")
        state = _text(_first(contact, "state", "contact_state", "phase"), "UNCLEAR")
        confidence = _confidence(contact.get("confidence"))
        target = target_opening if target_opening not in {"NONE", "UNCLEAR"} else target_surface
        locks.append(
            f"{contact_id}:{source_owner}.{source_part}->{target_owner}.{target};"
            f"state={state};confidence={confidence}"
        )
    return tuple(locks)


@dataclass(frozen=True)
class ParticipantState:
    participant_id: str
    anatomy_class: str
    anatomy_confidence: int
    penis_evidence: str
    penis_existence: str
    penis_visibility: str
    penis_resource_state: str
    pose: str
    orientation: str
    support_points: str
    left_hand: str
    right_hand: str
    left_hand_lock: str
    right_hand_lock: str
    occlusion: str


@dataclass(frozen=True)
class SceneState:
    parsed: bool
    gate: str
    participants: tuple[ParticipantState, ...]
    participant_count: int
    position_family: str
    position_confidence: int
    geometry_locks: tuple[str, ...]
    contact_locks: tuple[str, ...]
    support_stability: str
    motion_freedom: str
    occlusion_risk: str
    identity_risk: str
    camera_motion: str
    camera_framing: str
    contact_count: int
    active_action_count: int
    existing_secondary_action: bool
    concurrency_compatible: bool
    has_visible_free_hand: bool
    target_openings: tuple[str, ...]
    persistent_anatomy_locks: tuple[str, ...]
    hand_reconstruction_locks: tuple[str, ...]
    high_risk_hand_count: int
    penis_resource_locks: tuple[str, ...]
    free_manual_penis_targets: tuple[str, ...]
    forbidden_manual_penis_targets: tuple[str, ...]
    primary_engaged_resources: tuple[str, ...]
    complexity_score: int
    complexity: str
    uncertainty_count: int

    @property
    def blocked(self) -> bool:
        return self.gate == "BLOCKED_ADULT_SCENE"

    @property
    def anatomy_summary(self) -> str:
        if not self.participants:
            return "UNAVAILABLE"
        return ", ".join(
            f"{item.participant_id}={item.anatomy_class}({item.anatomy_confidence})"
            for item in self.participants
        )

    def lock_block(self) -> str:
        participant_lines = []
        for item in self.participants:
            participant_lines.append(
                f"{item.participant_id}: anatomy={item.anatomy_class}; "
                f"confidence={item.anatomy_confidence}; "
                f"penis_evidence={item.penis_evidence}; "
                f"penis_existence={item.penis_existence}; "
                f"penis_visibility={item.penis_visibility}; "
                f"penis_state={item.penis_resource_state}; pose={item.pose}; "
                f"orientation={item.orientation}; supports={item.support_points}; "
                f"left_hand={item.left_hand}; right_hand={item.right_hand}; "
                f"occlusion={item.occlusion}"
            )
        openings = " | ".join(self.target_openings) or "NONE_CONFIRMED"
        geometry = " | ".join(self.geometry_locks) or "UNAVAILABLE"
        contacts = " | ".join(self.contact_locks) or "NONE_REGISTERED"
        anatomy_inventory = (
            " | ".join(self.persistent_anatomy_locks) or "NONE_REGISTERED"
        )
        hand_locks = (
            " | ".join(self.hand_reconstruction_locks) or "NONE_REGISTERED"
        )
        penis_resources = " | ".join(self.penis_resource_locks) or "NONE_REGISTERED"
        free_targets = " | ".join(self.free_manual_penis_targets) or "NONE"
        forbidden_targets = " | ".join(self.forbidden_manual_penis_targets) or "NONE"
        primary_engaged = " | ".join(self.primary_engaged_resources) or "NONE"
        return (
            "\n\nVELVET VICE IMMUTABLE SCENE LOCK SNAPSHOT\n"
            f"PARTICIPANT_COUNT: {self.participant_count}\n"
            f"PARTICIPANTS: {' | '.join(participant_lines) or 'UNAVAILABLE'}\n"
            f"POSITION_FAMILY: {self.position_family}\n"
            f"POSITION_CONFIDENCE: {self.position_confidence}\n"
            f"PAIRWISE_GEOMETRY_LOCKS: {geometry}\n"
            f"CONTACT_STATE_LOCKS: {contacts}\n"
            f"TARGET_OPENING_LOCKS: {openings}\n"
            f"PERSISTENT_ANATOMY_INVENTORY: {anatomy_inventory}\n"
            f"HAND_RECONSTRUCTION_LOCKS: {hand_locks}\n"
            f"HIGH_RISK_HAND_COUNT: {self.high_risk_hand_count}\n"
            f"PENIS_RESOURCE_LOCKS: {penis_resources}\n"
            f"PRIMARY_ENGAGED_ANATOMY: {primary_engaged}\n"
            f"FREE_MANUAL_PENIS_TARGETS: {free_targets}\n"
            f"FORBIDDEN_MANUAL_PENIS_TARGETS: {forbidden_targets}\n"
            f"SUPPORT_STABILITY: {self.support_stability}\n"
            f"MOTION_FREEDOM: {self.motion_freedom}\n"
            f"OCCLUSION_RISK: {self.occlusion_risk}\n"
            f"IDENTITY_RISK: {self.identity_risk}\n"
            f"EXISTING_SECONDARY_ACTION: {'YES' if self.existing_secondary_action else 'NO'}\n"
            "Never change participant identity, anatomy class, anatomy owner, "
            "left/right limb ownership, established target opening, pairwise "
            "geometry, support relation or existing contact merely to make "
            "choreography easier. An already established secondary action is "
            "part of the first-frame continuity and must not be deleted just "
            "because no new secondary action is permitted. Any resource marked "
            "ENGAGED_PRIMARY remains attached, visible when not physically occluded, "
            "and dedicated to the primary action. It may not become a manual target, "
            "self-stimulation target, free anatomy candidate or replacement action. "
            "Only a resource listed under FREE_MANUAL_PENIS_TARGETS may be selected "
            "for a newly introduced manual penis action. Anatomy existence and "
            "visibility are independent: PRESENT_LOCKED remains present through "
            "occlusion, receiving roles and camera cropping and must reappear only "
            "on the same owner when physically revealed. A receptive anal or vaginal "
            "role never changes FUTANARI into WOMAN and never removes the receiver's "
            "penis. For every hand marked PRESERVE_OCCLUSION_NO_COMPLETION, preserve "
            "the existing occlusion and visible silhouette; do not reveal hidden "
            "fingers, invent a complete hand, duplicate a thumb or add a sixth digit."
        )


def _fallback_scene() -> SceneState:
    return SceneState(
        parsed=False,
        gate="UNKNOWN",
        participants=(),
        participant_count=0,
        position_family="UNCLEAR",
        position_confidence=0,
        geometry_locks=(),
        contact_locks=(),
        support_stability="UNCLEAR",
        motion_freedom="UNCLEAR",
        occlusion_risk="HIGH",
        identity_risk="HIGH",
        camera_motion="UNCLEAR",
        camera_framing="UNCLEAR",
        contact_count=0,
        active_action_count=0,
        existing_secondary_action=False,
        concurrency_compatible=False,
        has_visible_free_hand=False,
        target_openings=(),
        persistent_anatomy_locks=(),
        hand_reconstruction_locks=(),
        high_risk_hand_count=0,
        penis_resource_locks=(),
        free_manual_penis_targets=(),
        forbidden_manual_penis_targets=(),
        primary_engaged_resources=(),
        complexity_score=8,
        complexity="HIGH",
        uncertainty_count=4,
    )


def analyze_scene_state(analyzer_output: str) -> SceneState:
    data = parse_json_object(analyzer_output)
    if data is None:
        return _fallback_scene()

    gate = _text(data.get("gate"), "PASS")
    participant_items = _participant_items(data)
    explicit_count = _first(data, "participant_count", "participants_count")
    try:
        participant_count = int(explicit_count)
    except (TypeError, ValueError):
        participant_count = len(participant_items)
    participant_count = max(
        len(participant_items),
        max(1, min(4, participant_count or 1)),
    )

    contact_registry = _first(data, "contact_registry", "contact_graph", "contacts")
    contacts = _active_contacts(contact_registry)
    primary = _first(data, "primary_action_signature", "primary_action")
    secondary = _first(data, "secondary_action_signature", "secondary_action")
    (
        penis_resource_locks,
        free_manual_penis_targets,
        forbidden_manual_penis_targets,
        primary_engaged_resources,
        penis_state_by_owner,
        persistent_anatomy_locks,
        penis_existence_by_owner,
        penis_visibility_by_owner,
    ) = _penis_resource_registry(data, contacts, participant_items)

    participant_states: list[ParticipantState] = []
    hand_reconstruction_locks: list[str] = []
    high_risk_hand_count = 0
    uncertainty_count = 0
    has_visible_free_hand = False
    for participant_id, participant in participant_items:
        anatomy, anatomy_confidence = _anatomy_label(participant)
        limbs = _first(participant, "limb_registry", "limbs", "hand_anchors")
        if not isinstance(limbs, dict):
            limbs = participant
        left_state = _hand_state(
            participant_id,
            "LEFT",
            _first(limbs, "left_hand", "LEFT_HAND"),
        )
        right_state = _hand_state(
            participant_id,
            "RIGHT",
            _first(limbs, "right_hand", "RIGHT_HAND"),
        )
        left_hand = left_state.state
        right_hand = right_state.state
        hand_reconstruction_locks.extend(
            (left_state.lock_line(), right_state.lock_line())
        )
        high_risk_hand_count += int(left_state.high_risk)
        high_risk_hand_count += int(right_state.high_risk)
        occlusion = _text(
            _first(participant, "occlusion", "occlusion_level", "visibility")
        )
        pose = _compact(_first(participant, "pose", "posture"), default="UNCLEAR")
        orientation = _compact(
            _first(participant, "orientation", "facing_direction"),
            default="UNCLEAR",
        )
        support_points = _compact(
            _first(participant, "support_points", "supports"),
            default="UNCLEAR",
        )
        if anatomy == "UNCLEAR" or anatomy_confidence < 60:
            uncertainty_count += 1
        if left_state.high_risk:
            uncertainty_count += 1
        if right_state.high_risk:
            uncertainty_count += 1
        if left_state.new_action_safe or right_state.new_action_safe:
            has_visible_free_hand = True
        penis_evidence = _participant_penis_evidence(participant)
        penis_existence = penis_existence_by_owner.get(participant_id, "UNCLEAR")
        penis_visibility = penis_visibility_by_owner.get(participant_id, "UNCLEAR")
        penis_resource_state = penis_state_by_owner.get(participant_id, "UNCLEAR")
        if penis_resource_state in {"NOT_FREE_UNCERTAIN", "PRESENT_NOT_CONFIRMED_FREE", "UNCLEAR"}:
            uncertainty_count += 1
        participant_states.append(
            ParticipantState(
                participant_id=participant_id,
                anatomy_class=anatomy,
                anatomy_confidence=anatomy_confidence,
                penis_evidence=penis_evidence,
                penis_existence=penis_existence,
                penis_visibility=penis_visibility,
                penis_resource_state=penis_resource_state,
                pose=pose,
                orientation=orientation,
                support_points=support_points,
                left_hand=left_hand,
                right_hand=right_hand,
                left_hand_lock=left_state.lock_line(),
                right_hand_lock=right_state.lock_line(),
                occlusion=occlusion,
            )
        )

    position = _first(data, "position_signature", "position", "geometry")
    if not isinstance(position, dict):
        position = {}
    position_family = _text(
        _first(data, "position_family")
        or _first(position, "family", "position_family")
    )
    position_confidence = _confidence(
        _first(data, "position_confidence")
        or _first(position, "confidence", "position_confidence")
    )

    stability = _first(data, "scene_stability", "support_stability")
    if isinstance(stability, dict):
        support_stability = _text(
            _first(stability, "support_stability", "level", "stability")
        )
        motion_freedom = _text(_first(stability, "motion_freedom"))
        occlusion_risk = _text(_first(stability, "occlusion_risk"))
        identity_risk = _text(_first(stability, "identity_risk"))
    else:
        support_stability = _text(stability)
        motion_freedom = _text(data.get("motion_freedom"))
        occlusion_risk = _text(data.get("occlusion_risk"))
        identity_risk = _text(data.get("identity_risk"))

    camera = data.get("camera")
    if not isinstance(camera, dict):
        camera = {}
    camera_motion = _text(
        _first(camera, "motion", "camera_motion") or data.get("camera_motion")
    )
    camera_framing = _text(
        _first(camera, "framing", "shot", "camera_framing")
        or data.get("camera_framing")
    )

    contact_count = len(contacts)
    primary_active = _action_active(primary)
    secondary_active = _action_active(secondary)
    active_action_count = int(primary_active) + int(secondary_active)

    concurrency = data.get("concurrency_plan")
    if not isinstance(concurrency, dict):
        concurrency = {}
    concurrency_compatible = _bool(concurrency.get("compatible"))

    geometry_locks = _geometry_locks(data)
    contact_locks = _contact_locks(contacts)
    openings = _target_opening_locks(data, contacts)

    score = 0
    score += max(0, participant_count - 1) * 2
    if participant_count >= 3:
        score += 2
    score += min(4, contact_count)
    if active_action_count >= 2:
        score += 2
    score += min(3, uncertainty_count // 2)
    score += min(2, high_risk_hand_count)
    if position_confidence and position_confidence < 50:
        score += 2
    elif position_confidence and position_confidence < 70:
        score += 1
    if support_stability in {"LOW", "UNSTABLE", "FRAGILE"}:
        score += 3
    elif support_stability in {"MEDIUM", "MODERATE", "UNCLEAR"}:
        score += 1
    if motion_freedom in {"LOW", "RESTRICTED"}:
        score += 2
    if occlusion_risk == "HIGH":
        score += 2
    elif occlusion_risk in {"MEDIUM", "UNCLEAR"}:
        score += 1
    if identity_risk == "HIGH":
        score += 2
    elif identity_risk in {"MEDIUM", "UNCLEAR"}:
        score += 1
    if camera_motion not in {"STATIC", "LOCKED", "PRESERVE", "NONE", "UNCLEAR"}:
        score += 2
    if camera_framing in {"EXTREME_CLOSE_UP", "TIGHT_CLOSE_UP"}:
        score += 1

    if score <= 3:
        complexity = "LOW"
    elif score <= 7:
        complexity = "MEDIUM"
    elif score <= 11:
        complexity = "HIGH"
    else:
        complexity = "VERY_HIGH"

    return SceneState(
        parsed=True,
        gate=gate,
        participants=tuple(participant_states),
        participant_count=participant_count,
        position_family=position_family,
        position_confidence=position_confidence,
        geometry_locks=geometry_locks,
        contact_locks=contact_locks,
        support_stability=support_stability,
        motion_freedom=motion_freedom,
        occlusion_risk=occlusion_risk,
        identity_risk=identity_risk,
        camera_motion=camera_motion,
        camera_framing=camera_framing,
        contact_count=contact_count,
        active_action_count=active_action_count,
        existing_secondary_action=secondary_active,
        concurrency_compatible=concurrency_compatible,
        has_visible_free_hand=has_visible_free_hand,
        target_openings=openings,
        persistent_anatomy_locks=persistent_anatomy_locks,
        hand_reconstruction_locks=tuple(hand_reconstruction_locks),
        high_risk_hand_count=high_risk_hand_count,
        penis_resource_locks=penis_resource_locks,
        free_manual_penis_targets=free_manual_penis_targets,
        forbidden_manual_penis_targets=forbidden_manual_penis_targets,
        primary_engaged_resources=primary_engaged_resources,
        complexity_score=score,
        complexity=complexity,
        uncertainty_count=uncertainty_count,
    )


@dataclass(frozen=True)
class ChoreographyPlan:
    beat_budget: int
    nominal_beats: int
    complexity: str
    complexity_score: int
    transition_budget: int
    secondary_action_allowed: bool
    manual_penis_secondary_allowed: bool
    preserve_existing_secondary: bool
    large_reposition_allowed: bool
    legacy_fallback: bool
    variation_priority: tuple[str, ...]
    reason: str

    def control_block(self, duration: DurationContext) -> str:
        new_secondary = "YES" if self.secondary_action_allowed else "NO"
        preserve_secondary = "YES" if self.preserve_existing_secondary else "NO"
        manual_penis_secondary = "YES" if self.manual_penis_secondary_allowed else "NO"
        reposition = "YES" if self.large_reposition_allowed else "NO"
        fallback = "YES" if self.legacy_fallback else "NO"
        return (
            "\n\nVELVET VICE DETERMINISTIC CHOREOGRAPHY BUDGET\n"
            f"DURATION_PROFILE: {duration.profile}\n"
            f"NOMINAL_BEAT_BUDGET: {self.nominal_beats}\n"
            f"SAFE_BEAT_BUDGET: {self.beat_budget}\n"
            f"SCENE_COMPLEXITY: {self.complexity} ({self.complexity_score})\n"
            f"POSITION_TRANSITION_BUDGET: {self.transition_budget}\n"
            f"PRESERVE_EXISTING_SECONDARY_ACTION: {preserve_secondary}\n"
            f"NEW_SECONDARY_ACTION_PERMITTED: {new_secondary}\n"
            f"NEW_MANUAL_PENIS_SECONDARY_PERMITTED: {manual_penis_secondary}\n"
            "MAXIMUM_CONCURRENT_ACTIONS: 2\n"
            f"LARGE_REPOSITION_PERMITTED: {reposition}\n"
            f"LEGACY_FALLBACK_ACTIVE: {fallback}\n"
            f"VARIATION_PRIORITY: {', '.join(self.variation_priority)}\n"
            f"PLAN_REASON: {self.reason}\n"
            "A beat is a causal development phase, not automatically a new "
            "action. Fill longer clips through controlled rhythm, range, body "
            "tension, expression, grip, weight and only then compatible contact "
            "development. Never exceed the safe beat, transition or concurrent-"
            "action budget. Preserve every already established action/contact; "
            "a NO value for NEW_SECONDARY_ACTION_PERMITTED forbids adding a new "
            "one but never deletes a secondary action visible in the first frame. "
            "For any newly introduced manual penis action, the target must appear "
            "verbatim in FREE_MANUAL_PENIS_TARGETS. Never target a penis marked "
            "ENGAGED_PRIMARY, ENGAGED_SECONDARY, ENGAGED_CONTACT, uncertain or "
            "occluded. Established penetration must keep its active penis and target "
            "opening; never replace it with self-manual stimulation or a handjob. "
            "A hand with an occluded, partial, out-of-frame or unclear start state "
            "may not be relocated or completed. Preserve the visible silhouette and "
            "occlusion instead of exposing hidden fingers or inventing a full hand."
        )


def build_choreography_plan(
    duration: DurationContext,
    scene: SceneState,
) -> ChoreographyPlan:
    nominal = duration.nominal_beats
    reduction = {
        "LOW": 0,
        "MEDIUM": 1 if duration.seconds > 10 else 0,
        "HIGH": 1,
        "VERY_HIGH": 2,
    }.get(scene.complexity, 1)
    if scene.participant_count >= 3:
        reduction += 1
    if scene.uncertainty_count >= 4:
        reduction += 1

    minimum = 1 if duration.seconds <= 6 else 2
    beat_budget = max(minimum, nominal - reduction)
    legacy_fallback = not scene.parsed or scene.blocked

    if legacy_fallback:
        beat_budget = min(beat_budget, 2 if duration.seconds > 6 else 1)

    preserve_existing_secondary = (
        not legacy_fallback and scene.existing_secondary_action
    )

    transition_budget = 0
    if (
        not legacy_fallback
        and not preserve_existing_secondary
        and duration.seconds >= 8
        and scene.complexity in {"LOW", "MEDIUM"}
        and scene.support_stability not in {"LOW", "UNSTABLE", "FRAGILE"}
        and scene.occlusion_risk != "HIGH"
        and scene.identity_risk != "HIGH"
    ):
        transition_budget = 1

    resource_signal = scene.concurrency_compatible or scene.has_visible_free_hand
    secondary_allowed = (
        not legacy_fallback
        and not preserve_existing_secondary
        and scene.active_action_count < 2
        and duration.seconds >= 8
        and scene.participant_count <= 3
        and scene.complexity in {"LOW", "MEDIUM", "HIGH"}
        and scene.uncertainty_count < 5
        and scene.occlusion_risk != "HIGH"
        and scene.identity_risk != "HIGH"
        and resource_signal
    )

    manual_penis_secondary_allowed = (
        secondary_allowed
        and scene.has_visible_free_hand
        and bool(scene.free_manual_penis_targets)
    )

    large_reposition_allowed = (
        not legacy_fallback
        and not preserve_existing_secondary
        and duration.seconds >= 16
        and scene.complexity == "LOW"
        and scene.position_confidence >= 70
        and scene.support_stability in {"HIGH", "STABLE"}
        and scene.motion_freedom in {"HIGH", "MEDIUM"}
        and scene.occlusion_risk == "LOW"
        and scene.identity_risk == "LOW"
    )

    priority = [
        "RHYTHM_VARIATION",
        "EXPRESSION_AND_BREATH",
        "BODY_TENSION_AND_RELEASE",
    ]
    if scene.complexity != "VERY_HIGH" and scene.high_risk_hand_count == 0:
        priority.append("GRIP_ADJUSTMENT")
    if scene.complexity != "VERY_HIGH":
        priority.append("SMALL_WEIGHT_SHIFT")
    if scene.complexity in {"LOW", "MEDIUM"}:
        priority.append("BODY_ANGLE_VARIATION")
    if preserve_existing_secondary:
        priority.append("PRESERVE_EXISTING_SECONDARY_ACTION")
    elif secondary_allowed:
        priority.append("ONE_COMPATIBLE_SECONDARY_ACTION")
    if transition_budget:
        priority.append("ONE_LOW_COST_TRANSITION")

    if legacy_fallback:
        reason = (
            "Analyzer output was unavailable or blocked; preserve the proven "
            "legacy action and use only low-risk variation."
        )
    else:
        reason = (
            f"{duration.seconds:g}s {duration.profile.lower()} clip with "
            f"{scene.participant_count} participant(s), {scene.complexity.lower()} "
            "scene complexity and immutable anatomy/contact ownership."
        )

    return ChoreographyPlan(
        beat_budget=beat_budget,
        nominal_beats=nominal,
        complexity=scene.complexity,
        complexity_score=scene.complexity_score,
        transition_budget=transition_budget,
        secondary_action_allowed=secondary_allowed,
        manual_penis_secondary_allowed=manual_penis_secondary_allowed,
        preserve_existing_secondary=preserve_existing_secondary,
        large_reposition_allowed=large_reposition_allowed,
        legacy_fallback=legacy_fallback,
        variation_priority=tuple(priority),
        reason=reason,
    )
