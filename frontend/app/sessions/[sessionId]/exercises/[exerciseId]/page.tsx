"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { api } from "@/lib/api";
import { useCompactHeader } from "@/lib/useCompactHeader";
import {
  capitalize,
  formatCardDuration,
  formatLongDate,
  formatPercent,
  humanizeConcept,
  exerciseTitle,
  normalizeTranscript,
  sliceTranscript,
} from "@/lib/format";
import type { Exercise, HomeworkSession } from "@/lib/types";
import { MathText } from "@/components/MathText";
import { TranscriptSheet } from "@/components/TranscriptSheet";

const HEADLINES: Record<string, string> = {
  completed_correct: "Exercise Completed! 🎉",
  completed: "Exercise Completed! 🎉",
  completed_with_help: "Completed with help",
  completed_incorrect: "Exercise Incorrect",
  abandoned: "Exercise Abandoned",
};

function hintTriggerLabel(value?: string): string {
  if (!value) return "Tutor offered";
  return value.replaceAll("_", " ").replace(/^\w/, (char) => char.toUpperCase());
}

function subtitleFor(exercise: Exercise): string {
  if (exercise.tutor_notes) return exercise.tutor_notes;
  const topic = exercise.concept_ids?.[0] ? humanizeConcept(exercise.concept_ids[0]) : "this exercise";
  if (exercise.outcome === "completed_incorrect") {
    return `Student finished ${topic} with an incorrect answer.`;
  }
  if (exercise.outcome === "abandoned") {
    return `Student left ${topic} unfinished.`;
  }
  if (exercise.outcome === "completed_with_help") {
    return `Student completed ${topic} with help.`;
  }
  return `Student successfully worked on ${topic}.`;
}

function BackArrow() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M11 6.2 5.2 12 11 17.8M5.2 12h14"
        stroke="white"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CrownIcon() {
  return (
    <svg width="18" height="16" viewBox="0 0 22 20" aria-hidden="true">
      <path d="M2 16h18l-1.2-9-4.3 3.6L11 3 7.5 10.6 3.2 7 2 16z" fill="white" />
      <rect x="2" y="16" width="18" height="2.4" rx="1" fill="rgba(255,255,255,0.7)" />
    </svg>
  );
}

export default function ExerciseDetailPage() {
  const params = useParams<{ sessionId: string; exerciseId: string }>();
  const sessionId = decodeURIComponent(params.sessionId);
  const exerciseId = decodeURIComponent(params.exerciseId);
  const [exercise, setExercise] = useState<Exercise | null>(null);
  const [session, setSession] = useState<HomeworkSession | null>(null);
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [status, setStatus] = useState("Loading exercise…");
  const [showTranscript, setShowTranscript] = useState(false);
  const compactHeader = useCompactHeader();

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [nextExercise, nextSession, list] = await Promise.all([
          api.getExercise(sessionId, exerciseId),
          api.getSession(sessionId),
          api.listSessionExercises(sessionId),
        ]);
        if (cancelled) return;
        setExercise(nextExercise);
        setSession(nextSession);
        setExercises(list.exercises || []);
        setStatus("");
      } catch (error) {
        if (!cancelled) {
          setStatus(error instanceof Error ? error.message : "Could not load exercise");
        }
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [sessionId, exerciseId]);

  const exerciseNumber = useMemo(() => {
    const index = exercises.findIndex((item) => item.exercise_id === exerciseId);
    return index >= 0 ? index + 1 : null;
  }, [exercises, exerciseId]);

  if (!exercise) {
    return (
      <main className="exercise-view">
        <p className="note" style={{ padding: 20 }}>
          {status}
        </p>
      </main>
    );
  }

  const outcome = exercise.outcome || "completed_correct";
  const headline = HEADLINES[outcome] || "Exercise";

  return (
    <main className={`exercise-view outcome-${outcome} content-in`}>
      <Link
        href={`/sessions/${encodeURIComponent(sessionId)}`}
        className={`session-back exercise-back${compactHeader ? " is-compact" : ""}`}
        aria-label="Back to session"
      >
        <BackArrow />
      </Link>

      <section className="exercise-hero">
        <div className="exercise-outcome-badge" aria-hidden="true">
          {outcome === "abandoned" || outcome === "completed_incorrect" ? (
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none">
              <path
                d="M7 7l10 10M17 7 7 17"
                stroke="white"
                strokeWidth="2.6"
                strokeLinecap="round"
              />
            </svg>
          ) : (
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="8.2" stroke="white" strokeWidth="1.6" />
              <path
                d="M8 12.2 10.6 15 16 9.4"
                stroke="white"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          )}
        </div>
        <h1>{headline}</h1>
        <p className="exercise-sub">
          <MathText text={subtitleFor(exercise)} />
        </p>
      </section>

      <article className="exercise-summary-card exercise-enter">
        <header className="exercise-card-hero">
          <span className="exercise-crown-wrap">
            <CrownIcon />
          </span>
          <h2>
            <MathText text={exerciseTitle(exercise, (exerciseNumber || 1) - 1)} />
          </h2>
        </header>
        <div className="exercise-rows">
          <div className="exercise-row">
            <span>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <rect x="4" y="5" width="16" height="15" rx="3" stroke="currentColor" strokeWidth="1.7" />
                <path d="M8 3.5v3M16 3.5v3M4 10h16" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
              </svg>
              Done On
            </span>
            <strong>{formatLongDate(exercise.ended_at || exercise.started_at)}</strong>
          </div>
          <div className="exercise-row">
            <span>Duration</span>
            <strong>{formatCardDuration(exercise.duration_seconds)}</strong>
          </div>
          <div className="exercise-row">
            <span>Independence</span>
            <strong>{formatPercent(exercise.independence_score)}</strong>
          </div>
          <div className="exercise-row">
            <span>Confidence</span>
            <strong>{capitalize(exercise.confidence_assessment?.level)}</strong>
          </div>
        </div>
        <button className="exercise-transcript-btn" type="button" onClick={() => setShowTranscript(true)}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M12 4v10M8.5 10.5 12 14.2l3.5-3.7"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M5 17.5V19a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 19v-1.5"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          </svg>
          See Full Transcript
        </button>
      </article>

      <article className="exercise-hints-card exercise-enter">
        <header className="exercise-hints-title">
          <svg width="16" height="20" viewBox="0 0 16 20" aria-hidden="true">
            <path
              d="M9.2 1 2 11.2h5.1L6.8 19 14 8.8H8.8L9.2 1z"
              fill="#F97316"
            />
          </svg>
          Hints
        </header>
        {(exercise.hints_given || []).length ? (
          <div className="exercise-hints-list">
            {exercise.hints_given?.map((hint, index) => (
              <div className="exercise-hint" key={`${hint.hint_level}-${index}`}>
                <div className="exercise-hint-top">
                  <strong>Level {hint.hint_level}</strong>
                  <span className="exercise-hint-badge">{hintTriggerLabel(hint.triggered_by)}</span>
                </div>
                <p>
                  <MathText text={hint.text} />
                </p>
              </div>
            ))}
          </div>
        ) : (
          <p className="exercise-hints-empty">No hints were given for this exercise.</p>
        )}
      </article>

      {showTranscript && (
        <TranscriptSheet
          messages={sliceTranscript(
            normalizeTranscript(session?.raw_transcript_ref),
            exercise.started_at,
            exercise.ended_at,
          )}
          onClose={() => setShowTranscript(false)}
        />
      )}
    </main>
  );
}
