import logging
import os
import threading
import uuid
from datetime import datetime, timezone
from enum import Enum
from pathlib import Path

# Must be set before creating gRPC channels (Firestore + Gemini Live).
os.environ.setdefault("GRPC_ENABLE_FORK_SUPPORT", "0")

from dotenv import load_dotenv
from google.cloud import firestore

from models.exercise import Exercise
from models.homework_session import HomeworkSession, SessionStatus

_APP_DIR = Path(__file__).resolve().parent
load_dotenv(_APP_DIR / ".env")
load_dotenv(_APP_DIR.parent / ".env")

logger = logging.getLogger(__name__)

PROJECT = os.getenv("FIRESTORE_PROJECT")
DATABASE = os.getenv("FIRESTORE_DATABASE", "compas-database")
SESSIONS_COLLECTION = "homework_sessions"
CONCEPTS_COLLECTION = "concepts"
EXERCISES_SUBCOLLECTION = "exercises"
PROFILE_COLLECTION = "student_profile"
TUTOR_TIPS_DOC = "tutor_tips"

if PROJECT:
    os.environ.setdefault("GOOGLE_CLOUD_QUOTA_PROJECT", PROJECT)

_db: firestore.Client | None = None
_db_lock = threading.Lock()


def get_db() -> firestore.Client:
    """Reuse one Firestore client. Creating a Client per request hangs gRPC under Live WS."""
    global _db
    if not PROJECT:
        raise RuntimeError(
            "FIRESTORE_PROJECT is not set. Copy .env.example to .env and add your GCP project id."
        )
    if _db is None:
        with _db_lock:
            if _db is None:
                _db = firestore.Client(project=PROJECT, database=DATABASE)
    return _db


def _to_firestore(value):
    if isinstance(value, Enum):
        return value.value
    if isinstance(value, dict):
        return {key: _to_firestore(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_to_firestore(item) for item in value]
    return value


def save_homework_session(session: HomeworkSession) -> None:
    db = get_db()
    payload = _to_firestore(session.model_dump())
    db.collection(SESSIONS_COLLECTION).document(session.session_id).set(payload)
    logger.info(
        "Saved homework session %s (%s) to %s/%s/%s",
        session.session_id,
        session.status.value,
        PROJECT,
        DATABASE,
        SESSIONS_COLLECTION,
    )


def _from_firestore(value):
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, dict):
        return {key: _from_firestore(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_from_firestore(item) for item in value]
    return value


_SESSION_LIST_FIELDS = [
    "session_id",
    "started_at",
    "ended_at",
    "duration_seconds",
    "status",
    "course_focus",
    "exercise_id",
    "exercise_count",
    "completed_count",
    "abandoned_count",
    "concepts_covered",
    "concepts_struggled",
    "session_summary",
    "title",
]


def list_homework_sessions() -> list[dict]:
    db = get_db()
    sessions = []
    query = db.collection(SESSIONS_COLLECTION).select(_SESSION_LIST_FIELDS)
    for doc in query.stream():
        data = _from_firestore(doc.to_dict() or {})
        data["session_id"] = data.get("session_id") or doc.id
        data.pop("raw_transcript_ref", None)
        sessions.append(data)
    sessions.sort(key=lambda item: item.get("started_at") or "", reverse=True)
    return sessions


_GENERIC_TITLES = {
    "session",
    "homework",
    "homework session",
    "tutoring session",
    "exercise",
    "untitled",
}


def is_generic_title(title: str | None) -> bool:
    text = (title or "").strip().lower()
    if not text or text in _GENERIC_TITLES:
        return True
    if text.startswith("exercise ") and text[9:].replace(" ", "").isdigit():
        return True
    if text.startswith("session ") and text[8:].replace(" ", "").isdigit():
        return True
    return False


def title_from_concept_ids(concept_ids: list | None) -> str | None:
    names = []
    seen = set()
    for concept_id in concept_ids or []:
        if not concept_id or concept_id in seen:
            continue
        seen.add(concept_id)
        names.append(str(concept_id).replace("_", " ").strip().title())
        if len(names) == 2:
            break
    if not names:
        return None
    if len(names) == 1:
        return names[0]
    return f"{names[0]} & {names[1]}"


def title_from_exercises(exercises: list) -> str | None:
    names = []
    seen: set[str] = set()
    for exercise in exercises or []:
        title = ""
        concept_ids = None
        if hasattr(exercise, "title"):
            title = str(exercise.title or "").strip()
            concept_ids = getattr(exercise, "concept_ids", None)
        elif isinstance(exercise, dict):
            title = str(exercise.get("title") or "").strip()
            concept_ids = exercise.get("concept_ids")
        if is_generic_title(title):
            title = title_from_concept_ids(concept_ids) or ""
        key = title.lower()
        if title and key not in seen:
            seen.add(key)
            names.append(title)
        if len(names) == 2:
            break
    if not names:
        return None
    if len(names) == 1:
        return names[0][:160]
    return f"{names[0]} & {names[1]}"[:160]


def update_session_exercise_fields(session_id: str, exercise_id: str, fields: dict) -> None:
    if not fields:
        return
    _session_exercises_ref(session_id).document(exercise_id).update(_to_firestore(fields))


def update_homework_session_fields(session_id: str, fields: dict) -> None:
    if not fields:
        return
    get_db().collection(SESSIONS_COLLECTION).document(session_id).update(_to_firestore(fields))


def get_tutor_tips() -> dict | None:
    doc = get_db().collection(PROFILE_COLLECTION).document(TUTOR_TIPS_DOC).get()
    if not doc.exists:
        return None
    data = _from_firestore(doc.to_dict() or {})
    return data or None


def save_tutor_tips(payload: dict) -> None:
    get_db().collection(PROFILE_COLLECTION).document(TUTOR_TIPS_DOC).set(_to_firestore(payload))
    logger.info("Saved tutor tips to %s/%s", PROFILE_COLLECTION, TUTOR_TIPS_DOC)


def get_homework_session(session_id: str) -> dict | None:
    db = get_db()
    doc = db.collection(SESSIONS_COLLECTION).document(session_id).get()
    if not doc.exists:
        return None
    data = _from_firestore(doc.to_dict() or {})
    data["session_id"] = data.get("session_id") or doc.id
    return data


def _session_exercises_ref(session_id: str):
    return (
        get_db()
        .collection(SESSIONS_COLLECTION)
        .document(session_id)
        .collection(EXERCISES_SUBCOLLECTION)
    )


def list_session_exercises(session_id: str) -> list[dict]:
    exercises = []
    for doc in _session_exercises_ref(session_id).stream():
        data = _from_firestore(doc.to_dict() or {})
        data["exercise_id"] = data.get("exercise_id") or doc.id
        data["session_id"] = data.get("session_id") or session_id
        exercises.append(data)
    exercises.sort(
        key=lambda item: (item.get("started_at") or "", item.get("exercise_id") or "")
    )
    return exercises


def get_session_exercise(session_id: str, exercise_id: str) -> dict | None:
    doc = _session_exercises_ref(session_id).document(exercise_id).get()
    if not doc.exists:
        return None
    data = _from_firestore(doc.to_dict() or {})
    data["exercise_id"] = data.get("exercise_id") or doc.id
    data["session_id"] = data.get("session_id") or session_id
    return data


def delete_session_exercises(session_id: str) -> None:
    for doc in _session_exercises_ref(session_id).stream():
        doc.reference.delete()


def delete_homework_session(session_id: str) -> bool:
    db = get_db()
    ref = db.collection(SESSIONS_COLLECTION).document(session_id)
    if not ref.get().exists:
        return False
    delete_session_exercises(session_id)
    ref.delete()
    logger.info("Deleted homework session %s", session_id)
    return True


def list_concepts() -> list[dict]:
    db = get_db()
    concepts = []
    for doc in db.collection(CONCEPTS_COLLECTION).stream():
        data = _from_firestore(doc.to_dict() or {})
        data["concept_id"] = data.get("concept_id") or doc.id
        concepts.append(data)
    concepts.sort(key=lambda item: item.get("name") or item.get("concept_id") or "")
    return concepts


def get_concept(concept_id: str) -> dict | None:
    doc = get_db().collection(CONCEPTS_COLLECTION).document(concept_id).get()
    if not doc.exists:
        return None
    data = _from_firestore(doc.to_dict() or {})
    data["concept_id"] = data.get("concept_id") or doc.id
    return data


def list_all_exercises() -> list[dict]:
    db = get_db()
    exercises = []
    try:
        stream = db.collection_group(EXERCISES_SUBCOLLECTION).stream()
        for doc in stream:
            data = _from_firestore(doc.to_dict() or {})
            data["exercise_id"] = data.get("exercise_id") or doc.id
            if not data.get("session_id"):
                parent = doc.reference.parent.parent
                if parent is not None:
                    data["session_id"] = parent.id
            exercises.append(data)
        return exercises
    except Exception:
        logger.exception(
            "Collection-group query for %s failed; falling back to per-session reads",
            EXERCISES_SUBCOLLECTION,
        )
        exercises = []
        for session in list_homework_sessions():
            session_id = session.get("session_id")
            if not session_id:
                continue
            exercises.extend(list_session_exercises(session_id))
        return exercises


_CONFIDENCE_SCORES = {"low": 0.0, "medium": 0.5, "high": 1.0}


def _exercise_confidence_score(exercise: dict) -> float | None:
    assessment = exercise.get("confidence_assessment")
    if not isinstance(assessment, dict):
        return None
    level = str(assessment.get("level") or "").lower()
    return _CONFIDENCE_SCORES.get(level)


def _average_confidence(scores: list[float]) -> dict:
    if not scores:
        return {"average_confidence": None, "average_confidence_level": None}
    average = sum(scores) / len(scores)
    if average < 0.30:
        level = "needs_review"
    elif average < 0.70:
        level = "building"
    elif average < 0.90:
        level = "strong"
    else:
        level = "mastered"
    return {
        "average_confidence": round(average, 3),
        "average_confidence_level": level,
    }


def _exercises_for_concept(concept_id: str, exercises: list[dict] | None = None) -> list[dict]:
    matched = []
    for exercise in exercises if exercises is not None else list_all_exercises():
        if concept_id in (exercise.get("concept_ids") or []):
            matched.append(exercise)
    matched.sort(
        key=lambda item: (item.get("started_at") or "", item.get("exercise_id") or ""),
        reverse=True,
    )
    return matched


def list_evaluated_concepts() -> list[dict]:
    concepts_by_id = {item["concept_id"]: item for item in list_concepts() if item.get("concept_id")}
    buckets: dict[str, dict] = {
        concept_id: {"count": 0, "scores": []} for concept_id in concepts_by_id
    }
    for exercise in list_all_exercises():
        for concept_id in exercise.get("concept_ids") or []:
            bucket = buckets.setdefault(concept_id, {"count": 0, "scores": []})
            bucket["count"] += 1
            score = _exercise_confidence_score(exercise)
            if score is not None:
                bucket["scores"].append(score)

    results = []
    for concept_id, bucket in buckets.items():
        concept = dict(concepts_by_id.get(concept_id) or {"concept_id": concept_id, "name": concept_id})
        concept.update(_average_confidence(bucket["scores"]))
        concept["exercise_count"] = bucket["count"]
        results.append(concept)
    results.sort(
        key=lambda item: (-item["exercise_count"], item.get("name") or item["concept_id"])
    )
    return results


def get_evaluated_concept(concept_id: str) -> dict | None:
    catalog = get_concept(concept_id)
    exercises = _exercises_for_concept(concept_id)
    if catalog is None and not exercises:
        return None
    scores = [
        score
        for score in (_exercise_confidence_score(exercise) for exercise in exercises)
        if score is not None
    ]
    concept = dict(catalog or {"concept_id": concept_id, "name": concept_id})
    concept.update(_average_confidence(scores))
    concept["exercise_count"] = len(exercises)
    concept["exercises"] = exercises
    return concept


def save_session_exercise(session_id: str, exercise: Exercise) -> None:
    payload = _to_firestore(exercise.model_dump())
    _session_exercises_ref(session_id).document(exercise.exercise_id).set(payload)
    logger.info(
        "Saved exercise %s under session %s",
        exercise.exercise_id,
        session_id,
    )


def link_exercises_to_session(session_id: str, exercises: list[Exercise]) -> None:
    """Write attempt IDs and rollups onto the parent homework session."""
    exercise_ids = [exercise.exercise_id for exercise in exercises]
    covered: list[str] = []
    for exercise in exercises:
        for concept_id in exercise.concept_ids:
            if concept_id not in covered:
                covered.append(concept_id)
    completed = sum(
        1 for exercise in exercises if exercise.outcome.value != "abandoned"
    )
    abandoned = sum(
        1 for exercise in exercises if exercise.outcome.value == "abandoned"
    )
    struggled = [
        concept_id
        for concept_id in (get_homework_session(session_id) or {}).get("concepts_struggled")
        or []
        if concept_id in covered
    ]
    payload = {
        "exercise_id": exercise_ids,
        "exercise_count": len(exercise_ids),
        "completed_count": completed,
        "abandoned_count": abandoned,
        "concepts_covered": covered,
        "concepts_struggled": struggled,
    }
    existing = get_homework_session(session_id) or {}
    if is_generic_title(existing.get("title")):
        fallback = title_from_exercises(exercises) or title_from_concept_ids(covered)
        if fallback:
            payload["title"] = fallback
    get_db().collection(SESSIONS_COLLECTION).document(session_id).update(payload)


def replace_session_exercises(session_id: str, exercises: list[Exercise]) -> None:
    delete_session_exercises(session_id)
    for exercise in exercises:
        save_session_exercise(session_id, exercise)
    link_exercises_to_session(session_id, exercises)


def set_session_analysis_status(session_id: str, status: str) -> None:
    get_db().collection(SESSIONS_COLLECTION).document(session_id).update(
        {"analysis_status": status}
    )
    logger.info("Session %s analysis_status=%s", session_id, status)


class HomeworkSessionRecorder:
    """Creates a HomeworkSession at agent start and writes it to Firestore on finish."""

    def __init__(self):
        now = datetime.now(timezone.utc)
        self.session = HomeworkSession(
            session_id=f"sess_{now.strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:6]}",
            started_at=now,
            status=SessionStatus.active,
        )
        self._transcript: list[dict] = []
        self._current_user = ""
        self._current_agent = ""
        logger.info("Started homework session %s", self.session.session_id)

    def record_event(self, event: dict | None) -> None:
        if not isinstance(event, dict):
            return
        event_type = event.get("type")
        text = event.get("text") or ""
        if event_type == "user":
            if self._current_agent:
                self._flush_agent()
            self._current_user += text
        elif event_type == "gemini":
            if self._current_user:
                self._flush_user()
            self._current_agent += text
        elif event_type == "observation":
            self._flush_all()
            note = (event.get("text") or "").strip()
            if not note:
                return
            kind = str(event.get("kind") or "progress").strip().lower()
            last = self._transcript[-1] if self._transcript else None
            if (
                last
                and last.get("role") == "observation"
                and last.get("kind") == kind
                and (last.get("text") or "").strip().lower() == note.lower()
            ):
                return
            turn = self._turn("observation", note)
            turn["kind"] = kind
            self._transcript.append(turn)
        elif event_type in ("turn_complete", "interrupted"):
            self._flush_all()

    def record_typed_user(self, text: str) -> None:
        cleaned = (text or "").strip()
        if not cleaned:
            return
        if self._current_agent:
            self._flush_agent()
        if self._current_user:
            self._flush_user()
        self._transcript.append(self._turn("user", cleaned))

    def _flush_user(self) -> None:
        cleaned = self._current_user.strip()
        self._current_user = ""
        if cleaned:
            self._transcript.append(self._turn("user", cleaned))

    def _flush_agent(self) -> None:
        cleaned = self._current_agent.strip()
        self._current_agent = ""
        if cleaned:
            self._transcript.append(self._turn("agent", cleaned))

    def _turn(self, role: str, text: str) -> dict:
        return {
            "role": role,
            "text": text,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }

    def _flush_all(self) -> None:
        self._flush_user()
        self._flush_agent()

    def finish(self, status: SessionStatus) -> HomeworkSession:
        now = datetime.now(timezone.utc)
        started = self.session.started_at
        if started.tzinfo is None:
            started = started.replace(tzinfo=timezone.utc)
        duration = max(0, int((now - started).total_seconds()))
        self._flush_all()
        self.session = self.session.model_copy(
            update={
                "ended_at": now,
                "duration_seconds": duration,
                "status": status,
                "raw_transcript_ref": self._transcript,
                "analysis_status": "pending",
            }
        )
        save_homework_session(self.session)
        return self.session
