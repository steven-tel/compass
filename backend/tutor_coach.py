"""Non-live Gemini coach: session recap + profile tips from recent sessions."""

from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv
from google import genai
from google.genai import types

from db import (
    get_homework_session,
    get_tutor_tips,
    list_concepts,
    list_homework_sessions,
    list_session_exercises,
    save_tutor_tips,
    update_homework_session_fields,
)

_APP_DIR = Path(__file__).resolve().parent
load_dotenv(_APP_DIR / ".env")

logger = logging.getLogger(__name__)

COACH_MODEL = os.getenv("EXERCISE_DETECTOR_MODEL", "gemini-3.5-flash-lite")
RECENT_SESSION_LIMIT = 5

_TIPS_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "headline": {
            "type": "string",
            "description": "One lively sentence celebrating or coaching the student",
        },
        "tips": {
            "type": "array",
            "minItems": 3,
            "maxItems": 3,
            "items": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "title": {"type": "string"},
                    "body": {"type": "string"},
                },
                "required": ["title", "body"],
            },
        },
        "next_focus": {
            "type": "string",
            "description": "One concrete thing to try in the next tutoring session",
        },
    },
    "required": ["headline", "tips", "next_focus"],
}

_SESSION_RESUME_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "session_summary": {"type": "string"},
        "overall_engagement": {
            "type": "object",
            "additionalProperties": False,
            "properties": {
                "level": {"type": "string", "enum": ["low", "medium", "high"]},
                "reasoning": {"type": "string"},
            },
            "required": ["level", "reasoning"],
        },
        "recommended_next_concepts": {
            "type": "array",
            "items": {"type": "string"},
        },
        "concepts_struggled": {
            "type": "array",
            "items": {"type": "string"},
        },
    },
    "required": ["session_summary"],
}


def _client() -> genai.Client:
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY is not set")
    return genai.Client(api_key=api_key)


def _generate_json(prompt: str, schema: dict, temperature: float) -> dict:
    client = _client()
    response = client.models.generate_content(
        model=COACH_MODEL,
        contents=prompt,
        config=types.GenerateContentConfig(
            temperature=temperature,
            response_mime_type="application/json",
            response_json_schema=schema,
            automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True),
        ),
    )
    raw = response.text or ""
    parsed = json.loads(raw)
    if not isinstance(parsed, dict):
        raise ValueError("Coach JSON was not an object")
    return parsed


def _concept_names(concepts: list[dict]) -> dict[str, str]:
    names = {}
    for concept in concepts:
        concept_id = concept.get("concept_id")
        if concept_id:
            names[concept_id] = concept.get("name") or concept_id
    return names


def _named(ids: list | None, names: dict[str, str]) -> list[str]:
    return [names.get(concept_id, concept_id) for concept_id in ids or []]


def _exercise_brief(exercise: dict, names: dict[str, str]) -> dict:
    assessment = exercise.get("confidence_assessment") or {}
    stuck = []
    for item in exercise.get("stuck_points") or []:
        if isinstance(item, dict) and item.get("step_description"):
            stuck.append(item["step_description"])
    notes = (exercise.get("tutor_notes") or "").strip()
    return {
        "title": exercise.get("title") or "",
        "concepts": _named(exercise.get("concept_ids") or [], names),
        "outcome": exercise.get("outcome"),
        "confidence": assessment.get("level"),
        "independence": exercise.get("independence_score"),
        "stuck": stuck[:3],
        "notes": notes[:280],
    }


def _paper_notes(raw, limit: int = 8) -> list[str]:
    notes = []
    if not isinstance(raw, list):
        return notes
    for message in raw:
        if not isinstance(message, dict):
            continue
        role = (message.get("role") or "").lower()
        if role not in {"observation", "visual", "note"}:
            continue
        text = (message.get("text") or "").strip()
        if not text:
            continue
        kind = (message.get("kind") or "").strip()
        notes.append(f"{kind}: {text}" if kind else text)
        if len(notes) >= limit:
            break
    return notes


def _compact_transcript(raw, limit: int = 40) -> list[dict]:
    if not raw or isinstance(raw, str):
        text = (raw or "").strip()
        return [{"role": "user", "text": text[:220]}] if text else []
    turns = []
    for message in raw[-limit:]:
        if not isinstance(message, dict):
            continue
        text = (message.get("text") or "").strip()
        if not text:
            continue
        role = (message.get("role") or "user").lower()
        if role in {"observation", "visual", "note"}:
            role = "paper"
        elif role in {"agent", "gemini", "tutor", "assistant", "model"}:
            role = "tutor"
        else:
            role = "student"
        turns.append({"role": role, "text": text[:220]})
    return turns


def _minutes(session: dict) -> int:
    seconds = session.get("duration_seconds") or 0
    try:
        return max(0, round(int(seconds) / 60))
    except (TypeError, ValueError):
        return 0


def summarize_session(session_id: str, exercises: list | None = None) -> dict | None:
    """Write a short recap onto the session document. Returns the recap or None."""
    session = get_homework_session(session_id)
    if session is None:
        return None
    concepts = list_concepts()
    names = _concept_names(concepts)
    valid_ids = set(names)
    exercise_docs = exercises
    if exercise_docs is None:
        exercise_docs = list_session_exercises(session_id)
    briefs = []
    for exercise in exercise_docs:
        if hasattr(exercise, "model_dump"):
            briefs.append(_exercise_brief(exercise.model_dump(mode="json"), names))
        elif isinstance(exercise, dict):
            briefs.append(_exercise_brief(exercise, names))
    turns = _compact_transcript(session.get("raw_transcript_ref"))
    if not briefs and not turns:
        return None

    catalog = "\n".join(f"- {cid}: {name}" for cid, name in list(names.items())[:80])
    prompt = f"""You are Compass, a warm math tutor writing a private recap of one homework session.

Be specific, kind, and concrete. Write to the student as "you".
Do not mention Gemini, Google, APIs, or that you are an AI.
Keep session_summary to 2 short sentences.
recommended_next_concepts and concepts_struggled must be concept_id slugs from the catalog.
Paper notes are silent observations of what was written — use them as evidence, do not mention a camera.

Catalog:
{catalog}

Session: {session_id}
Minutes: {_minutes(session)}
Concepts covered: {_named(session.get("concepts_covered") or [], names)}
Exercises JSON:
{json.dumps(briefs, ensure_ascii=False)[:6000]}
Transcript excerpt:
{json.dumps(turns, ensure_ascii=False)[:5000]}
"""
    try:
        recap = _generate_json(prompt, _SESSION_RESUME_SCHEMA, temperature=0.35)
    except Exception:
        logger.exception("Session recap failed for %s", session_id)
        return None

    summary = str(recap.get("session_summary") or "").strip()
    if not summary:
        return None
    recommended = [
        cid for cid in recap.get("recommended_next_concepts") or [] if cid in valid_ids
    ][:4]
    covered = set(session.get("concepts_covered") or [])
    struggled = [
        cid
        for cid in recap.get("concepts_struggled") or []
        if cid in valid_ids and cid in covered
    ][:6]
    engagement = recap.get("overall_engagement")
    if not isinstance(engagement, dict) or engagement.get("level") not in {"low", "medium", "high"}:
        engagement = None

    fields = {
        "session_summary": summary,
        "recommended_next_concepts": recommended,
    }
    if engagement:
        fields["overall_engagement"] = {
            "level": engagement["level"],
            "reasoning": str(engagement.get("reasoning") or "")[:400],
        }
    if struggled:
        fields["concepts_struggled"] = struggled
    update_homework_session_fields(session_id, fields)
    logger.info("Saved session recap for %s", session_id)
    return fields


def _session_snapshot(session: dict, names: dict[str, str]) -> dict:
    full = get_homework_session(session["session_id"]) or session
    exercises = list_session_exercises(session["session_id"])
    return {
        "session_id": session.get("session_id"),
        "when": session.get("started_at"),
        "minutes": _minutes(session),
        "status": session.get("status"),
        "summary": session.get("session_summary") or full.get("session_summary") or "",
        "concepts": _named(session.get("concepts_covered") or [], names),
        "struggled": _named(session.get("concepts_struggled") or [], names),
        "paper_notes": _paper_notes(full.get("raw_transcript_ref")),
        "exercises": [_exercise_brief(exercise, names) for exercise in exercises[:8]],
    }


def _recent_sessions(limit: int = RECENT_SESSION_LIMIT) -> list[dict]:
    sessions = [
        session
        for session in list_homework_sessions()
        if session.get("status") != "active"
    ]
    recent = sessions[:limit]
    if sum((session.get("exercise_count") or 0) for session in recent) > 0:
        return recent
    with_work = [session for session in sessions if (session.get("exercise_count") or 0) > 0]
    return (with_work or recent)[:limit]


def _empty_tips() -> dict:
    return {
        "headline": "",
        "tips": [],
        "next_focus": "",
        "session_ids": [],
        "session_count": 0,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }


def _fallback_tips(snapshots: list[dict], session_ids: list) -> dict:
    tips = []
    for snap in snapshots:
        struggled = snap.get("struggled") or []
        concepts = snap.get("concepts") or []
        title = (struggled or concepts or ["Keep practicing"])[0]
        body = (snap.get("summary") or "").strip()
        paper = snap.get("paper_notes") or []
        if not body and paper:
            body = paper[0]
        if not body:
            continue
        tips.append({"title": str(title)[:48], "body": body[:280]})
        if len(tips) == 3:
            break
    headline = ""
    if snapshots:
        topics = snapshots[0].get("concepts") or []
        if topics:
            headline = f"Nice work on {topics[0]} — a few notes from recent sessions."
    next_focus = ""
    for snap in snapshots:
        struggled = snap.get("struggled") or []
        if struggled:
            next_focus = f"Next session, drill {struggled[0]}."
            break
    return {
        "headline": headline[:120],
        "tips": tips,
        "next_focus": next_focus[:220],
        "session_ids": session_ids,
        "session_count": len(session_ids),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }


def refresh_tutor_tips(*, session_limit: int = RECENT_SESSION_LIMIT) -> dict | None:
    """Rebuild profile tips from the latest sessions."""
    sessions = _recent_sessions(session_limit)
    if not sessions:
        empty = _empty_tips()
        save_tutor_tips(empty)
        return empty

    names = _concept_names(list_concepts())
    snapshots = [_session_snapshot(session, names) for session in sessions]
    session_ids = [session.get("session_id") for session in sessions]
    prompt = f"""You are Compass, Chris's lively math tutor. Write coach notes for his profile.

Tone: encouraging, specific, a little playful — like a tutor leaving sticky notes.
Speak to Chris as "you". Never mention Gemini, Google, models, or that this is generated.

STRICT TOPIC RULES:
- Tips must be ONLY about mathematics: concepts, methods, mistakes, formulas, and what to practice next.
- Name real topics from these sessions (for example derivatives, unit circle, trig graphs).
- Do NOT mention camera, microphone, video, lighting, seating, setup, the app, or session logistics.
- Paper notes describe what was written on the page — use them as evidence of method, not as a camera story.
- If a session was mostly a greeting or tech check, ignore it and use the sessions with real math work.
- Do not invent topics he did not practice.

headline: one punchy math-focused sentence (max 90 characters).
tips: exactly 3 math tips. title max 6 words. body 1-2 sentences.
next_focus: one concrete math move for the next session.

Recent sessions, newest first:
{json.dumps(snapshots, ensure_ascii=False)[:12000]}
"""
    try:
        payload = _generate_json(prompt, _TIPS_SCHEMA, temperature=0.7)
    except Exception:
        logger.exception("Tutor tips refresh failed")
        stored = get_tutor_tips()
        if stored and (stored.get("tips") or []):
            return stored
        result = _fallback_tips(snapshots, session_ids)
        save_tutor_tips(result)
        return result

    tips = []
    for item in payload.get("tips") or []:
        if not isinstance(item, dict):
            continue
        title = str(item.get("title") or "").strip()
        body = str(item.get("body") or "").strip()
        if title and body:
            tips.append({"title": title[:48], "body": body[:280]})
        if len(tips) == 3:
            break
    if len(tips) < 3:
        fallback = _fallback_tips(snapshots, session_ids)
        for item in fallback["tips"]:
            if len(tips) >= 3:
                break
            if item not in tips:
                tips.append(item)
    result = {
        "headline": str(payload.get("headline") or "").strip()[:120],
        "tips": tips,
        "next_focus": str(payload.get("next_focus") or "").strip()[:220],
        "session_ids": session_ids,
        "session_count": len(sessions),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    save_tutor_tips(result)
    logger.info("Saved tutor tips from %s session(s)", len(sessions))
    return result


def get_or_refresh_tutor_tips() -> dict | None:
    stored = get_tutor_tips()
    recent_ids = [session.get("session_id") for session in _recent_sessions()]
    if stored and stored.get("session_ids") == recent_ids and (stored.get("tips") or []):
        return stored
    return refresh_tutor_tips()


def refresh_after_session(session_id: str, exercises: list | None = None) -> None:
    """Recap this session, then refresh profile tips from the last 5 sessions."""
    try:
        summarize_session(session_id, exercises)
    except Exception:
        logger.exception("Session recap failed for %s", session_id)
    try:
        refresh_tutor_tips()
    except Exception:
        logger.exception("Tutor tips refresh failed after session %s", session_id)
