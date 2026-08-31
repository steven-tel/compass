"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { useCompactHeader } from "@/lib/useCompactHeader";
import { confidenceLevelFromPct, CONFIDENCE_LABELS, formatPercent } from "@/lib/format";
import type { EvaluatedConcept, HomeworkSession, TutorTips } from "@/lib/types";
import { MathText } from "@/components/MathText";

const WEEKDAY = ["M", "T", "W", "T", "F", "S", "S"];
const WEEK_GOAL_MIN = 180;

function dayKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function sessionDayKey(value?: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return dayKey(new Date(date.getFullYear(), date.getMonth(), date.getDate()));
}

function currentWeekDays(): Date[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const monday = new Date(today);
  monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));
  return Array.from({ length: 7 }, (_, index) => {
    const day = new Date(monday);
    day.setDate(monday.getDate() + index);
    return day;
  });
}

function currentStreak(sessions: HomeworkSession[]): number {
  const days = new Set<string>();
  for (const session of sessions) {
    const key = sessionDayKey(session.started_at);
    if (key) days.add(key);
  }
  if (!days.size) return 0;

  const cursor = new Date();
  cursor.setHours(0, 0, 0, 0);
  if (!days.has(dayKey(cursor))) {
    cursor.setDate(cursor.getDate() - 1);
    if (!days.has(dayKey(cursor))) return 0;
  }

  let streak = 0;
  while (days.has(dayKey(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

function FlameIcon() {
  return (
    <svg className="streak-flame" width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
      <defs>
        <linearGradient id="streak-flame-grad" x1="12" y1="2" x2="12" y2="22" gradientUnits="userSpaceOnUse">
          <stop stopColor="#FFD60A" />
          <stop offset="0.45" stopColor="#FF9F0A" />
          <stop offset="1" stopColor="#FF453A" />
        </linearGradient>
      </defs>
      <path
        fill="url(#streak-flame-grad)"
        d="M12.2 2.2c.4 2.2-.2 3.8-1.4 5.2-1.4 1.6-2.2 2.8-2.2 4.5 0 1.2.4 2.2 1.1 3-1.6-.3-3.4-1.8-4.2-3.8-.8 1.4-1.1 2.8-1.1 4.2 0 4.1 3.2 7.2 7.6 7.2s7.6-3.1 7.6-7.2c0-2.8-1.3-4.8-2.8-6.6-1.4-1.7-2.6-3.3-2.6-5.3 0-.4 0-.8.1-1.2-.9.6-1.6 1.6-2.1 3z"
      />
      <path
        fill="#FFECA8"
        d="M12.1 13.2c.7 0 1.4.3 1.8.9.5.6.6 1.4.3 2.2-.3.8-1 1.4-1.9 1.6 1.1-.9 1.3-2.1.8-3.1-.2-.4-.6-.7-1-.8z"
      />
    </svg>
  );
}

function confidencePct(concept: EvaluatedConcept): number {
  if (concept.average_confidence == null) return 0;
  const value = Number(concept.average_confidence);
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value * 100)));
}

export default function ProfilePage() {
  const [concepts, setConcepts] = useState<EvaluatedConcept[]>([]);
  const [sessions, setSessions] = useState<HomeworkSession[]>([]);
  const [status, setStatus] = useState("Loading profile…");
  const compactHeader = useCompactHeader();
  const [weekMinutes, setWeekMinutes] = useState(0);
  const [chartReady, setChartReady] = useState(false);
  const [masterySort, setMasterySort] = useState<"high" | "low">("high");
  const [tips, setTips] = useState<TutorTips | null>(null);
  const [tipsLoading, setTipsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.listConcepts(), api.listSessions()])
      .then(([conceptData, sessionData]) => {
        if (cancelled) return;
        setConcepts(conceptData.concepts || []);
        setSessions(sessionData.sessions || []);
        setStatus("");
      })
      .catch((error) => {
        if (!cancelled) {
          setStatus(error instanceof Error ? error.message : "Could not load profile");
        }
      });
    api
      .getTutorTips()
      .then((data) => {
        if (!cancelled) setTips(data);
      })
      .catch((error) => {
        console.error("Tutor tips failed", error);
        if (!cancelled) setTips(null);
      })
      .finally(() => {
        if (!cancelled) setTipsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const totals = useMemo(() => {
    const exercises = sessions.reduce((sum, session) => sum + (session.exercise_count || 0), 0);
    return { exercises, streak: currentStreak(sessions) };
  }, [sessions]);

  const week = useMemo(() => {
    const days = currentWeekDays();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayKey = dayKey(today);
    const minutesByDay = new Map<string, number>();
    for (const session of sessions) {
      const key = sessionDayKey(session.started_at);
      if (!key) continue;
      minutesByDay.set(key, (minutesByDay.get(key) || 0) + Math.round((session.duration_seconds || 0) / 60));
    }
    const points = days.map((day, index) => {
      const key = dayKey(day);
      return {
        key,
        label: WEEKDAY[index],
        minutes: minutesByDay.get(key) || 0,
        today: key === todayKey,
        future: key > todayKey,
      };
    });
    const total = points.reduce((sum, point) => sum + point.minutes, 0);
    const max = Math.max(1, ...points.map((point) => point.minutes));
    return {
      points,
      max,
      total,
      goalPct: Math.min(100, Math.round((total / WEEK_GOAL_MIN) * 100)),
    };
  }, [sessions]);

  useEffect(() => {
    if (status) {
      setChartReady(false);
      setWeekMinutes(0);
      return;
    }
    setChartReady(false);
    setWeekMinutes(0);
    const startAt = window.setTimeout(() => setChartReady(true), 450);
    return () => window.clearTimeout(startAt);
  }, [status, week.total]);

  useEffect(() => {
    if (!chartReady) {
      setWeekMinutes(0);
      return;
    }
    const start = performance.now();
    const duration = 900;
    let frame = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - (1 - t) ** 3;
      setWeekMinutes(Math.round(week.total * eased));
      if (t < 1) frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [chartReady, week.total]);

  const rankedConcepts = useMemo(() => {
    const practiced = concepts.filter((concept) => (concept.exercise_count || 0) > 0);
    const direction = masterySort === "high" ? -1 : 1;
    return [...practiced].sort((a, b) => {
      const delta = (confidencePct(a) - confidencePct(b)) * direction;
      if (delta) return delta;
      return (a.name || a.concept_id).localeCompare(b.name || b.concept_id);
    });
  }, [concepts, masterySort]);

  return (
    <main className="sessions-view">
      <header className={`session-hero profile-hero${compactHeader ? " is-compact" : ""}`}>
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
          <img src="/avatar.png" alt="" className="profile-hero-avatar" />
        </div>
        <div className="session-title-row profile-title-row">
          <h1>Chris</h1>
        </div>
        <div className="session-hero-extras">
          <div>
            <div className="session-stats">
              <div className="session-stat">
                <strong>{sessions.length}</strong>
                <span>Sessions</span>
              </div>
              <div className="session-stat">
                <strong>{totals.exercises}</strong>
                <span>Exercises</span>
              </div>
              <div className="session-stat session-stat-streak">
                <strong>
                  {totals.streak}
                  <FlameIcon />
                </strong>
                <span>Day streak</span>
              </div>
            </div>
          </div>
        </div>
      </header>

      <section className="session-list">
        {status ? <p className="empty">{status}</p> : null}

        <article className="exercise-figma profile-week exercise-enter">
          <div className="exercise-figma-top">
            <div className="exercise-figma-name">Practice this week</div>
            <span className="note profile-week-total">
              {weekMinutes}/{WEEK_GOAL_MIN} min
            </span>
          </div>
          {status ? (
            <p className="exercise-figma-time">Loading this week…</p>
          ) : (
            <>
              <div
                className={`profile-chart${chartReady ? " is-ready" : ""}`}
                aria-label="Minutes practiced Monday to Sunday"
              >
                {week.points.map((point, index) => (
                  <div
                    className={`profile-chart-col${point.today ? " is-today" : ""}${point.future ? " is-future" : ""}`}
                    key={point.key}
                    style={{ "--bar-delay": `${index * 0.32}s` } as CSSProperties}
                  >
                    <span className="profile-chart-value">
                      {point.minutes ? point.minutes : ""}
                    </span>
                    <div
                      className={`profile-chart-bar${point.minutes ? "" : " is-empty"}${point.today ? " is-today" : ""}`}
                      style={{ height: `${Math.max(6, Math.round((point.minutes / week.max) * 48))}px` }}
                      title={`${point.minutes} min`}
                    />
                    <span className="profile-chart-label">{point.label}</span>
                  </div>
                ))}
              </div>
              <div className={`profile-goal${chartReady ? " is-ready" : ""}`}>
                <div className="profile-goal-top">
                  <span>Weekly goal</span>
                  <span>{Math.min(weekMinutes, WEEK_GOAL_MIN) === WEEK_GOAL_MIN ? "Done" : `${WEEK_GOAL_MIN - weekMinutes} min left`}</span>
                </div>
                <div className="profile-goal-bar" aria-label={`${week.goalPct}% of ${WEEK_GOAL_MIN} minute goal`}>
                  <div
                    className={`profile-goal-fill${week.total >= WEEK_GOAL_MIN ? " is-done" : ""}`}
                    style={{ width: chartReady ? `${week.goalPct}%` : 0 }}
                  />
                </div>
              </div>
            </>
          )}
        </article>

        <article className="exercise-figma profile-tips exercise-enter">
          <div className="exercise-figma-top">
            <div className="exercise-figma-name">Tutor tips</div>
          </div>
          {tipsLoading ? (
            <p className="profile-tips-copy">Your tutor is jotting a few notes…</p>
          ) : (tips?.tips || []).length ? (
            <>
              {tips?.headline ? <p className="profile-tips-copy">{tips.headline}</p> : null}
              <ul className="profile-tips-list">
                {(tips?.tips || []).map((tip, index) => (
                  <li key={`${tip.title}-${index}`}>
                    <strong>
                      <MathText text={tip.title} />
                    </strong>
                    <span className="profile-tips-body">
                      <MathText text={tip.body} />
                    </span>
                  </li>
                ))}
              </ul>
              {tips?.next_focus ? (
                <p className="profile-tips-copy">Next up: {tips.next_focus}</p>
              ) : null}
            </>
          ) : (
            <p className="profile-tips-copy">
              Finish a tutoring session and I&apos;ll leave you a few lively notes here.
            </p>
          )}
        </article>

        <h2 className="profile-section-title">
          Practiced concepts
          <button
            type="button"
            className="profile-sort"
            onClick={() => setMasterySort((current) => (current === "high" ? "low" : "high"))}
            aria-label={
              masterySort === "high"
                ? "Sorted by highest mastery. Tap to show needs review first."
                : "Sorted by lowest mastery. Tap to show mastered first."
            }
          >
            {masterySort === "high" ? "Highest first" : "Lowest first"}
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
              <path
                d="M6 1.8 9.2 5.4H2.8L6 1.8z"
                fill="currentColor"
                opacity={masterySort === "high" ? 1 : 0.28}
              />
              <path
                d="M2.8 6.6h6.4L6 10.2 2.8 6.6z"
                fill="currentColor"
                opacity={masterySort === "low" ? 1 : 0.28}
              />
            </svg>
          </button>
        </h2>

        {!status && rankedConcepts.length === 0 ? (
          <p className="empty">No concepts started yet. Finish a tutoring session to see progress here.</p>
        ) : null}

        {rankedConcepts.map((concept, index) => {
          const pct = confidencePct(concept);
          const level = confidenceLevelFromPct(pct);
          return (
            <Link
              className={`exercise-figma exercise-figma-link exercise-enter concept-card ${level || "building"}`}
              key={concept.concept_id}
              href={`/concepts/${encodeURIComponent(concept.concept_id)}`}
              style={{ "--enter-delay": `${Math.min(index, 6) * 0.08}s` } as CSSProperties}
            >
              <div className="exercise-figma-top">
                <div className="exercise-figma-name">
                  <span className="exercise-dot" />
                  {concept.name || concept.concept_id}
                </div>
                <span className={`badge figma-badge ${level || "active"}`}>
                  {CONFIDENCE_LABELS[level] || formatPercent(concept.average_confidence)}
                </span>
              </div>
              <p className="exercise-figma-time">
                {concept.domain || "Math"}
                {concept.subdomain ? ` · ${concept.subdomain}` : ""}
                {" · "}
                {concept.exercise_count || 0} exercise
                {(concept.exercise_count || 0) === 1 ? "" : "s"}
              </p>
              <div className="profile-meter" aria-label={`${pct}% confidence`}>
                <div
                  className={`profile-meter-fill ${level || "empty"}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <p className="profile-meter-caption">{pct}% confidence</p>
            </Link>
          );
        })}
      </section>
    </main>
  );
}
