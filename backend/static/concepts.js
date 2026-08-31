const listEl = document.getElementById("concept-list");
const statusEl = document.getElementById("concept-status");
const refreshBtn = document.getElementById("refreshBtn");

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function formatConfidence(concept) {
  if (concept.average_confidence == null) {
    return { value: "—", level: "unknown" };
  }
  const percent = Math.round(Number(concept.average_confidence) * 100);
  return {
    value: `${percent}%`,
    level: concept.average_confidence_level || "unknown",
  };
}

function renderConcepts(concepts) {
  if (!concepts.length) {
    listEl.innerHTML = "";
    statusEl.textContent =
      "No evaluated concepts yet. Detect exercises on a homework session first.";
    return;
  }

  statusEl.textContent = `${concepts.length} evaluated concept${
    concepts.length === 1 ? "" : "s"
  }`;
  listEl.innerHTML = concepts
    .map((concept) => {
      const id = concept.concept_id;
      const name = concept.name || id;
      const count = concept.exercise_count || 0;
      const confidence = formatConfidence(concept);
      return `<a class="concept-card" href="/concepts/${encodeURIComponent(id)}">
        <div class="concept-card-top">
          <h2>${escapeHtml(name)}</h2>
          <span class="status-badge status-${escapeHtml(confidence.level)}">${escapeHtml(
            confidence.level
          )}</span>
        </div>
        <p class="concept-card-meta">${escapeHtml(concept.domain || "")}${
          concept.subdomain ? ` / ${escapeHtml(concept.subdomain)}` : ""
        }</p>
        <p class="note">${escapeHtml(concept.description || "")}</p>
        <div class="concept-stats">
          <div class="concept-stat">
            <span class="concept-stat-value">${escapeHtml(count)}</span>
            <span class="concept-stat-label">exercise${count === 1 ? "" : "s"} done</span>
          </div>
          <div class="concept-stat">
            <span class="concept-stat-value">${escapeHtml(confidence.value)}</span>
            <span class="concept-stat-label">avg confidence</span>
          </div>
        </div>
      </a>`;
    })
    .join("");
}

async function loadConcepts() {
  statusEl.textContent = "Loading concepts…";
  try {
    const response = await fetch("/api/concepts");
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    renderConcepts(data.concepts || []);
  } catch (error) {
    listEl.innerHTML = "";
    statusEl.textContent = `Could not load concepts: ${error.message}`;
  }
}

refreshBtn.addEventListener("click", loadConcepts);
loadConcepts();
