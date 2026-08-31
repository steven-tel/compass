const statusEl = document.getElementById("concept-status");
const detailEl = document.getElementById("concept-detail");
const infoEl = document.getElementById("concept-info");
const titleEl = document.getElementById("concept-title");
const exerciseStatusEl = document.getElementById("exercise-status");
const exerciseListEl = document.getElementById("exercise-list");

const conceptId = decodeURIComponent(
  window.location.pathname.split("/").filter(Boolean).pop() || ""
);

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

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function formatConfidence(concept) {
  if (concept.average_confidence == null) return "—";
  const percent = Math.round(Number(concept.average_confidence) * 100);
  const level = concept.average_confidence_level || "";
  return `${percent}%${level ? ` (${level})` : ""}`;
}

function infoRows(concept) {
  const fields = [
    ["concept_id", concept.concept_id],
    ["domain", concept.domain],
    ["subdomain", concept.subdomain],
    ["difficulty", concept.difficulty],
    ["description", concept.description],
    ["exercises done", concept.exercise_count],
    ["average confidence", formatConfidence(concept)],
    ["prerequisites", (concept.prerequisites || []).join(", ")],
    ["keywords", (concept.keywords || []).join(", ")],
  ];
  return fields
    .map(([label, value]) => {
      const formatted = value == null || value === "" ? "—" : String(value);
      return `<div class="session-detail-row">
        <dt>${escapeHtml(label)}</dt>
        <dd>${escapeHtml(formatted)}</dd>
      </div>`;
    })
    .join("");
}

function renderExercises(exercises) {
  if (!exercises.length) {
    exerciseListEl.innerHTML = "";
    exerciseStatusEl.classList.remove("hidden");
    exerciseStatusEl.textContent = "No exercises have been tagged with this concept yet.";
    return;
  }

  exerciseStatusEl.classList.add("hidden");
  exerciseListEl.innerHTML = exercises
    .map((exercise) => {
      const sessionId = exercise.session_id || "";
      const outcome = exercise.outcome || "unknown";
      const confidence = exercise.confidence_assessment || {};
      const href = `/sessions/${encodeURIComponent(sessionId)}/exercises/${encodeURIComponent(
        exercise.exercise_id
      )}`;
      const concepts = (exercise.concept_ids || [])
        .map((id) => `<span class="concept-chip">${escapeHtml(id)}</span>`)
        .join(" ");
      return `<a class="exercise-card" href="${href}">
        <div class="exercise-card-top">
          <span class="session-id">${escapeHtml(exercise.exercise_id)}</span>
          <span class="status-badge status-${escapeHtml(outcome)}">${escapeHtml(
            OUTCOME_LABELS[outcome] || outcome
          )}</span>
        </div>
        <div class="session-meta">
          <span>${escapeHtml(formatDate(exercise.started_at))}</span>
          <span>${escapeHtml(formatDuration(exercise.duration_seconds))}</span>
          <span>${confidence.level ? `confidence: ${escapeHtml(confidence.level)}` : ""}</span>
        </div>
        <div class="concept-row">${concepts}</div>
      </a>`;
    })
    .join("");
}

async function loadConcept() {
  if (!conceptId) {
    statusEl.textContent = "Missing concept id in the URL.";
    return;
  }
  try {
    const response = await fetch(`/api/concepts/${encodeURIComponent(conceptId)}`);
    if (response.status === 404) {
      statusEl.textContent = "Concept not found.";
      return;
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const concept = await response.json();
    titleEl.textContent = concept.name || concept.concept_id;
    document.title = concept.name || concept.concept_id;
    infoEl.innerHTML = infoRows(concept);
    renderExercises(concept.exercises || []);
    statusEl.classList.add("hidden");
    detailEl.classList.remove("hidden");
  } catch (error) {
    statusEl.textContent = `Could not load concept: ${error.message}`;
  }
}

loadConcept();
