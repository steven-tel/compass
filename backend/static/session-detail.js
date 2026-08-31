const statusEl = document.getElementById("session-status");
const detailEl = document.getElementById("session-detail");
const infoEl = document.getElementById("session-info");
const transcriptEl = document.getElementById("session-transcript");
const titleEl = document.getElementById("session-title");
const deleteBtn = document.getElementById("deleteBtn");
const detectBtn = document.getElementById("detectBtn");
const exerciseStatusEl = document.getElementById("exercise-status");
const exerciseListEl = document.getElementById("exercise-list");

const sessionId = decodeURIComponent(window.location.pathname.split("/").filter(Boolean).pop());

const OUTCOME_LABELS = {
  completed_correct: "Completed correctly",
  completed_incorrect: "Completed incorrectly",
  completed_with_help: "Completed with help",
  abandoned: "Abandoned",
};

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString();
}

function formatDuration(seconds) {
  if (seconds == null) return "—";
  const total = Number(seconds);
  if (!Number.isFinite(total)) return String(seconds);
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  if (mins === 0) return `${secs}s`;
  return `${mins}m ${secs}s`;
}

function formatValue(value) {
  if (value == null || value === "") return "—";
  if (Array.isArray(value)) {
    return value.length ? value.join(", ") : "—";
  }
  if (typeof value === "object") {
    return JSON.stringify(value, null, 2);
  }
  return String(value);
}

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function infoRows(session) {
  const fields = [
    ["session_id", session.session_id],
    ["status", session.status],
    ["started_at", formatDate(session.started_at)],
    ["ended_at", formatDate(session.ended_at)],
    ["duration", formatDuration(session.duration_seconds)],
    ["course_focus", session.course_focus],
    ["exercise_count", session.exercise_count],
    ["completed_count", session.completed_count],
    ["abandoned_count", session.abandoned_count],
    ["concepts_covered", session.concepts_covered],
    ["concepts_struggled", session.concepts_struggled],
    ["recommended_next_concepts", session.recommended_next_concepts],
    ["overall_engagement", session.overall_engagement],
    ["session_summary", session.session_summary],
    ["device_info", session.device_info],
  ];

  return fields
    .map(([label, value]) => {
      const formatted = formatValue(value);
      const isMultiline = formatted.includes("\n");
      return `<div class="session-detail-row">
        <dt>${escapeHtml(label)}</dt>
        <dd${isMultiline ? ' class="pre"' : ""}>${escapeHtml(formatted)}</dd>
      </div>`;
    })
    .join("");
}

function renderTranscript(raw) {
  if (!raw || (Array.isArray(raw) && !raw.length)) {
    transcriptEl.innerHTML = `<p class="note">No transcript was saved for this session.</p>`;
    return;
  }

  if (typeof raw === "string") {
    transcriptEl.innerHTML = `<p class="note">${escapeHtml(raw)}</p>`;
    return;
  }

  transcriptEl.innerHTML = raw
    .map((message) => {
      const role = message.role === "user" ? "user" : "gemini";
      const label = message.role === "user" ? "Student" : "Tutor";
      return `<div class="message ${role}">
        <div class="message-role">${escapeHtml(label)}</div>
        <div>${escapeHtml(message.text || "")}</div>
      </div>`;
    })
    .join("");
}

function renderExercises(exercises) {
  if (!exercises.length) {
    exerciseListEl.innerHTML = "";
    exerciseStatusEl.textContent =
      "No exercises linked to this session yet. Detect them from the transcript.";
    exerciseStatusEl.classList.remove("hidden");
    return;
  }

  exerciseStatusEl.classList.add("hidden");
  exerciseListEl.innerHTML = exercises
    .map((exercise) => {
      const id = escapeHtml(exercise.exercise_id);
      const outcome = exercise.outcome || "unknown";
      const concepts = (exercise.concept_ids || [])
        .map((conceptId) => `<span class="concept-chip">${escapeHtml(conceptId)}</span>`)
        .join(" ") || `<span class="note">No matched concepts</span>`;
      const href = `/sessions/${encodeURIComponent(sessionId)}/exercises/${encodeURIComponent(exercise.exercise_id)}`;
      return `<a class="exercise-card" href="${href}">
        <div class="exercise-card-top">
          <span class="session-id">${id}</span>
          <span class="status-badge status-${escapeHtml(outcome)}">${escapeHtml(OUTCOME_LABELS[outcome] || outcome)}</span>
        </div>
        <div class="session-meta">
          <span>${escapeHtml(formatDuration(exercise.duration_seconds))}</span>
          <span>${exercise.correct == null ? "" : exercise.correct ? "Correct" : "Incorrect"}</span>
        </div>
        <div class="concept-row">${concepts}</div>
      </a>`;
    })
    .join("");
}

async function loadExercises() {
  exerciseStatusEl.classList.remove("hidden");
  exerciseStatusEl.textContent = "Loading exercises…";
  try {
    const response = await fetch(
      `/api/sessions/${encodeURIComponent(sessionId)}/exercises`
    );
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    renderExercises(data.exercises || []);
  } catch (error) {
    exerciseListEl.innerHTML = "";
    exerciseStatusEl.textContent = `Could not load exercises: ${error.message}`;
  }
}

async function loadSession() {
  try {
    const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}`);
    if (response.status === 404) {
      statusEl.textContent = "Session not found.";
      deleteBtn.disabled = true;
      detectBtn.disabled = true;
      return;
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const session = await response.json();
    titleEl.textContent = session.session_id;
    document.title = session.session_id;
    infoEl.innerHTML = infoRows(session);
    renderTranscript(session.raw_transcript_ref);
    statusEl.classList.add("hidden");
    detailEl.classList.remove("hidden");
    await loadExercises();
  } catch (error) {
    statusEl.textContent = `Could not load session: ${error.message}`;
  }
}

detectBtn.addEventListener("click", async () => {
  detectBtn.disabled = true;
  exerciseStatusEl.classList.remove("hidden");
  exerciseStatusEl.textContent = "Detecting exercises from the transcript…";
  try {
    const response = await fetch(
      `/api/sessions/${encodeURIComponent(sessionId)}/exercises/detect`,
      { method: "POST" }
    );
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.detail || `HTTP ${response.status}`);
    }
    const data = await response.json();
    renderExercises(data.exercises || []);
    const sessionResponse = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}`);
    if (sessionResponse.ok) {
      const session = await sessionResponse.json();
      infoEl.innerHTML = infoRows(session);
    }
  } catch (error) {
    exerciseStatusEl.textContent = `Could not detect exercises: ${error.message}`;
  } finally {
    detectBtn.disabled = false;
  }
});

deleteBtn.addEventListener("click", async () => {
  if (!confirm(`Delete session ${sessionId} from Firestore?`)) return;
  try {
    const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}`, {
      method: "DELETE",
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    window.location.href = "/sessions";
  } catch (error) {
    alert(`Could not delete session: ${error.message}`);
  }
});

loadSession();
