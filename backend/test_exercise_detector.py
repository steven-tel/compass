"""Sanity-check exercise detection against one real Firestore session.

Usage:
  uv run python test_exercise_detector.py
  uv run python test_exercise_detector.py sess_20260820_101500_abc123
  uv run python test_exercise_detector.py sess_... --write
"""

from __future__ import annotations

import argparse
import logging
import sys

from db import list_homework_sessions
from exercise_detector import MODULE_FLAGS, detect_exercises_for_session

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")


def _pick_session_id(explicit: str | None) -> str:
    if explicit:
        return explicit
    sessions = list_homework_sessions()
    with_transcript = [
        session
        for session in sessions
        if session.get("raw_transcript_ref")
    ]
    pool = with_transcript or sessions
    if not pool:
        raise SystemExit("No homework sessions in Firestore. Run a tutor session first.")
    return pool[0]["session_id"]


def main() -> None:
    parser = argparse.ArgumentParser(description="Run exercise detection on one session")
    parser.add_argument("session_id", nargs="?", help="Firestore homework session id")
    parser.add_argument(
        "--write",
        action="store_true",
        help="Write validated exercises to homework_sessions/{id}/exercises",
    )
    args = parser.parse_args()

    session_id = _pick_session_id(args.session_id)
    print(f"Session: {session_id}")
    print(MODULE_FLAGS)
    print("---")

    exercises = detect_exercises_for_session(session_id, write=args.write)
    print(f"Detected {len(exercises)} exercise(s)")
    if not exercises:
        print("(empty list — no clearly delineated exercises, or validation skipped the session)")
        return

    for exercise in exercises:
        print(exercise.model_dump_json(indent=2))
        print("---")

    if not args.write:
        print("Dry run only. Re-run with --write to save to Firestore.")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.exit(130)
    except Exception as exc:
        print(f"Failed: {exc}", file=sys.stderr)
        raise
