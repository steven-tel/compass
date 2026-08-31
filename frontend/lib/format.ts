export const OUTCOME_LABELS: Record<string, string> = {
  completed_correct: "Completed",
  completed_incorrect: "Incorrect",
  completed_with_help: "Completed with help",
  abandoned: "Abandoned",
};

export const CONFIDENCE_LABELS: Record<string, string> = {
  needs_review: "Needs review",
  building: "Building",
  strong: "Strong",
  mastered: "Mastered",
  low: "Needs review",
  medium: "Building",
  high: "Strong",
};

export function confidenceLevelFromPct(pct: number): string {
  if (pct >= 90) return "mastered";
  if (pct >= 70) return "strong";
  if (pct >= 30) return "building";
  return "needs_review";
}

export const SESSION_STATUS_LABELS: Record<string, string> = {
  active: "Active",
  completed: "Completed",
  abandoned: "Abandoned",
  error: "Error",
};

export const OBSERVATION_LABELS: Record<string, string> = {
  struggle: "Saw a struggle",
  success: "Saw a success",
  mistake: "Saw a mistake",
  correction: "Saw a correction",
  pause: "Noticed a pause",
  progress: "Saw progress",
};

export type TranscriptRole = "user" | "gemini" | "observation";

export type TranscriptTurn = {
  role: TranscriptRole;
  text: string;
  kind?: string | null;
  timestamp?: string | null;
};

export function isObservation(message: { role?: string | null }): boolean {
  const role = (message.role || "").toLowerCase();
  return role === "observation" || role === "visual" || role === "note";
}

export function observationLabel(kind?: string | null): string {
  return OBSERVATION_LABELS[(kind || "").toLowerCase()] || "Saw on the paper";
}

export function transcriptRole(message: { role?: string | null }): TranscriptRole {
  if (isObservation(message)) return "observation";
  return (message.role || "").toLowerCase() === "user" ? "user" : "gemini";
}

export function normalizeTranscript(
  raw?: { role?: string | null; text?: string | null; kind?: string | null; timestamp?: string | null }[] | string | null,
): TranscriptTurn[] {
  if (!raw) return [];
  if (typeof raw === "string") {
    const text = raw.trim();
    return text ? [{ role: "user", text }] : [];
  }
  return raw
    .map((message) => ({
      role: transcriptRole(message),
      text: (message.text || "").trim(),
      kind: message.kind,
      timestamp: message.timestamp ?? null,
    }))
    .filter((message) => message.text);
}

export function sliceTranscript(
  messages: TranscriptTurn[],
  start?: string | null,
  end?: string | null,
): TranscriptTurn[] {
  if (!messages.length || (!start && !end)) return messages;
  const startMs = start ? Date.parse(start) : Number.NaN;
  const endMs = end ? Date.parse(end) : Number.NaN;
  const from = Number.isFinite(startMs) ? startMs - 4000 : Number.NEGATIVE_INFINITY;
  const to = Number.isFinite(endMs) ? endMs + 20000 : Number.POSITIVE_INFINITY;
  if (!Number.isFinite(from) && !Number.isFinite(to)) return messages;

  const hits = messages
    .map((message, index) => ({ index, time: message.timestamp ? Date.parse(message.timestamp) : Number.NaN }))
    .filter(({ time }) => Number.isFinite(time) && time >= from && time <= to);
  if (!hits.length) return messages;
  return messages.slice(hits[0].index, hits[hits.length - 1].index + 1);
}

function parseDate(value?: string | null): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatTime(date: Date): string {
  return date
    .toLocaleTimeString("en-GB", { hour: "numeric", minute: "2-digit", hour12: true })
    .toLowerCase();
}

function formatFriendlyStamp(date: Date): string {
  const now = new Date();
  const day = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffDays = Math.round((today.getTime() - day.getTime()) / 86400000);
  const time = formatTime(date);
  if (diffDays === 0) return `Today · ${time}`;
  if (diffDays === 1) return `Yesterday · ${time}`;
  if (diffDays === -1) return `Tomorrow · ${time}`;
  const weekday = date.toLocaleDateString("en-GB", { weekday: "long" });
  const dayMonth = date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  });
  return `${weekday}, ${dayMonth} · ${time}`;
}

export function formatDate(value?: string | null): string {
  const date = parseDate(value);
  if (!date) return value ? String(value) : "—";
  return formatFriendlyStamp(date);
}

export function formatDuration(seconds?: number | null): string {
  if (seconds == null) return "—";
  const total = Number(seconds);
  if (!Number.isFinite(total)) return String(seconds);
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  if (mins === 0) return `${secs}s`;
  return `${mins}m ${secs}s`;
}

export function formatPercent(score?: number | null): string {
  if (score == null) return "—";
  const number = Number(score);
  if (!Number.isFinite(number)) return String(score);
  return `${Math.round(number * 100)}%`;
}

export function displayValue(value: unknown): string {
  if (value == null || value === "") return "—";
  if (Array.isArray(value)) return value.length ? value.join(", ") : "—";
  if (typeof value === "object") return JSON.stringify(value, null, 2);
  return String(value);
}

export function formatSessionStamp(value?: string | null): string {
  const date = parseDate(value);
  if (!date) return value ? String(value) : "—";
  return formatFriendlyStamp(date);
}

export function formatExerciseStamp(started?: string | null, seconds?: number | null): string {
  if (!started) return formatCardDuration(seconds);
  const date = parseDate(started);
  if (!date) return formatCardDuration(seconds);
  const stamp = formatFriendlyStamp(date);
  return seconds == null ? stamp : `${stamp} · ${formatCardDuration(seconds)}`;
}

export function formatMinutesLabel(seconds?: number | null): string {
  return formatDuration(seconds);
}

export function formatLongDate(value?: string | null): string {
  const date = parseDate(value);
  if (!date) return value ? String(value) : "—";
  return date.toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export function formatCardDuration(seconds?: number | null): string {
  if (seconds == null || !Number.isFinite(Number(seconds))) return "—";
  const total = Math.round(Number(seconds));
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  if (mins === 0) return `${secs}s`;
  if (secs === 0) return `${mins} min`;
  return `${mins} min ${secs}s`;
}

export function capitalize(value?: string | null): string {
  if (!value) return "—";
  return value.replace(/\b\w/g, (char) => char.toUpperCase());
}

export function humanizeConcept(id: string): string {
  return id
    .replaceAll("_", " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

const GENERIC_TITLE = /^(exercise|session|homework|untitled|homework session|tutoring session)(\s+\d+)?$/i;

function namedTitle(value?: string | null): string | null {
  const named = value?.trim();
  if (!named || GENERIC_TITLE.test(named)) return null;
  return named;
}

export function sessionTitle(session: { title?: string | null; concepts_covered?: string[] }): string {
  const named = namedTitle(session.title);
  if (named) return named;
  const covered = session.concepts_covered || [];
  if (covered.length === 1) return humanizeConcept(covered[0]);
  if (covered.length >= 2) {
    return `${humanizeConcept(covered[0])} & ${humanizeConcept(covered[1])}`;
  }
  return "Homework session";
}

export function exerciseTitle(
  exercise: { title?: string | null; concept_ids?: string[] },
  index = 0
): string {
  const named = namedTitle(exercise.title);
  if (named) return named;
  const ids = exercise.concept_ids || [];
  if (ids.length) return humanizeConcept(ids[0]);
  return `Exercise ${index + 1}`;
}

export function uniquifyTitles(titles: string[]): string[] {
  const counts = new Map<string, number>();
  const seen = new Map<string, number>();
  for (const title of titles) {
    const key = title.toLowerCase();
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return titles.map((title) => {
    const key = title.toLowerCase();
    if ((counts.get(key) || 0) < 2) return title;
    const next = (seen.get(key) || 0) + 1;
    seen.set(key, next);
    return next === 1 ? title : `${title} (${next})`;
  });
}

const CONCEPT_PASTELS = [
  { background: "#f3e8ff", color: "#7e22ce", borderColor: "#e9d5ff" },
  { background: "#fce7f3", color: "#be185d", borderColor: "#fbcfe8" },
  { background: "#e0f2fe", color: "#0369a1", borderColor: "#bae6fd" },
  { background: "#dcfce7", color: "#15803d", borderColor: "#bbf7d0" },
  { background: "#fef9c3", color: "#a16207", borderColor: "#fde68a" },
  { background: "#ffedd5", color: "#c2410c", borderColor: "#fed7aa" },
  { background: "#e0e7ff", color: "#4338ca", borderColor: "#c7d2fe" },
  { background: "#ccfbf1", color: "#0f766e", borderColor: "#99f6e4" },
  { background: "#ffe4e6", color: "#be123c", borderColor: "#fecdd3" },
  { background: "#ecfeff", color: "#0e7490", borderColor: "#a5f3fc" },
  { background: "#ede9fe", color: "#6d28d9", borderColor: "#ddd6fe" },
  { background: "#ecfccb", color: "#4d7c0f", borderColor: "#d9f99d" },
];

export function conceptChipStyle(id: string): (typeof CONCEPT_PASTELS)[number] {
  let hash = 0;
  for (let index = 0; index < id.length; index += 1) {
    hash = (hash * 33 + id.charCodeAt(index)) >>> 0;
  }
  return CONCEPT_PASTELS[hash % CONCEPT_PASTELS.length];
}
