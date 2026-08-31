"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { useCompactHeader } from "@/lib/useCompactHeader";
import {
  formatCardDuration,
  formatSessionStamp,
  humanizeConcept,
  conceptChipStyle,
  sessionTitle,
  uniquifyTitles,
} from "@/lib/format";
import type { HomeworkSession } from "@/lib/types";
import { MathText } from "@/components/MathText";

export default function SessionsPage() {
  const [sessions, setSessions] = useState<HomeworkSession[]>([]);
  const [status, setStatus] = useState("Loading sessions…");
  const compactHeader = useCompactHeader();

  async function load() {
    setStatus("Loading sessions…");
    try {
      const data = await api.listSessions();
      setSessions(data.sessions || []);
      setStatus(data.sessions?.length ? "" : "No sessions yet.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not load sessions");
    }
  }

  useEffect(() => {
    load();
  }, []);

  const totals = useMemo(() => {
    const exercises = sessions.reduce((sum, session) => sum + (session.exercise_count || 0), 0);
    const completed = sessions.filter((session) => session.status === "completed").length;
    return { exercises, completed };
  }, [sessions]);
  const titles = useMemo(
    () => uniquifyTitles(sessions.map((session) => sessionTitle(session))),
    [sessions]
  );

  return (
    <main className="sessions-view">
      <header className={`session-hero sessions-hero${compactHeader ? " is-compact" : ""}`}>
        <div className="profile-hero-top">
          <Link href="/" className="session-back" aria-label="Back to home">
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
        </div>
        <div className="session-title-row profile-title-row">
          <h1>Sessions</h1>
        </div>
        <div className="session-hero-extras">
          <div>
            <p className="session-date">Your homework history</p>
            <div className="session-stats">
              <div className="session-stat">
                <strong>{sessions.length}</strong>
                <span>Sessions</span>
              </div>
              <div className="session-stat">
                <strong>{totals.exercises}</strong>
                <span>Exercises</span>
              </div>
              <div className="session-stat">
                <strong>{totals.completed}</strong>
                <span>Completed</span>
              </div>
            </div>
          </div>
        </div>
      </header>

      <section className="session-list">
        {status ? <p className="empty">{status}</p> : null}
        {sessions.map((session, index) => {
          return (
            <Link
              className="exercise-figma exercise-figma-link exercise-enter"
              key={session.session_id}
              href={`/sessions/${encodeURIComponent(session.session_id)}`}
              style={{ "--enter-delay": `${Math.min(index, 6) * 0.08}s` } as CSSProperties}
            >
              <div className="exercise-figma-top">
                <div className="exercise-figma-name">
                  <span className="exercise-dot" />
                  <MathText text={titles[index]} />
                </div>
              </div>
              <p className="exercise-figma-time">
                {formatSessionStamp(session.started_at)} - {formatCardDuration(session.duration_seconds)}
              </p>
              <div className="concepts-box">
                <p>Concepts Included:</p>
                <div className="chips">
                  {(session.concepts_covered || []).length ? (
                    session.concepts_covered?.map((id) => (
                      <span key={id} className="chip" style={conceptChipStyle(id)}>
                        {humanizeConcept(id)}
                      </span>
                    ))
                  ) : (
                    <span className="note">
                      {session.exercise_count || 0} exercise
                      {(session.exercise_count || 0) === 1 ? "" : "s"}
                    </span>
                  )}
                </div>
              </div>
            </Link>
          );
        })}
      </section>
    </main>
  );
}
