from datetime import datetime
from enum import Enum

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from models.math_concept import _require_slug


class SessionStatus(str, Enum):
    active = "active"
    completed = "completed"
    abandoned = "abandoned"
    error = "error"


class EngagementLevel(str, Enum):
    low = "low"
    medium = "medium"
    high = "high"


class OverallEngagement(BaseModel):
    model_config = ConfigDict(extra="forbid")

    level: EngagementLevel = Field(
        description="Tutor's read on focus/motivation across the session: low | medium | high"
    )
    reasoning: str


class TranscriptMessage(BaseModel):
    model_config = ConfigDict(extra="forbid")

    role: str = Field(description="user, agent, or observation")
    text: str
    timestamp: datetime | None = Field(
        default=None,
        description="When this turn was recorded; optional on older sessions",
    )
    kind: str | None = Field(
        default=None,
        description="For observation turns: struggle | success | mistake | correction | pause | progress",
    )


class DeviceInfo(BaseModel):
    model_config = ConfigDict(extra="forbid")

    app_version: str | None = None
    camera_angle_ok: bool | None = Field(
        default=None,
        description="Debugging flag if the desk view was usable",
    )


class HomeworkSession(BaseModel):
    """One tutoring session with the agent, from start to end."""

    model_config = ConfigDict(extra="forbid")

    session_id: str

    title: str | None = Field(
        default=None,
        description="Short content-based name for this session, e.g. 'Power rule and product rule'",
    )

    started_at: datetime
    ended_at: datetime | None = None
    duration_seconds: int | None = Field(default=None, ge=0)
    status: SessionStatus

    course_focus: str | None = Field(
        default=None,
        description="Dominant course covered this session, for quick filtering",
    )

    exercise_id: list[str] = Field(
        default_factory=list,
        description="Ordered attempt IDs linking out to full Attempt records",
    )
    exercise_count: int | None = Field(default=None, ge=0)
    completed_count: int = Field(default=0, ge=0)
    abandoned_count: int = Field(default=0, ge=0)

    concepts_covered: list[str] = Field(
        default_factory=list,
        description="Deduped union of concept_ids across all attempts this session",
    )
    concepts_struggled: list[str] = Field(
        default_factory=list,
        description="Subset where errors/hints were notably high",
    )

    overall_engagement: OverallEngagement | None = None
    session_summary: str | None = None
    analysis_status: str | None = Field(
        default=None,
        description="pending while exercises/scores are computed; complete or error when done",
    )
    recommended_next_concepts: list[str] = Field(
        default_factory=list,
        description="What to review next time",
    )

    raw_transcript_ref: list[TranscriptMessage] | str | None = Field(
        default=None,
        description="Messages exchanged between student and tutor during the session",
    )
    device_info: DeviceInfo | None = None

    @field_validator("concepts_covered", "concepts_struggled", "recommended_next_concepts")
    @classmethod
    def concept_ids_are_slugs(cls, values: list[str]) -> list[str]:
        return [_require_slug(item) for item in values]

    @model_validator(mode="after")
    def check_session_consistency(self) -> "HomeworkSession":
        if self.ended_at is not None and self.ended_at < self.started_at:
            raise ValueError("ended_at must be at or after started_at")

        attempt_count = len(self.exercise_id)
        if self.exercise_count is None:
            self.exercise_count = attempt_count
        elif self.exercise_count != attempt_count:
            raise ValueError("exercise_count must equal the number of exercise_id entries")

        if self.completed_count + self.abandoned_count > attempt_count:
            raise ValueError("completed_count + abandoned_count cannot exceed exercise_count")

        covered = set(self.concepts_covered)
        struggled = [cid for cid in self.concepts_struggled if cid not in covered]
        if struggled:
            raise ValueError(
                "concepts_struggled must be a subset of concepts_covered: "
                + ", ".join(struggled)
            )
        return self
