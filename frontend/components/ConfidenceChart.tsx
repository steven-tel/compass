"use client";

import { useMemo } from "react";
import type { Exercise } from "@/lib/types";
import { confidenceLevelFromPct } from "@/lib/format";

const LEVEL_SCORE: Record<string, number> = {
  low: 12,
  needs_review: 12,
  medium: 50,
  building: 50,
  high: 82,
  strong: 82,
  mastered: 96,
};

type ChartPoint = {
  pct: number;
  label: string;
  level: string;
};

function attemptScore(exercise: Exercise): number | null {
  if (exercise.independence_score != null && Number.isFinite(Number(exercise.independence_score))) {
    return Math.max(0, Math.min(100, Math.round(Number(exercise.independence_score) * 100)));
  }
  const level = (exercise.confidence_assessment?.level || "").toLowerCase();
  return LEVEL_SCORE[level] ?? null;
}

function shortDate(value?: string): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function buildPoints(exercises: Exercise[]): ChartPoint[] {
  return [...exercises]
    .sort((a, b) => String(a.started_at || "").localeCompare(String(b.started_at || "")))
    .map((exercise) => {
      const pct = attemptScore(exercise);
      if (pct == null) return null;
      return {
        pct,
        label: shortDate(exercise.started_at || exercise.ended_at || undefined),
        level: confidenceLevelFromPct(pct),
      };
    })
    .filter((point): point is ChartPoint => point != null);
}

const W = 320;
const H = 132;
const PAD = { top: 12, right: 12, bottom: 26, left: 28 };
const INNER_W = W - PAD.left - PAD.right;
const INNER_H = H - PAD.top - PAD.bottom;

function xy(index: number, pct: number, count: number): { x: number; y: number } {
  const x =
    count <= 1
      ? PAD.left + INNER_W / 2
      : PAD.left + (index / (count - 1)) * INNER_W;
  const y = PAD.top + INNER_H - (pct / 100) * INNER_H;
  return { x, y };
}

export function ConfidenceChart({
  exercises,
  level = "building",
}: {
  exercises: Exercise[];
  level?: string;
}) {
  const points = useMemo(() => buildPoints(exercises), [exercises]);

  if (!points.length) {
    return <p className="profile-meter-caption">No scored attempts yet to graph.</p>;
  }

  const coords = points.map((point, index) => xy(index, point.pct, points.length));
  const line = coords.map((c, i) => `${i === 0 ? "M" : "L"}${c.x.toFixed(1)} ${c.y.toFixed(1)}`).join(" ");
  const area = `${line} L${coords[coords.length - 1].x.toFixed(1)} ${(PAD.top + INNER_H).toFixed(1)} L${coords[0].x.toFixed(1)} ${(PAD.top + INNER_H).toFixed(1)} Z`;
  const labelIndexes =
    points.length <= 4
      ? points.map((_, i) => i)
      : [0, Math.round((points.length - 1) / 2), points.length - 1];

  return (
    <div className={`confidence-chart ${level}`} aria-label="Confidence over time">
      <svg viewBox={`0 0 ${W} ${H}`} role="img">
        {[0, 50, 100].map((tick) => {
          const y = xy(0, tick, 1).y;
          return (
            <g key={tick}>
              <line
                className="confidence-chart-grid"
                x1={PAD.left}
                x2={W - PAD.right}
                y1={y}
                y2={y}
              />
              <text className="confidence-chart-ytick" x={PAD.left - 6} y={y + 3} textAnchor="end">
                {tick}
              </text>
            </g>
          );
        })}
        <path className="confidence-chart-area" d={area} />
        <path className="confidence-chart-line" d={line} />
        {coords.map((c, i) => (
          <circle
            key={`${points[i].label}-${i}`}
            className={`confidence-chart-dot ${points[i].level}`}
            cx={c.x}
            cy={c.y}
            r={points.length === 1 ? 5.5 : 4.2}
          >
            <title>{`${points[i].label}: ${points[i].pct}%`}</title>
          </circle>
        ))}
        {labelIndexes.map((i) => (
          <text
            key={`label-${i}`}
            className="confidence-chart-xtick"
            x={coords[i].x}
            y={H - 6}
            textAnchor="middle"
          >
            {points[i].label}
          </text>
        ))}
      </svg>
    </div>
  );
}
