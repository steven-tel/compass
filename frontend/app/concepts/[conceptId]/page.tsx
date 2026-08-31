"use client";

import { useEffect, useState, type CSSProperties } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { api } from "@/lib/api";
import { useCompactHeader } from "@/lib/useCompactHeader";
import {
  confidenceLevelFromPct,
  CONFIDENCE_LABELS,
  formatExerciseStamp,
  formatPercent,
  humanizeConcept,
  exerciseTitle,
  uniquifyTitles,
  OUTCOME_LABELS,
} from "@/lib/format";
import type { EvaluatedConcept } from "@/lib/types";
import { MathText } from "@/components/MathText";
import { ConfidenceChart } from "@/components/ConfidenceChart";

export default function ConceptDetailPage() {
  const params = useParams<{ conceptId: string }>();
  const conceptId = decodeURIComponent(params.conceptId);
  const [concept, setConcept] = useState<EvaluatedConcept | null>(null);
  const [status, setStatus] = useState("Loading concept…");
  const compactHeader = useCompactHeader();

  useEffect(() => {
    api
      .getConcept(conceptId)
      .then(setConcept)
      .catch((error) => setStatus(error instanceof Error ? error.message : "Could not load concept"));
  }, [conceptId]);

  if (!concept) {
    return (
      <main className="session-view">
        <p className="note" style={{ padding: 20 }}>
          {status}
        </p>
      </main>
    );
  }

  const pct = Math.round((concept.average_confidence || 0) * 100);
  const level = confidenceLevelFromPct(pct);
  const exerciseTitles = uniquifyTitles(
    (concept.exercises || []).map((exercise, index) => exerciseTitle(exercise, index))
  );

  return (
    <main className="session-view content-in">
      <header className={`session-hero${compactHeader ? " is-compact" : ""}`}>
        <Link href="/concepts" className="session-back" aria-label="Back to profile">
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
          <h1>{concept.name || humanizeConcept(concept.concept_id)}</h1>
        </div>
        <div className="session-hero-extras">
          <div>
            <p className="session-date">
              {concept.domain || "Math"}
              {concept.subdomain ? ` · ${concept.subdomain}` : ""}
            </p>
            <div className="session-stats">
              <div className="session-stat">
                <strong>{concept.exercise_count || 0}</strong>
                <span>Exercises</span>
              </div>
              <div className="session-stat">
                <strong>{formatPercent(concept.average_confidence)}</strong>
                <span>Confidence</span>
              </div>
              <div className="session-stat">
                <strong>{CONFIDENCE_LABELS[level] || "—"}</strong>
                <span>Level</span>
              </div>
            </div>
          </div>
        </div>
      </header>

      <section className="session-list">
        {concept.description || (concept.exercises || []).length ? (
          <article className={`exercise-figma concept-card ${level || "building"}`}>
            {concept.description ? (
              <p className="exercise-figma-time" style={{ margin: 0 }}>
                {concept.description}
              </p>
            ) : null}
            <p className="confidence-chart-title">Confidence over time</p>
            <ConfidenceChart exercises={concept.exercises || []} level={level || "building"} />
            <p className="profile-meter-caption">
              {pct}% average across {(concept.exercises || []).length} attempt
              {(concept.exercises || []).length === 1 ? "" : "s"}
            </p>
          </article>
        ) : null}

        <h2 className="profile-section-title">Exercises</h2>
        {(concept.exercises || []).length === 0 ? (
          <p className="empty">No exercises for this concept yet.</p>
        ) : (
          (concept.exercises || []).map((exercise, index) => {
            const outcome = exercise.outcome || "unknown";
            return (
              <Link
                className={`exercise-figma exercise-figma-link exercise-enter outcome-card ${outcome}`}
                key={exercise.exercise_id}
                href={`/sessions/${encodeURIComponent(exercise.session_id)}/exercises/${encodeURIComponent(exercise.exercise_id)}`}
                style={{ "--enter-delay": `${Math.min(index, 6) * 0.08}s` } as CSSProperties}
              >
                <div className="exercise-figma-top">
                  <div className="exercise-figma-name">
                    <span className="exercise-dot" />
                    {exerciseTitles[index] ? <MathText text={exerciseTitles[index]} /> : null}
                  </div>
                  <span className={`badge figma-badge ${outcome}`}>
                    {OUTCOME_LABELS[outcome] || outcome}
                  </span>
                </div>
                <p className="exercise-figma-time">
                  {formatExerciseStamp(exercise.started_at, exercise.duration_seconds)}
                </p>
              </Link>
            );
          })
        )}
      </section>
    </main>
  );
}
