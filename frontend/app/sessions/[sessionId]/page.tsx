"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { api, isSessionReady } from "@/lib/api";
import { useCompactHeader } from "@/lib/useCompactHeader";
import {
  formatExerciseStamp,
  formatMinutesLabel,
  formatPercent,
  formatSessionStamp,
  humanizeConcept,
  conceptChipStyle,
  OUTCOME_LABELS,
  sessionTitle,
  exerciseTitle,
  uniquifyTitles,
  normalizeTranscript,
} from "@/lib/format";
import type { Exercise, HomeworkSession } from "@/lib/types";
import { MathText } from "@/components/MathText";
import { SessionComputing } from "@/components/SessionComputing";
import { AtmosphereLights } from "@/components/AtmosphereLights";
import { TranscriptSheet } from "@/components/TranscriptSheet";

function averageIndependence(exercises: Exercise[]): string {
  const scores = exercises
    .map((exercise) => exercise.independence_score)
    .filter((value): value is number => value != null && Number.isFinite(value));
  if (!scores.length) return "—";
  return formatPercent(scores.reduce((sum, value) => sum + value, 0) / scores.length);
}

export default function SessionDetailPage() {
  const params = useParams<{ sessionId: string }>();
  const sessionId = decodeURIComponent(params.sessionId);
  const [session, setSession] = useState<HomeworkSession | null>(null);
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [status, setStatus] = useState("");
  const [showTranscript, setShowTranscript] = useState(false);
  const [fresh] = useState(
    () =>
      typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).get("fresh") === "1"
  );
  const [ready, setReady] = useState(false);
  const compactHeader = useCompactHeader();

  useEffect(() => {
    let cancelled = false;
    const deadline = Date.now() + 90000;

    async function wait(ms: number) {
      await new Promise((resolve) => window.setTimeout(resolve, ms));
    }

    async function load() {
      while (!cancelled) {
        const timedOut = Date.now() > deadline;
        try {
          const next = await api.getSession(sessionId);
          const data = await api.listSessionExercises(sessionId);
          if (cancelled) return;
          const list = data.exercises || [];
          if (isSessionReady(next, list.length, { fresh, timedOut })) {
            setSession(next);
            setExercises(list);
            setReady(true);
            setStatus("");
            return;
          }
        } catch (error) {
          if (cancelled) return;
          if (timedOut) {
            setStatus(error instanceof Error ? error.message : "Could not load session");
            setReady(true);
            return;
          }
        }
        await wait(1200);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [sessionId, fresh]);

  const independence = useMemo(() => averageIndependence(exercises), [exercises]);
  const exerciseTitles = useMemo(
    () => uniquifyTitles(exercises.map((exercise, index) => exerciseTitle(exercise, index))),
    [exercises]
  );

  if (!ready || !session) {
    return (
      <main className="session-view is-computing">
        <AtmosphereLights />
        <SessionComputing />
        {status ? <p className="session-computing-error">{status}</p> : null}
      </main>
    );
  }

  return (
    <main className="session-view content-in">
      <header className={`session-hero${compactHeader ? " is-compact" : ""}`}>
        <Link href="/sessions" className="session-back" aria-label="Back to sessions">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M11 6.2 5.2 12 11 17.8M5.2 12h14"
              stroke="white"
              strokeWidth="2.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </Link>
        <div className="session-title-row">
          <svg width="22" height="20" viewBox="0 0 22 20" aria-hidden="true">
            <path
              d="M2 16h18l-1.2-9-4.3 3.6L11 3 7.5 10.6 3.2 7 2 16z"
              fill="#F4C430"
            />
            <rect x="2" y="16" width="18" height="2.4" rx="1" fill="#E0B000" />
          </svg>
          <h1>
            <MathText text={sessionTitle(session)} />
          </h1>
        </div>
        <div className="session-hero-extras">
          <div>
            <p className="session-date">{formatSessionStamp(session.started_at)}</p>
            <div className="session-stats">
              <div className="session-stat">
                <strong>{exercises.length || session.exercise_count || 0}</strong>
                <span>Exercises</span>
              </div>
              <div className="session-stat">
                <strong>{formatMinutesLabel(session.duration_seconds)}</strong>
                <span>Duration</span>
              </div>
              <div className="session-stat">
                <strong>{independence}</strong>
                <span>Independence</span>
              </div>
            </div>
          </div>
        </div>
      </header>

      <section className="session-list">
        {session.session_summary ? (
          <article className="exercise-figma profile-tips exercise-enter">
            <div className="profile-tips-panel">
              <MathText text={session.session_summary} />
            </div>
          </article>
        ) : null}

        {exercises.length === 0 && (
          <p className="empty">No exercises detected for this session yet.</p>
        )}
        {exercises.map((exercise, index) => {
          const outcome = exercise.outcome || "unknown";
          return (
            <Link
              className={`exercise-figma exercise-figma-link exercise-enter outcome-card ${outcome}`}
              key={exercise.exercise_id}
              href={`/sessions/${encodeURIComponent(sessionId)}/exercises/${encodeURIComponent(exercise.exercise_id)}`}
              style={{ "--enter-delay": `${Math.min(index, 6) * 0.08}s` } as CSSProperties}
            >
              <div className="exercise-figma-top">
                <div className="exercise-figma-name">
                  <span className="exercise-dot" />
                  <MathText text={exerciseTitles[index]} />
                </div>
                <span className={`badge figma-badge ${outcome}`}>
                  {OUTCOME_LABELS[outcome] || outcome}
                </span>
              </div>
              <p className="exercise-figma-time">
                {formatExerciseStamp(exercise.started_at, exercise.duration_seconds)}
              </p>
              <div className="concepts-box">
                <p>Concepts Included:</p>
                <div className="chips">
                  {(exercise.concept_ids || []).length ? (
                    exercise.concept_ids?.map((id) => (
                      <span key={id} className="chip" style={conceptChipStyle(id)}>
                        {humanizeConcept(id)}
                      </span>
                    ))
                  ) : (
                    <span className="note">None matched</span>
                  )}
                </div>
              </div>
            </Link>
          );
        })}
      </section>

      <button className="transcript-btn" type="button" onClick={() => setShowTranscript(true)}>
        See Full Transcript
      </button>

      {showTranscript && (
        <TranscriptSheet
          messages={normalizeTranscript(session.raw_transcript_ref)}
          onClose={() => setShowTranscript(false)}
        />
      )}
    </main>
  );
}
