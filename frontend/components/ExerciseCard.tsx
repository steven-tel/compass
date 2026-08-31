import Link from "next/link";
import { formatDate, formatDuration, conceptChipStyle, exerciseTitle } from "@/lib/format";
import type { Exercise } from "@/lib/types";
import { StatusBadge } from "./StatusBadge";
import { MathText } from "./MathText";

export function ExerciseCard({ exercise }: { exercise: Exercise }) {
  const href = `/sessions/${encodeURIComponent(exercise.session_id)}/exercises/${encodeURIComponent(exercise.exercise_id)}`;
  return (
    <Link className="card" href={href}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div className="card-title">
          <MathText text={exerciseTitle(exercise)} />
        </div>
        <StatusBadge value={exercise.outcome} />
      </div>
      <div className="meta">
        <span>{formatDate(exercise.started_at)}</span>
        <span>{formatDuration(exercise.duration_seconds)}</span>
        {exercise.correct == null ? null : <span>{exercise.correct ? "Correct" : "Incorrect"}</span>}
      </div>
      <div className="chips">
        {(exercise.concept_ids || []).map((id) => (
          <span key={id} className="chip" style={conceptChipStyle(id)}>
            {id}
          </span>
        ))}
      </div>
    </Link>
  );
}
