async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    const detail = payload.detail || `HTTP ${response.status}`;
    throw new Error(typeof detail === "string" ? detail : JSON.stringify(detail));
  }
  return response.json() as Promise<T>;
}

export function wsUrl(): string {
  if (process.env.NEXT_PUBLIC_WS_URL) return process.env.NEXT_PUBLIC_WS_URL;
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/ws`;
}

export function isSessionReady(
  session: { analysis_status?: string | null } | null,
  exerciseCount: number,
  options?: { fresh?: boolean; timedOut?: boolean },
) {
  if (!session) return false;
  if (options?.timedOut) return true;
  const status = (session.analysis_status || "").toLowerCase();
  if (status === "pending") return false;
  if (status === "complete" || status === "error") return true;
  if (options?.fresh) return exerciseCount > 0;
  return true;
}

export async function waitForSessionReady(sessionId: string, timeoutMs = 90000) {
  const deadline = Date.now() + timeoutMs;
  while (true) {
    const timedOut = Date.now() >= deadline;
    try {
      const session = await api.getSession(sessionId);
      const data = await api.listSessionExercises(sessionId);
      if (isSessionReady(session, (data.exercises || []).length, { fresh: true, timedOut })) {
        return true;
      }
    } catch {
      if (timedOut) return false;
    }
    if (timedOut) return false;
    await new Promise((resolve) => window.setTimeout(resolve, 1200));
  }
}

export const api = {
  listSessions: () => request<{ sessions: import("./types").HomeworkSession[] }>("/api/sessions"),
  getSession: (id: string) =>
    request<import("./types").HomeworkSession>(`/api/sessions/${encodeURIComponent(id)}`),
  deleteSession: (id: string) =>
    request<{ deleted: string }>(`/api/sessions/${encodeURIComponent(id)}`, { method: "DELETE" }),
  listSessionExercises: (id: string) =>
    request<{ exercises: import("./types").Exercise[] }>(
      `/api/sessions/${encodeURIComponent(id)}/exercises`
    ),
  getExercise: (sessionId: string, exerciseId: string) =>
    request<import("./types").Exercise>(
      `/api/sessions/${encodeURIComponent(sessionId)}/exercises/${encodeURIComponent(exerciseId)}`
    ),
  detectExercises: (id: string) =>
    request<{ exercises: import("./types").Exercise[] }>(
      `/api/sessions/${encodeURIComponent(id)}/exercises/detect`,
      { method: "POST" }
    ),
  listConcepts: () =>
    request<{ concepts: import("./types").EvaluatedConcept[] }>("/api/concepts"),
  getConcept: (id: string) =>
    request<import("./types").EvaluatedConcept>(`/api/concepts/${encodeURIComponent(id)}`),
  getTutorTips: () => request<import("./types").TutorTips>("/api/tutor-tips"),
};
