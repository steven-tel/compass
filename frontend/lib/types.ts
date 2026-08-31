export type TranscriptMessage = {
  role: string;
  text: string;
  timestamp?: string | null;
  kind?: string | null;
};

export type HomeworkSession = {
  session_id: string;
  title?: string | null;
  status?: string;
  started_at?: string;
  ended_at?: string | null;
  duration_seconds?: number | null;
  course_focus?: string | null;
  exercise_id?: string[];
  exercise_count?: number | null;
  completed_count?: number;
  abandoned_count?: number;
  concepts_covered?: string[];
  concepts_struggled?: string[];
  recommended_next_concepts?: string[];
  overall_engagement?: { level?: string; reasoning?: string } | null;
  session_summary?: string | null;
  analysis_status?: "pending" | "complete" | "error" | string | null;
  raw_transcript_ref?: TranscriptMessage[] | string | null;
  device_info?: Record<string, unknown> | null;
};

export type Hint = {
  hint_level: number;
  text: string;
  timestamp?: string;
  triggered_by?: string;
};

export type StuckPoint = {
  step_description: string;
  related_concept_id: string;
  observed_behavior: string;
};

export type ExerciseError = {
  description: string;
  related_concept_id: string;
  matched_common_mistake?: boolean;
  self_corrected?: boolean;
};

export type Exercise = {
  exercise_id: string;
  student_id?: string;
  session_id: string;
  concept_ids?: string[];
  title?: string | null;
  started_at?: string;
  ended_at?: string | null;
  duration_seconds?: number | null;
  outcome?: string;
  hints_given?: Hint[];
  stuck_points?: StuckPoint[];
  errors?: ExerciseError[];
  confidence_assessment?: { level?: string; reasoning?: string } | null;
  independence_score?: number | null;
  final_answer_given?: string | null;
  correct?: boolean | null;
  tutor_notes?: string | null;
};

export type TutorTip = {
  title: string;
  body: string;
};

export type TutorTips = {
  headline?: string;
  tips?: TutorTip[];
  next_focus?: string;
  session_count?: number;
  session_ids?: string[];
  updated_at?: string;
};

export type EvaluatedConcept = {
  concept_id: string;
  name?: string;
  domain?: string;
  subdomain?: string;
  difficulty?: number;
  description?: string;
  prerequisites?: string[];
  keywords?: string[];
  exercise_count?: number;
  average_confidence?: number | null;
  average_confidence_level?: string | null;
  exercises?: Exercise[];
};
