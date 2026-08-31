const listEl = document.getElementById("session-list");
const statusEl = document.getElementById("session-status");
const refreshBtn = document.getElementById("refreshBtn");

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

function renderSessions(sessions) {
  if (!sessions.length) {
    listEl.innerHTML = "";
    statusEl.textContent = "No sessions yet. Run a tutor session, then refresh.";
    return;
  }

  statusEl.textContent = `${sessions.length} session${sessions.length === 1 ? "" : "s"}`;
  listEl.innerHTML = sessions
    .map((session) => {
      const id = escapeHtml(session.session_id);
      const status = escapeHtml(session.status || "unknown");
      return `<article class="session-card" data-session-id="${id}">
        <div class="session-card-header">
          <a class="session-card-link" href="/sessions/${encodeURIComponent(session.session_id)}">
            <span class="session-id">${id}</span>
            <span class="session-meta">
              <span class="status-badge status-${status}">${status}</span>
              <span>${escapeHtml(formatDate(session.started_at))}</span>
              <span>${escapeHtml(formatDuration(session.duration_seconds))}</span>
              <span>${escapeHtml(
                `${session.exercise_count || 0} exercise${
                  (session.exercise_count || 0) === 1 ? "" : "s"
                }`
              )}</span>
            </span>
          </a>
          <button class="btn danger session-delete" type="button">Delete</button>
        </div>
      </article>`;
    })
    .join("");
}

async function loadSessions() {
  statusEl.textContent = "Loading sessions…";
  try {
    const response = await fetch("/api/sessions");
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    renderSessions(data.sessions || []);
  } catch (error) {
    listEl.innerHTML = "";
    statusEl.textContent = `Could not load sessions: ${error.message}`;
  }
}

async function deleteSession(sessionId, card) {
  if (!confirm(`Delete session ${sessionId} from Firestore?`)) return;
  try {
    const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}`, {
      method: "DELETE",
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    card.remove();
    const remaining = listEl.querySelectorAll(".session-card").length;
    statusEl.textContent = remaining
      ? `${remaining} session${remaining === 1 ? "" : "s"}`
      : "No sessions yet. Run a tutor session, then refresh.";
  } catch (error) {
    alert(`Could not delete session: ${error.message}`);
  }
}

listEl.addEventListener("click", (event) => {
  const deleteBtn = event.target.closest(".session-delete");
  if (!deleteBtn) return;
  event.preventDefault();
  const card = deleteBtn.closest(".session-card");
  deleteSession(card.dataset.sessionId, card);
});

refreshBtn.addEventListener("click", loadSessions);
loadSessions();
