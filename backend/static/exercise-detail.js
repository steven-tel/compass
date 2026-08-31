const statusEl = document.getElementById("exercise-status");
const detailEl = document.getElementById("exercise-detail");
const infoEl = document.getElementById("exercise-info");
const eventsEl = document.getElementById("exercise-events");
const titleEl = document.getElementById("exercise-title");
const sessionLinkEl = document.getElementById("session-link");
const sessionBannerEl = document.getElementById("session-banner");

const pathParts = window.location.pathname.split("/").filter(Boolean);
const sessionId = decodeURIComponent(pathParts[1] || "");
const exerciseId = decodeURIComponent(pathParts[3] || "");

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

function outcomeBadge(outcome) {
  const label = OUTCOME_LABELS[outcome] || outcome || "unknown";
  const cls = escapeHtml(outcome || "unknown");
  return `<span class="status-badge status-${cls}">${escapeHtml(label)}</span>`;
}

function conceptChips(ids) {
  if (!ids || !ids.length) return "—";
  return ids
    .map(
      (id) =>
        `<a class="concept-chip" href="/concepts/${encodeURIComponent(id)}">${escapeHtml(id)}</a>`
    )
    .join(" ");
}

function yesNo(value) {
  if (value == null) return "—";
  return value ? "Yes" : "No";
}

function independenceLabel(score) {
  if (score == null || score === "") return "—";
  const number = Number(score);
  if (!Number.isFinite(number)) return String(score);
  return `${Math.round(number * 100)}%`;
}

function infoRows(exercise) {
  const confidence = exercise.confidence_assessment;
  const fields = [
    ["exercise_id", escapeHtml(exercise.exercise_id || "—")],
    [
      "homework session",
      `<a href="/sessions/${encodeURIComponent(sessionId)}">${escapeHtml(sessionId)}</a>`,
    ],
    ["student_id", escapeHtml(exercise.student_id || "—")],
    ["outcome", outcomeBadge(exercise.outcome)],
    ["correct", escapeHtml(yesNo(exercise.correct))],
    ["concepts", conceptChips(exercise.concept_ids)],
    ["started_at", escapeHtml(formatDate(exercise.started_at))],
    ["ended_at", escapeHtml(formatDate(exercise.ended_at))],
    ["duration", escapeHtml(formatDuration(exercise.duration_seconds))],
    ["independence", escapeHtml(independenceLabel(exercise.independence_score))],
    [
      "confidence",
      confidence
        ? `${outcomeBadge(confidence.level)} ${escapeHtml(confidence.reasoning || "")}`
        : "—",
    ],
    ["final answer", escapeHtml(exercise.final_answer_given || "—")],
  ];

  return fields
    .map(
      ([label, value]) => `<div class="session-detail-row">
        <dt>${escapeHtml(label)}</dt>
        <dd>${value}</dd>
      </div>`
    )
    .join("");
}

function listBlock(title, items, renderItem) {
  if (!items || !items.length) {
    return `<section class="exercise-event-block">
      <h3>${escapeHtml(title)}</h3>
      <p class="note">None recorded.</p>
    </section>`;
  }
  return `<section class="exercise-event-block">
    <h3>${escapeHtml(title)}</h3>
    <div class="exercise-event-list">
      ${items.map(renderItem).join("")}
    </div>
  </section>`;
}

function renderEvents(exercise) {
  const hints = listBlock("Hints", exercise.hints_given, (hint) => {
    return `<article class="exercise-event-card">
      <div class="exercise-event-meta">
        <span class="status-badge status-active">Level ${escapeHtml(hint.hint_level)}</span>
        <span>${escapeHtml(hint.triggered_by || "")}</span>
        <span>${escapeHtml(formatDate(hint.timestamp))}</span>
      </div>
      <p>${escapeHtml(hint.text || "")}</p>
    </article>`;
  });

  const stuck = listBlock("Stuck points", exercise.stuck_points, (item) => {
    return `<article class="exercise-event-card">
      <div class="exercise-event-meta">
        <span class="concept-chip">${escapeHtml(item.related_concept_id || "")}</span>
      </div>
      <p><strong>${escapeHtml(item.step_description || "")}</strong></p>
      <p class="note">${escapeHtml(item.observed_behavior || "")}</p>
    </article>`;
  });

  const errors = listBlock("Errors", exercise.errors, (item) => {
    return `<article class="exercise-event-card">
      <div class="exercise-event-meta">
        <span class="concept-chip">${escapeHtml(item.related_concept_id || "")}</span>
        <span>${item.matched_common_mistake ? "common mistake" : "other error"}</span>
        <span>${item.self_corrected ? "self-corrected" : "needed help"}</span>
      </div>
      <p>${escapeHtml(item.description || "")}</p>
    </article>`;
  });

  const notes = `<section class="exercise-event-block">
    <h3>Tutor notes</h3>
    <p>${exercise.tutor_notes ? escapeHtml(exercise.tutor_notes) : '<span class="note">None recorded.</span>'}</p>
  </section>`;

  eventsEl.innerHTML = hints + stuck + errors + notes;
}

async function loadExercise() {
  if (!sessionId || !exerciseId) {
    statusEl.textContent = "Missing session or exercise id in the URL.";
    return;
  }

  sessionLinkEl.href = `/sessions/${encodeURIComponent(sessionId)}`;
  sessionBannerEl.innerHTML = `This attempt belongs to homework session
    <a href="/sessions/${encodeURIComponent(sessionId)}">${escapeHtml(sessionId)}</a>.`;

  try {
    const response = await fetch(
      `/api/sessions/${encodeURIComponent(sessionId)}/exercises/${encodeURIComponent(exerciseId)}`
    );
    if (response.status === 404) {
      statusEl.textContent = "Exercise not found for this homework session.";
      return;
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const exercise = await response.json();
    titleEl.textContent = exercise.exercise_id || "Exercise";
    document.title = exercise.exercise_id || "Exercise";
    infoEl.innerHTML = infoRows(exercise);
    renderEvents(exercise);
    statusEl.classList.add("hidden");
    detailEl.classList.remove("hidden");
  } catch (error) {
    statusEl.textContent = `Could not load exercise: ${error.message}`;
  }
}

loadExercise();
