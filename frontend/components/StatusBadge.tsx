import { OUTCOME_LABELS } from "@/lib/format";

export function StatusBadge({ value }: { value?: string | null }) {
  const raw = value || "unknown";
  return <span className={`badge ${raw}`}>{OUTCOME_LABELS[raw] || raw}</span>;
}
