"""Post-session exercise detection from a homework transcript.

Firestore layout in this repo is `homework_sessions/{session_id}` (not `sessions/`).
Transcripts live on the session document as `raw_transcript_ref`.
Detected exercises are written to `homework_sessions/{session_id}/exercises/{exercise_id}`.

Design flags (hackathon budget) are in MODULE_FLAGS.
"""

from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path

from dotenv import load_dotenv
from google import genai
from google.genai import types
from pydantic import ValidationError

from db import (
    get_homework_session,
    is_generic_title,
    list_concepts,
    replace_session_exercises,
    set_session_analysis_status,
    title_from_concept_ids,
)
from models.exercise import Exercise

_APP_DIR = Path(__file__).resolve().parent
load_dotenv(_APP_DIR / ".env")

logger = logging.getLogger(__name__)

DETECTION_MODEL = os.getenv("EXERCISE_DETECTOR_MODEL", "gemini-3.5-flash-lite")
UNKNOWN_STUDENT_ID = "unknown_student"

LATEX_WRITING = r"""
LaTeX (required for any math in title, tutor_notes, hints, stuck_points, errors, and reasoning):
- Put every formula, derivative, exponent, fraction, root, and function in inline math: $...$
- Examples: $f(x)=3x^{4}-2x^{2}$, $\sin(3x)e^{2x}$, $\frac{d}{dx}x^{3}$, $f'(2)=12$
- Title examples: "Power rule on $3x^{4}-2x^{2}$", "Product rule for $\sin(3x)e^{2x}$", "Tangent to $x^{3}$ at $x=2$"
- Use $$...$$ only for a standalone displayed equation.
- Do not use unicode exponents (x², x⁴) or bare caret outside math (x^2).
- Do not wrap ordinary English words in dollar signs.
"""

MODULE_FLAGS = """
Exercise model vs transcript mismatches (not silently remapped):
- There is no `statement` / problem-text field on Exercise. The problem the student
  was working on can only live in tutor_notes (wrong semantic) or a new field.
- `student_id` is required but HomeworkSession does not store a student. Filled as
  'unknown_student'.
- Older transcripts may lack per-turn timestamps. New sessions store them.
  Exercise started_at/ended_at/duration_seconds are computed from turn times
  (or interpolated on the session clock) — not invented by Gemini.
- `errors.matched_common_mistake` refers to a pre-authored common_mistakes list
  that does not exist on Exercise. The model is told to treat this as "looks like a
  typical textbook slip" — that is a stretch, not a real join.
- `independence_score` is defined as a derived metric (hints + errors + time-to-
  first-move). We let Gemini estimate it; a deterministic formula would be better.
- Concept documents have no `course` field in this repo (domain/subdomain only).
"""


# Fields we fill from the parent session / detector, not from conversational content.
_SESSION_OWNED_FIELDS = {
    "exercise_id",
    "student_id",
    "session_id",
    "started_at",
    "ended_at",
    "duration_seconds",
}


def _parse_datetime(value) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value
    text = str(value).replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed


def _normalize_transcript(raw) -> list[dict]:
    if not raw:
        return []
    if isinstance(raw, str):
        return [{"role": "user", "text": raw, "timestamp": None}]

    turns = []
    for index, message in enumerate(raw):
        if not isinstance(message, dict):
            continue
        role = (message.get("role") or "user").lower()
        if role in {"observation", "visual", "note"}:
            role = "observation"
        elif role in {"agent", "gemini", "tutor", "assistant", "model"}:
            role = "model"
        elif role != "user":
            role = "user"
        text = (message.get("text") or "").strip()
        if not text:
            continue
        turn = {
            "index": index,
            "role": role,
            "text": text,
            "timestamp": message.get("timestamp"),
        }
        if role == "observation" and message.get("kind"):
            turn["kind"] = message.get("kind")
        turns.append(turn)
    return turns


def _build_gemini_schema(valid_ids: list[str]) -> dict:
    """JSON schema for Gemini, derived from Exercise.model_json_schema().

    Session-owned fields stay in the schema (Gemini may fill them) but are not
    required, because the transcript cannot actually supply them. Hint.timestamp
    is likewise optional. concept_ids is constrained to the Firestore catalog.
    We hydrate session-owned fields after the model returns, then validate the
    full Exercise object.
    """
    exercise_schema = Exercise.model_json_schema()
    defs = exercise_schema.pop("$defs", {})
    hint = defs.get("Hint")
    if isinstance(hint, dict) and "required" in hint:
        hint["required"] = [name for name in hint["required"] if name != "timestamp"]
    properties = exercise_schema.setdefault("properties", {})
    properties["start_turn_index"] = {
        "type": "integer",
        "description": "Transcript turn index where this exercise begins",
    }
    properties["end_turn_index"] = {
        "type": "integer",
        "description": "Transcript turn index where this exercise ends",
    }
    if valid_ids:
        concept_enum = {"type": "string", "enum": valid_ids}
        concept_ids_schema = properties.get("concept_ids") or {}
        properties["concept_ids"] = {
            **concept_ids_schema,
            "type": "array",
            "items": concept_enum,
            "uniqueItems": True,
        }
        for def_name in ("StuckPoint", "ExerciseError"):
            nested = defs.get(def_name)
            if isinstance(nested, dict):
                nested_props = nested.setdefault("properties", {})
                nested_props["related_concept_id"] = {
                    **nested_props.get("related_concept_id", {}),
                    **concept_enum,
                }
    required = [
        name
        for name in exercise_schema.get("required", [])
        if name not in _SESSION_OWNED_FIELDS
    ]
    if "title" not in required:
        required.append("title")
    exercise_schema["required"] = required
    schema = {
        "type": "object",
        "properties": {
            "exercises": {
                "type": "array",
                "items": exercise_schema,
            }
        },
        "required": ["exercises"],
    }
    if defs:
        schema["$defs"] = defs
    return schema


def _load_concepts() -> list[dict]:
    concepts = list_concepts()
    if concepts:
        return concepts
    logger.warning(
        "Firestore collection 'concepts' is empty; falling back to data/concepts.json"
    )
    from concepts import concept_store

    return [concept.model_dump() for concept in concept_store.all()]


def _concept_catalog_text(concepts: list[dict]) -> str:
    lines = []
    for concept in concepts:
        concept_id = concept.get("concept_id")
        if not concept_id:
            continue
        name = concept.get("name") or ""
        description = concept.get("description") or ""
        domain = concept.get("domain") or ""
        subdomain = concept.get("subdomain") or ""
        keywords = ", ".join(concept.get("keywords") or [])
        extra = f" | keywords: {keywords}" if keywords else ""
        lines.append(
            f"- {concept_id} | {name} | {domain}/{subdomain} | {description}{extra}"
        )
    return "\n".join(lines)


def _build_prompt(
    session_id: str,
    session: dict,
    turns: list[dict],
    concepts: list[dict],
) -> str:
    valid_ids = [c.get("concept_id") for c in concepts if c.get("concept_id")]
    started = session.get("started_at") or ""
    ended = session.get("ended_at") or started
    transcript_json = json.dumps(turns, ensure_ascii=False, indent=2)
    return f"""You are a post-session analyst for an AI math tutor.

Segment this tutoring transcript into distinct homework exercises the student worked on.

Session:
- session_id: {session_id}
- student_id: {UNKNOWN_STUDENT_ID}
- session started_at: {started}
- session ended_at: {ended}

Valid concept_id values (closed list from Firestore `concepts` — NEVER invent IDs):
{chr(10).join(valid_ids)}

Concept catalog — classify EVERY concept below against each exercise:
{_concept_catalog_text(concepts)}

Transcript (role "user" = student, role "model" = spoken tutor, role "observation" = silent camera notes the tutor logged while watching the paper; those were NOT spoken):
{transcript_json}

Segmentation rules:
- Split only when conversational cues show a new problem (student reads a new exercise, tutor says let's move on, a clear topic/problem shift, or the tutor describes a different problem on screen).
- A short or informal problem still counts (e.g. "1+1 = 2", a fraction to simplify). Length does not matter.
- If the student never states the problem but the tutor clearly identifies one from the camera/screen, that still counts as one exercise.
- Observation turns are ground truth for what happened on paper: use them for errors, stuck_points.observed_behavior, whether they self-corrected, how long they seemed to pause, and tutor_notes. Do not treat them as spoken dialogue.
- If the boundary is ambiguous, UNDER-SPLIT: merge into one exercise rather than inventing extra ones.
- Return {{"exercises": []}} only when there is no math work at all (greeting, mic test, "can you hear me", no problem discussed). Do not force a split of a pure greeting.
- Ignore the opening tutor greeting itself; start the first exercise when math work actually begins.

Concept classification (required for every exercise):
- This is multi-label classification over the Firestore catalog above.
- For each exercise, consider every concept_id. If the student practiced, used, or was stuck on that skill, include it in concept_ids.
- Include the most specific matching concepts AND clearly demonstrated prerequisites (e.g. "1+1=2" → ["addition"]; evaluating f(2) → ["function_evaluation"] and ["functions_notation"] if notation was used).
- Do not attach unrelated catalog items. Do not invent IDs. An empty concept_ids is allowed only if truly none of the catalog concepts apply.
- Order concept_ids with the primary skill first.

Field rules for each exercise (must match the Exercise schema):
{LATEX_WRITING}
- title: a unique, specific name for THIS problem (4–8 words). Describe the actual math (function, rule, or question), not "Exercise 1" or the concept name alone. Every title in this session MUST be different from the others.
- session_id: always "{session_id}"
- student_id: always "{UNKNOWN_STUDENT_ID}"
- exercise_id: stable slug unique in this session, e.g. "{session_id}_ex_01"
- concept_ids: 1+ IDs from the valid list whenever any catalog concept matches.
- start_turn_index / end_turn_index: integers from the transcript "index" field for the first and last turn of this exercise. Required for timing.
- Omit started_at, ended_at, and duration_seconds. Those are computed from the turn window and session clock.
- outcome: completed_correct | completed_incorrect | abandoned | completed_with_help
- hints_given: tutor guiding questions/hints. hint_level starts at 1 and increases. triggered_by is student_asked or tutor_offered. timestamp: use the turn timestamp if present, otherwise session started_at. Write math in the hint text as LaTeX.
- stuck_points / errors: related_concept_id must be in the valid list. matched_common_mistake: true only if it is a typical textbook slip; we have no common_mistakes catalog. Write math in descriptions as LaTeX.
- confidence_assessment: low|medium|high plus a short reasoning grounded in the transcript
- independence_score: 0-1 estimate (fewer hints/errors => higher)
- final_answer_given, correct, tutor_notes: from the transcript AND silent observation turns. tutor_notes = brief tutor-facing recap that includes what the camera saw (how long they paused, visible slips, self-corrections, clean work) with LaTeX for formulas. NOT a dump of the problem statement (Exercise has no statement field).

Return JSON only: an object with key "exercises" whose value is an array of Exercise objects.
"""


def _as_int(value) -> int | None:
    if value is None or value == "":
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _session_bounds(session: dict) -> tuple[datetime, datetime]:
    started = _parse_datetime(session.get("started_at")) or datetime.now(timezone.utc)
    ended = _parse_datetime(session.get("ended_at")) or started
    if ended < started:
        ended = started
    return started, ended


def _interpolated_time(
    session_start: datetime,
    session_end: datetime,
    index: int,
    n_turns: int,
) -> datetime:
    if n_turns <= 1:
        return session_start
    fraction = max(0.0, min(1.0, index / (n_turns - 1)))
    delta = (session_end - session_start).total_seconds()
    return session_start + timedelta(seconds=delta * fraction)


def _turn_time(
    turns: list[dict],
    index: int,
    session_start: datetime,
    session_end: datetime,
) -> datetime:
    n_turns = len(turns)
    clamped = min(max(index, 0), max(n_turns - 1, 0))
    turn = turns[clamped] if turns else None
    parsed = _parse_datetime(turn.get("timestamp")) if turn else None
    if parsed:
        return parsed
    return _interpolated_time(session_start, session_end, clamped, n_turns)


def _default_turn_range(index: int, count: int, n_turns: int) -> tuple[int, int]:
    if n_turns <= 0 or count <= 0:
        return 0, 0
    start = int((index - 1) / count * n_turns)
    end = int(index / count * n_turns) - 1
    if end < start:
        end = start
    return start, min(end, n_turns - 1)


def _exercise_clock(
    *,
    raw: dict,
    session: dict,
    turns: list[dict],
    index: int,
    exercise_count: int,
) -> tuple[datetime, datetime, int]:
    session_start, session_end = _session_bounds(session)
    n_turns = len(turns)
    start_idx = _as_int(raw.get("start_turn_index"))
    end_idx = _as_int(raw.get("end_turn_index"))
    if start_idx is None or end_idx is None:
        start_idx, end_idx = _default_turn_range(index, exercise_count, n_turns)
    if end_idx < start_idx:
        start_idx, end_idx = end_idx, start_idx

    started = _turn_time(turns, start_idx, session_start, session_end)
    if n_turns and end_idx + 1 < n_turns:
        ended = _turn_time(turns, end_idx + 1, session_start, session_end)
    else:
        ended = session_end
    if ended < started:
        ended = session_end if session_end >= started else started
    duration = max(0, int((ended - started).total_seconds()))
    return started, ended, duration


def _hydrate_exercise_payload(
    raw: dict,
    *,
    session_id: str,
    session: dict,
    turns: list[dict],
    index: int,
    exercise_count: int,
) -> dict:
    payload = dict(raw)
    payload["session_id"] = session_id
    payload.setdefault("student_id", UNKNOWN_STUDENT_ID)
    if not payload.get("student_id"):
        payload["student_id"] = UNKNOWN_STUDENT_ID
    if not payload.get("exercise_id"):
        payload["exercise_id"] = f"{session_id}_ex_{index:02d}"

    started, ended, duration = _exercise_clock(
        raw=raw,
        session=session,
        turns=turns,
        index=index,
        exercise_count=exercise_count,
    )
    payload.pop("start_turn_index", None)
    payload.pop("end_turn_index", None)
    payload["started_at"] = started.isoformat()
    payload["ended_at"] = ended.isoformat()
    payload["duration_seconds"] = duration

    fallback_ts = started.isoformat()
    hints = []
    for hint in payload.get("hints_given") or []:
        if not isinstance(hint, dict):
            continue
        hint = dict(hint)
        hint.setdefault("timestamp", fallback_ts)
        hints.append(hint)
    payload["hints_given"] = hints
    title = str(payload.get("title") or "").strip()
    if is_generic_title(title):
        payload["title"] = title_from_concept_ids(payload.get("concept_ids")) or f"Exercise {index}"
    extra = [key for key in payload if key not in Exercise.model_fields]
    if extra:
        logger.warning(
            "Dropping fields not on Exercise (%s): %s",
            payload.get("exercise_id"),
            extra,
        )
        for key in extra:
            payload.pop(key, None)
    return payload


def _filter_concept_ids(payload: dict, valid_ids: set[str]) -> tuple[dict, list[str], bool]:
    """Keep only Firestore concept_ids. Reject the exercise if Gemini invented IDs."""
    original = list(payload.get("concept_ids") or [])
    unknown = [cid for cid in original if cid not in valid_ids]
    reject = bool(unknown)
    seen: set[str] = set()
    kept: list[str] = []
    for concept_id in original:
        if concept_id in valid_ids and concept_id not in seen:
            seen.add(concept_id)
            kept.append(concept_id)

    def _filter_related(items: list, key: str = "related_concept_id") -> list:
        cleaned = []
        for item in items or []:
            if not isinstance(item, dict):
                continue
            related = item.get(key)
            if related in valid_ids:
                cleaned.append(item)
            elif related:
                unknown.append(related)
        return cleaned

    payload["concept_ids"] = kept
    payload["stuck_points"] = _filter_related(payload.get("stuck_points") or [])
    payload["errors"] = _filter_related(payload.get("errors") or [])
    return payload, unknown, reject


def _ensure_unique_titles(exercises: list[Exercise]) -> list[Exercise]:
    used: set[str] = set()
    unique: list[Exercise] = []
    for index, exercise in enumerate(exercises, start=1):
        title = (exercise.title or "").strip()
        if is_generic_title(title):
            title = title_from_concept_ids(exercise.concept_ids) or f"Exercise {index}"
        base = title
        suffix = 2
        while title.lower() in used:
            title = f"{base} ({suffix})"
            suffix += 1
        used.add(title.lower())
        if title != exercise.title:
            exercise = exercise.model_copy(update={"title": title})
        unique.append(exercise)
    return unique


def _call_gemini(prompt: str, valid_ids: list[str]) -> str:
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY is not set")

    client = genai.Client(api_key=api_key)
    response = client.models.generate_content(
        model=DETECTION_MODEL,
        contents=prompt,
        config=types.GenerateContentConfig(
            temperature=0.2,
            response_mime_type="application/json",
            response_json_schema=_build_gemini_schema(valid_ids),
            automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True),
        ),
    )
    return response.text or ""


def detect_exercises_for_session(
    session_id: str,
    *,
    write: bool = True,
) -> list[Exercise]:
    """Fetch transcript + concepts, segment with Gemini, validate as Exercise, optionally write."""
    session = get_homework_session(session_id)
    if session is None:
        raise ValueError(f"Unknown session_id: {session_id}")

    turns = _normalize_transcript(session.get("raw_transcript_ref"))
    if not turns:
        logger.info("Session %s has an empty transcript; no exercises detected", session_id)
        return []

    concepts = _load_concepts()
    if not concepts:
        raise ValueError("No concepts found in Firestore or data/concepts.json")
    valid_ids = [c["concept_id"] for c in concepts if c.get("concept_id")]
    valid_id_set = set(valid_ids)

    prompt = _build_prompt(session_id, session, turns, concepts)
    try:
        raw_text = _call_gemini(prompt, valid_ids)
    except Exception:
        logger.exception("Gemini exercise detection failed for session %s", session_id)
        return []

    try:
        parsed = json.loads(raw_text)
    except json.JSONDecodeError:
        logger.error(
            "Gemini returned non-JSON for session %s; skipping session. Raw: %s",
            session_id,
            raw_text,
        )
        return []

    items = parsed.get("exercises") if isinstance(parsed, dict) else None
    if items is None:
        logger.error(
            "Gemini JSON missing 'exercises' for session %s; skipping session. Raw: %s",
            session_id,
            raw_text,
        )
        return []
    if not isinstance(items, list):
        logger.error("Gemini 'exercises' is not a list for session %s; skipping", session_id)
        return []
    if not items:
        logger.info("Session %s: Gemini found no delineated exercises", session_id)
        return []

    validated: list[Exercise] = []
    for index, item in enumerate(items, start=1):
        if not isinstance(item, dict):
            logger.error(
                "Session %s skipped: exercise %s is not an object. Raw: %s",
                session_id,
                index,
                raw_text[:4000],
            )
            return []
        payload = _hydrate_exercise_payload(
            item,
            session_id=session_id,
            session=session,
            turns=turns,
            index=index,
            exercise_count=len(items),
        )
        payload, unknown_ids, reject = _filter_concept_ids(payload, valid_id_set)
        if unknown_ids:
            logger.warning(
                "Session %s exercise %s returned unknown concept_id(s): %s",
                session_id,
                payload.get("exercise_id"),
                unknown_ids,
            )
        if reject:
            logger.error(
                "Skipping exercise %s in session %s: concept_ids not in closed list",
                payload.get("exercise_id"),
                session_id,
            )
            continue
        if not payload.get("concept_ids"):
            logger.warning(
                "Session %s exercise %s matched no Firestore concepts",
                session_id,
                payload.get("exercise_id"),
            )
        try:
            exercise = Exercise.model_validate(payload)
        except ValidationError:
            logger.exception(
                "Session %s skipped: Gemini response failed Exercise validation. "
                "Raw item: %s | full response: %s",
                session_id,
                json.dumps(item, default=str)[:4000],
                raw_text[:4000],
            )
            return []
        validated.append(exercise)

    validated = _ensure_unique_titles(validated)

    if write:
        replace_session_exercises(session_id, validated)

    return validated


def run_post_session_detection(session_id: str) -> list[Exercise]:
    """Run exercise detection after a session is saved. Never raises."""
    try:
        logger.info("Auto-detecting exercises for session %s", session_id)
        exercises = detect_exercises_for_session(session_id, write=True)
        logger.info(
            "Auto-detected %s exercise(s) for session %s",
            len(exercises),
            session_id,
        )
        try:
            from tutor_coach import refresh_after_session

            refresh_after_session(session_id, exercises)
        except Exception:
            logger.exception("Tutor tips refresh failed for session %s", session_id)
        set_session_analysis_status(session_id, "complete")
        return exercises
    except Exception:
        logger.exception(
            "Automatic exercise detection failed for session %s",
            session_id,
        )
        try:
            set_session_analysis_status(session_id, "error")
        except Exception:
            logger.exception("Could not mark analysis error for session %s", session_id)
        return []
